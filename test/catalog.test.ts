import { describe, expect, test } from "bun:test"
import { ExecutorSkills, catalog, digest, id, instructions, revision, verify } from "../src/catalog.js"

export const fixture = () => {
  const body = "---\nname: example\ndescription: Example skill\n---\n# Example\nRead references/café.md."
  const asset = Buffer.from([0, 255, 10])
  return {
    owner: "org" as const, name: "example", description: "Example skill",
    frontmatter: {name: "example", description: "Example skill"}, createdAt: 1, updatedAt: 1,
    files: [
      {path: "SKILL.md", content: body, size: Buffer.byteLength(body), digest: digest(body)},
      {path: "assets/image.bin", content: asset.toString("base64"), encoding: "base64" as const,
        size: asset.length, digest: digest(asset)},
      {path: "references/café.md", content: "Café", size: Buffer.byteLength("Café"), digest: digest("Café")},
    ],
  }
}

const sensitive = "SYNTHETIC_PRIVATE_SENTINEL"
async function redacted(action: () => unknown, code: string) {
  let caught: unknown
  try { await action() } catch (error) { caught = error }
  expect(caught).toBeInstanceOf(Error)
  const error = caught as Error & {code: string}
  expect(error.code).toBe(code)
  expect(error).not.toHaveProperty("cause")
  expect(String(error)).not.toContain(sensitive)
  expect(error.stack).not.toContain(sensitive)
  expect(JSON.stringify(error)).not.toContain(sensitive)
  expect(Object.values(error).map(String).join(" ")).not.toContain(sensitive)
  return error
}

function responds(value: string | Response) {
  return new ExecutorSkills(`https://${sensitive}.example`, () => sensitive, (async () =>
    typeof value === "string" ? new Response(value) : value) as typeof fetch)
}

describe("native bundles", () => {
  test("validates bytes, binary, Unicode and qualified owner IDs", () => {
    const skill = fixture()
    expect(verify(skill, catalog.parse([skill])[0]).files.length).toBe(3)
    expect(id(skill)).toBe("executor-org-example")
    expect(id({...skill, owner: "user"})).toBe("executor-user-example")
    expect(instructions(skill)).toContain("path is virtual")
    expect(instructions(skill)).not.toContain("---\nname:")
    expect(instructions(skill)).toContain("references/café.md")
  })
  test("rejects corruption and stale revisions", () => {
    const skill = fixture()
    expect(() => verify({...skill, files: skill.files.map((file) => ({...file, content: "bad"}))}, skill)).toThrow("integrity")
    expect(() => verify({...skill, description: "Changed"}, skill)).toThrow("changed")
    const binary = skill.files[1]
    expect(() => verify({...skill, files: skill.files.map((file) => file === binary ? {...file, content: "%%%="} : file)}, skill)).toThrow("base64")
  })
  test("rejects unsafe and duplicate paths, incomplete or oversized manifests", () => {
    const skill = fixture()
    for (const path of ["../secret", "/secret", "a//b", "a\\b", "a\u0000b"])
      expect(catalog.safeParse([{...skill, files: [...skill.files, {...skill.files[0], path}]}]).success).toBe(false)
    expect(catalog.safeParse([{...skill, files: [...skill.files, skill.files[0]]}]).success).toBe(false)
    expect(catalog.safeParse([{...skill, files: skill.files.slice(1)}]).success).toBe(false)
    expect(catalog.safeParse([{...skill, files: skill.files.map((file) => ({...file, size: 64 * 1024 * 1024}))}]).success).toBe(false)
    expect(catalog.safeParse([{...skill, files: skill.files.map((file) => file.path === "SKILL.md" ? {...file, size: 512 * 1024 + 1} : file)}]).success).toBe(false)
  })
  test("revision ignores API file contents and ordering", () => {
    const skill = fixture()
    expect(revision(skill)).toBe(revision({...skill, files: [...skill.files].reverse()}))
  })
  test("rejects duplicate qualified IDs but allows the same name for different owners", () => {
    const skill = fixture()
    expect(catalog.safeParse([skill, {...skill, description: "Different revision"}]).success).toBe(false)
    expect(catalog.safeParse([skill, {...skill, owner: "user"}]).success).toBe(true)
  })
  test("redacts invalid bundle schema, content and paths", async () => {
    const skill = fixture()
    for (const value of [
      {...skill, owner: sensitive},
      {...skill, files: skill.files.map((file) => ({...file, content: {private: sensitive}}))},
      {...skill, files: skill.files.map((file) => ({...file, path: `../${sensitive}`}))},
      {...skill, files: skill.files.map((file) => ({...file, encoding: sensitive}))},
    ]) await redacted(() => verify(value, skill), "INVALID_SCHEMA")
  })
  test("redacts filenames in integrity and base64 failures", async () => {
    const skill = fixture()
    skill.files[1].path = `assets/${sensitive}.bin`
    await redacted(() => verify({...skill, files: skill.files.map((file) =>
      file.path.includes(sensitive) ? {...file, content: "%%%="} : file)}, skill), "INVALID_BASE64")
    await redacted(() => verify({...skill, files: skill.files.map((file) =>
      file.path.includes(sensitive) ? {...file, content: "AAAA"} : file)}, skill), "INTEGRITY")
    await redacted(() => verify({...skill, description: sensitive}, skill), "CHANGED_REVISION")
  })
})

