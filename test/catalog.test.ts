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
})
