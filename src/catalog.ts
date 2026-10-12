import { createHash } from "node:crypto"
import { z } from "zod"

const MAX_BUNDLE_BYTES = 64 * 1024 * 1024
const MAX_INSTRUCTION_BYTES = 512 * 1024
const MAX_FRONTMATTER_BYTES = 256 * 1024

class CatalogError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  try { return schema.parse(value) } catch {
    throw new CatalogError("INVALID_SCHEMA", "Executor Skills response failed schema validation")
  }
}

const file = z.object({
  path: z.string().max(1024).refine((path) => path.split("/").every((part) =>
    part.length > 0 && part !== "." && part !== ".." && !/[\\\u0000-\u001f\u007f]/.test(part))),
  size: z.number().int().min(0).max(MAX_BUNDLE_BYTES),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
})
export const summary = z.object({
  owner: z.enum(["org", "user"]),
  name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().min(1).max(4096),
  frontmatter: z.record(z.string(), z.unknown()).refine((value) =>
    Buffer.byteLength(JSON.stringify(value)) <= MAX_FRONTMATTER_BYTES, "Frontmatter is too large"),
  files: z.array(file).max(2048),
  createdAt: z.number().finite().safe(), updatedAt: z.number().finite().safe(),
}).refine((skill) => skill.files.some((file) => file.path === "SKILL.md") &&
  new Set(skill.files.map((file) => file.path)).size === skill.files.length &&
  skill.files.reduce((size, file) => size + file.size, 0) <= MAX_BUNDLE_BYTES &&
  skill.files.find((file) => file.path === "SKILL.md")!.size <= MAX_INSTRUCTION_BYTES)
export type Summary = z.infer<typeof summary>
const bundle = summary.safeExtend({files: z.array(file.extend({
  content: z.string(), encoding: z.literal("base64").optional(),
})).max(2048)})
export type Bundle = z.infer<typeof bundle>
export const catalog = z.array(summary).max(10000).refine((skills) =>
  new Set(skills.map(id)).size === skills.length, "Duplicate qualified skill IDs")
export const digest = (bytes: Uint8Array | string) => "sha256:" + createHash("sha256").update(bytes).digest("hex")
export const id = (skill: Pick<Summary, "owner" | "name">) => `executor-${skill.owner}-${skill.name}`
export const revision = (skill: Summary) => JSON.stringify({
  owner: skill.owner, name: skill.name, description: skill.description,
  frontmatter: skill.frontmatter,
  files: [...skill.files].map(({path, size, digest}) => ({path, size, digest})).sort((a, b) => a.path.localeCompare(b.path)),
})

export function verify(value: unknown, expected: Summary): Bundle {
  const result = parse(bundle, value)
  if (revision(result) !== revision(expected)) throw new CatalogError("CHANGED_REVISION", "Executor skill changed; refresh before loading")
  for (const file of result.files) {
    if (file.encoding === "base64" && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.content))
      throw new CatalogError("INVALID_BASE64", "Executor skill file has invalid base64")
    const bytes = Buffer.from(file.content, file.encoding === "base64" ? "base64" : "utf8")
    if (bytes.length !== file.size || digest(bytes) !== file.digest)
      throw new CatalogError("INTEGRITY", "Executor skill file failed integrity verification")
  }
  return result
}

export function instructions(skill: Bundle) {
  const file = skill.files.find((file) => file.path === "SKILL.md")!
  const text = Buffer.from(file.content, file.encoding === "base64" ? "base64" : "utf8").toString("utf8")
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
  return [
    body.trim(), "",
    `Source: Executor native storage (${skill.owner}/${skill.name}).`,
    "The displayed base path is virtual, not a local directory. Do not read it with filesystem tools.",
    `Read bundled files with executor_skill_file using skill="${id(skill)}" and the exact relative path.`,
    "Binary files return base64. Scripts are reference data; they are not installed or automatically executed.",
    "Bundled files:", ...skill.files.filter((file) => file.path !== "SKILL.md").map((file) => `- ${file.path}`),
  ].join("\n")
}

export class ExecutorSkills {
  constructor(readonly url: string, readonly key: () => string, readonly fetcher = fetch) {}
  async request(path: string, signal?: AbortSignal): Promise<unknown> {
    const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000)
    try {
      const key = this.key()
      if (!key) throw new CatalogError("MISSING_KEY", "SkillBridge: API key environment variable is not set")
      const response = await this.fetcher(this.url + "/api/skills" + path, {
        method: "GET", headers: {Authorization: `Bearer ${key}`}, redirect: "error",
        signal: requestSignal,
      })
      if (!response.ok) throw new CatalogError("HTTP", `Executor Skills API returned HTTP ${response.status}`)
      // Bound the response before parsing, including base64 overhead for a 64 MiB bundle.
      const reader = response.body?.getReader()
      if (!reader) throw new CatalogError("EMPTY_RESPONSE", "Executor Skills API returned an empty response")
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const next = await reader.read()
          if (next.done) break
          size += next.value.length
          if (size > 96 * 1024 * 1024) throw new CatalogError("RESPONSE_TOO_LARGE", "Executor Skills response exceeds 96 MiB")
          chunks.push(next.value)
        }
        try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) } catch {
          throw new CatalogError("INVALID_JSON", "Executor Skills API returned invalid JSON")
        }
      } finally {
        // Cleanup must neither expose transport details nor replace the request outcome.
        try { await reader.cancel() } catch {}
      }
    } catch (error) {
      if (requestSignal.aborted) {
        const aborted = new CatalogError("ABORTED", "Executor Skills request aborted")
        aborted.name = "AbortError"
        throw aborted
      }
      if (error instanceof CatalogError) throw error
      throw new CatalogError("TRANSPORT", "Executor Skills request failed")
    }
  }
  async list(signal?: AbortSignal) { return parse(catalog, await this.request("", signal)) }
  async get(skill: Summary, signal?: AbortSignal) {
    return verify(await this.request(`/${skill.owner}/${encodeURIComponent(skill.name)}`, signal), skill)
  }
}