describe("read-only transport", () => {
  test("only GETs, never forwards credentials through redirects, hides error bodies", async () => {
    const calls: RequestInit[] = []
    const fetcher = (async (_url: unknown, init: RequestInit) => {
      calls.push(init)
      return new Response(JSON.stringify([fixture()]))
    }) as typeof fetch
    const api = new ExecutorSkills("https://executor.example", () => "test-not-a-secret", fetcher)
    expect(await api.list()).toHaveLength(1)
    expect(calls[0].method).toBe("GET")
    expect(calls[0].redirect).toBe("error")
    const denied = new ExecutorSkills("https://executor.example", () => "test", (async () =>
      new Response("sensitive error body", {status: 403})) as typeof fetch)
    await expect(denied.list()).rejects.toThrow("HTTP 403")
    const missing = new ExecutorSkills("https://executor.example", () => "", fetcher)
    await expect(missing.list()).rejects.toThrow("not set")
    expect(calls).toHaveLength(1)
  })
  test("get verifies against the retained catalog", async () => {
    const skill = fixture()
    const api = new ExecutorSkills("https://executor.example", () => "test", (async () =>
      new Response(JSON.stringify(skill))) as typeof fetch)
    expect(await api.get(skill)).toEqual(skill)
    await expect(api.get({...skill, description: "New revision"})).rejects.toThrow("changed")
  })
  test("redacts malformed JSON and invalid catalog schemas", async () => {
    await redacted(() => responds(`{"private":"${sensitive}",}`).list(), "INVALID_JSON")
    const skill = fixture()
    for (const value of [
      [{...skill, owner: sensitive}],
      [{...skill, frontmatter: {[sensitive]: sensitive}, files: [...skill.files, {...skill.files[0], path: `../${sensitive}`}]}],
    ]) await redacted(() => responds(JSON.stringify(value)).list(), "INVALID_SCHEMA")
    await redacted(() => responds(JSON.stringify({...skill, owner: sensitive})).get(skill), "INVALID_SCHEMA")
    const error = await redacted(() => responds(new Response(sensitive, {status: 403})).list(), "HTTP")
    expect(error.message).toContain("HTTP 403")
  })
  test("redacts rejected fetch and body reads without retaining causes", async () => {
    const api = new ExecutorSkills(`https://${sensitive}.example`, () => sensitive, (async () => {
      throw new Error(`Transport failed for ${sensitive}`, {cause: sensitive})
    }) as typeof fetch)
    await redacted(() => api.list(), "TRANSPORT")
    const response = new Response(new ReadableStream({start(controller) {
      controller.error(new Error(`Body read failed: ${sensitive}`))
    }}))
    await redacted(() => responds(response).list(), "TRANSPORT")
  })
  test("sanitizes custom abort reasons while preserving cancellation classification", async () => {
    const controller = new AbortController()
    controller.abort(new Error(sensitive))
    const api = new ExecutorSkills("https://executor.example", () => sensitive, (async (_url, init) => {
      throw init?.signal?.reason
    }) as typeof fetch)
    const error = await redacted(() => api.list(controller.signal), "ABORTED")
    expect(error.name).toBe("AbortError")
  })
  test("reader cancellation failures cannot mask success or a sanitized failure", async () => {
    function response(body: string) {
      const result = new Response(body)
      const reader = result.body!.getReader()
      Object.defineProperty(result.body, "getReader", {value: () => ({
        read: () => reader.read(),
        cancel: async () => { throw new Error(`Cleanup failed: ${sensitive}`) },
      })})
      return result
    }
    expect(await responds(response(JSON.stringify([fixture()]))).list()).toHaveLength(1)
    await redacted(() => responds(response(sensitive)).list(), "INVALID_JSON")
  })
})
