import { afterEach, expect, test } from "bun:test"
import type { Plugin, Skill } from "@opencode/plugin"
import plugin from "../src/index.js"
import { digest } from "../src/catalog.js"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const originalFetch = globalThis.fetch
const originalKey = process.env.EXECUTOR_SKILLS_API_KEY
const originalTimeout = globalThis.setTimeout
const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
  globalThis.fetch = originalFetch
  globalThis.setTimeout = originalTimeout
  if (originalKey === undefined) delete process.env.EXECUTOR_SKILLS_API_KEY
  else process.env.EXECUTOR_SKILLS_API_KEY = originalKey
})

type SkillEditor = Parameters<Parameters<Plugin.Context["skill"]["transform"]>[0]>[0]
type ToolEditor = Parameters<Parameters<Plugin.Context["tool"]["transform"]>[0]>[0]
type ToolInfo = Parameters<ToolEditor["add"]>[0]
type CommandEditor = Parameters<Parameters<Plugin.Context["command"]["transform"]>[0]>[0]
type CommandInfo = Parameters<CommandEditor["add"]>[0]

function harness(storage = new Map<string, unknown>()) {
  const skills = new Map<string, Skill.Info>()
  const tools = new Map<string, ToolInfo & {id: string}>()
  const commands = new Map<string, CommandInfo>()
  const hooks: Record<string, (event: unknown) => Promise<void>> = {}
  const state = {denied: false, nativeCalls: 0, transform: (_editor: SkillEditor) => {},
    commandTransform: (_editor: CommandEditor) => {}}
  tools.set("skill", {
    id: "skill", name: "skill", input: {type: "object"},
    description: "Host native permission-checked skill tool",
    execute: async (input) => {
      state.nativeCalls++
      if (state.denied) throw new Error("skill permission denied")
      const key = (input as {id: string}).id
      const skill = skills.get(key)
      if (!skill) throw new Error("Skill absent")
      return {content: skill.content}
    },
  })
  const registration = () => Promise.resolve({dispose: async () => {}})
  const skillReload = async () => {
    skills.clear()
    state.transform({add: (skill) => {skills.set(skill.id, skill)}} as SkillEditor)
  }
  const commandReload = async () => {
    commands.clear()
    state.commandTransform({add: (command) => {commands.set(command.name, command)}} as CommandEditor)
  }
  const ctx = {
    options: {url: "https://executor.example"},
    storage: {
      get: async (key: string) => storage.get(key),
      set: async (key: string, value: unknown) => {storage.set(key, value)},
      remove: async (key: string) => {storage.delete(key)},
      scan: async ({prefix}: {prefix: string}) => ({
        entries: [...storage].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({key, value})),
      }),
    },
    skill: {
      transform: async (callback: typeof state.transform) => {state.transform = callback; await skillReload(); return registration()},
      reload: skillReload,
    },
    command: {
      transform: async (callback: typeof state.commandTransform) => {state.commandTransform = callback; await commandReload(); return registration()},
      reload: commandReload,
    },
    session: {hook: async (name: string, callback: (event: unknown) => Promise<void>) => {hooks[name] = callback; return registration()}},
    tool: {
      hook: async (name: string, callback: (event: unknown) => Promise<void>) => {hooks[name] = callback; return registration()},
      transform: async (callback: (editor: ToolEditor) => void) => {
        callback({add: (tool: ToolInfo) => tools.set(tool.name, {...tool, id: tool.name})} as ToolEditor)
        return registration()
      },
      list: async () => [...tools.values()], reload: async () => {},
    },
  } as unknown as Plugin.Context
  return {ctx, skills, tools, commands, hooks, state, storage}
}

function bundle() {
  const text = "---\nname: demo\ndescription: Demo skill\n---\nRead the demo instructions."
  return {
    owner: "org", name: "demo", description: "Demo skill", frontmatter: {name: "demo", description: "Demo skill"},
    createdAt: 1, updatedAt: 1,
    files: [{path: "SKILL.md", content: text, size: Buffer.byteLength(text), digest: digest(text)},
      {path: "asset.bin", content: "AP8=", encoding: "base64", size: 2, digest: digest(Buffer.from([0, 255]))}],
  }
}

async function setup(host: ReturnType<typeof harness>) {
  process.env.EXECUTOR_SKILLS_API_KEY = "test-only-key"
  const cleanup = await plugin.setup(host.ctx)
  if (cleanup) cleanups.push(cleanup)
}

function polling() {
  let callback: () => Promise<void>
  globalThis.setTimeout = ((next: () => Promise<void>) => {
    callback = next
    return 0
  }) as unknown as typeof setTimeout
  return () => callback()
}

function deferred() {
  let resolve = () => {}
  const promise = new Promise<void>((done) => {resolve = done})
  return {promise, resolve}
}

const prompt = {prompt: {skills: [{id: "executor-org-demo"}]}}

test("hydration during a paused refresh retains the new persistent revision", async () => {
  const poll = polling()
  const host = harness()
  let current = bundle()
  globalThis.fetch = (async (url: string) => new Response(JSON.stringify(
    url.endsWith("/api/skills") ? [current] : current))) as typeof fetch
  await setup(host)
  await host.hooks["prompt"](prompt)
  const oldKey = [...host.storage.keys()].find((key) => key.includes("/bundle/"))!
  current = {...bundle(), description: "Updated revision"}
  const entered = deferred()
  const release = deferred()
  const reload = host.ctx.skill.reload
  let pause = true
  host.ctx.skill.reload = async () => {
    if (pause) {pause = false; entered.resolve(); await release.promise}
    return reload()
  }
  const refreshing = poll()
  await entered.promise
  await host.hooks["prompt"](prompt)
  const newKey = [...host.storage.keys()].find((key) => key.includes("/bundle/") && key !== oldKey)!
  expect(newKey).toBeDefined()
  release.resolve()
  await refreshing
  expect(host.storage.has(oldKey)).toBe(false)
  expect(host.storage.has(newKey)).toBe(true)
  globalThis.fetch = (async () => {throw new Error("offline")}) as typeof fetch
  const restarted = harness(host.storage)
  await setup(restarted)
  await restarted.hooks["prompt"](prompt)
  expect(restarted.skills.get("executor-org-demo")?.description).toBe("Updated revision")
})

for (const failure of ["catalog", "skill", "command", "remove"] as const) {
  test(`retries stale cleanup after a failed ${failure} operation`, async () => {
    const poll = polling()
    const host = harness()
    let current = bundle()
    globalThis.fetch = (async (url: string) => new Response(JSON.stringify(
      url.endsWith("/api/skills") ? [current] : current))) as typeof fetch
    await setup(host)
    await host.hooks["prompt"](prompt)
    const oldKey = [...host.storage.keys()].find((key) => key.includes("/bundle/"))!
    let failed = false
    const failOnce = () => {
      if (!failed) {failed = true; throw new Error("private failure detail")}
    }
    if (failure === "catalog") {
      const set = host.ctx.storage.set
      host.ctx.storage.set = async (key, value) => {if (key.endsWith("/catalog")) failOnce(); return set(key, value)}
    } else if (failure === "remove") {
      const remove = host.ctx.storage.remove
      host.ctx.storage.remove = async (key) => {if (key === oldKey) failOnce(); return remove(key)}
    } else {
      const surface = host.ctx[failure]
      const reload = surface.reload
      surface.reload = async () => {failOnce(); return reload()}
    }
    current = {...bundle(), description: "Updated revision"}
    await poll()
    expect(failed).toBe(true)
    expect(host.storage.has(oldKey)).toBe(true)
    await host.hooks["prompt"](prompt)
    await poll() // unchanged remote catalog must still retry queued work
    expect(host.storage.has(oldKey)).toBe(false)
    expect([...host.storage.keys()].filter((key) => key.includes("/bundle/"))).toHaveLength(1)
    expect(host.skills.get("executor-org-demo")?.description).toBe("Updated revision")
  })
}

test("a catalog rollback after failed reload reapplies registrations and retains its active bundle", async () => {
  const poll = polling()
  const host = harness()
  let current = bundle()
  globalThis.fetch = (async (url: string) => new Response(JSON.stringify(
    url.endsWith("/api/skills") ? [current] : current))) as typeof fetch
  await setup(host)
  await host.hooks["prompt"](prompt)
  const oldKey = [...host.storage.keys()].find((key) => key.includes("/bundle/"))!
  const reload = host.ctx.command.reload
  let failed = false
  host.ctx.command.reload = async () => {
    if (!failed) {failed = true; throw new Error("reload failure")}
    return reload()
  }
  current = {...bundle(), description: "Updated revision"}
  await poll()
  expect(host.skills.get("executor-org-demo")?.description).toBe("Updated revision")
  current = bundle()
  await poll()
  expect(host.skills.get("executor-org-demo")?.description).toBe("Demo skill")
  expect(host.commands.get("executor-org-demo")?.description).toBe("Demo skill")
  expect(host.storage.has(oldKey)).toBe(true)
  await host.hooks["prompt"](prompt)
})

test("credential files are trimmed, permission checked, and must be regular absolute files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "skillbridge-credentials-"))
  cleanups.push(() => rm(directory, {recursive: true, force: true}))
  const file = directory + "/key"
  await writeFile(file, "  file-only-test-key\n", {mode: 0o600})
  const host = harness()
  host.ctx.options = {url: "https://executor.example", apiKeyFile: file}
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer file-only-test-key")
    return new Response(JSON.stringify([bundle()]))
  }) as typeof fetch
  await setup(host)
  if (process.platform !== "win32") {
    await chmod(file, 0o644)
    await expect(plugin.setup(host.ctx)).rejects.toThrow("group or other")
  }
  host.ctx.options = {url: "https://executor.example", apiKeyFile: directory}
  await expect(plugin.setup(host.ctx)).rejects.toThrow("regular file")
  host.ctx.options = {url: "https://executor.example", apiKeyFile: "relative-key"}
  await expect(plugin.setup(host.ctx)).rejects.toThrow("absolute path")
})

test("public registration, on-demand tool and prompt loading, binary read, native permission denial", async () => {
  const host = harness()
  const requests: string[] = []
  globalThis.fetch = (async (url: string) => {
    requests.push(url)
    return new Response(JSON.stringify(url.endsWith("/api/skills") ? [bundle()] : bundle()))
  }) as typeof fetch
  await setup(host)
  expect(requests).toHaveLength(1) // startup only reads the index
  expect(host.skills.get("executor-org-demo")?.content).toContain("executor_skill_load")
  expect(host.commands.has("executor-org-demo")).toBe(true)
  await host.hooks["prompt"]({prompt: {skills: [{id: "executor-org-demo"}]}})
  expect(host.skills.get("executor-org-demo")?.content).toContain("Read the demo instructions")
  expect(requests).toHaveLength(2)
  const context = {signal: new AbortController().signal} as Parameters<ToolInfo["execute"]>[1]
  const output = await host.tools.get("executor_skill_file")!.execute({skill: "executor-org-demo", path: "asset.bin"}, context)
  expect(output.content).toContain('"encoding":"base64"')
  expect(output.content).toContain('"content":"AP8="')
  host.state.denied = true
  await expect(host.tools.get("executor_skill_file")!.execute({skill: "executor-org-demo", path: "asset.bin"}, context)).rejects.toThrow("permission denied")
  await expect(host.tools.get("executor_skill_load")!.execute({skill: "executor-org-demo"}, context)).rejects.toThrow("permission denied")
  expect(host.state.nativeCalls).toBe(3)
  expect(requests).toHaveLength(2)
})

test("native skill hook hydrates before host execution; local skills are untouched", async () => {
  const host = harness()
  let count = 0
  globalThis.fetch = (async (url: string) => {
    count++
    return new Response(JSON.stringify(url.endsWith("/api/skills") ? [bundle()] : bundle()))
  }) as typeof fetch
  await setup(host)
  await host.hooks["execute.before"]({tool: "skill", input: {id: "local"}})
  expect(count).toBe(1)
  await host.hooks["execute.before"]({tool: "skill", input: {id: "executor-org-demo"}})
  expect(count).toBe(2)
  expect(host.skills.get("executor-org-demo")?.content).toContain("Read the demo instructions")
})

test("deduplicates concurrent and repeated on-demand hydration", async () => {
  const host = harness()
  let requests = 0
  let release = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  globalThis.fetch = (async (url: string) => {
    requests++
    if (url.endsWith("/api/skills")) return new Response(JSON.stringify([bundle()]))
    await gate
    return new Response(JSON.stringify(bundle()))
  }) as typeof fetch
  await setup(host)
  const event = {prompt: {skills: [{id: "executor-org-demo"}, {id: "executor-org-demo"}]}}
  const first = host.hooks["prompt"](event)
  const second = host.hooks["prompt"](event)
  await Bun.sleep(0)
  expect(requests).toBe(2)
  release()
  await Promise.all([first, second])
  expect(host.skills.get("executor-org-demo")?.content).toContain("Read the demo instructions")
})

test("offline verified bundles load across restarts, uncached bundles fail", async () => {
  const first = harness()
  globalThis.fetch = (async (url: string) => new Response(JSON.stringify(url.endsWith("/api/skills") ? [bundle()] : bundle()))) as typeof fetch
  await setup(first)
  await first.hooks["prompt"]({prompt: {skills: [{id: "executor-org-demo"}]}})
  const second = harness(first.storage)
  globalThis.fetch = (async () => {throw new Error("offline")}) as typeof fetch
  await setup(second)
  await second.hooks["prompt"]({prompt: {skills: [{id: "executor-org-demo"}]}})
  expect(second.skills.get("executor-org-demo")?.content).toContain("Read the demo instructions")
  const indexOnly = new Map([...first.storage].filter(([key]) => key.endsWith("catalog")))
  const third = harness(indexOnly)
  await setup(third)
  await expect(third.hooks["prompt"]({prompt: {skills: [{id: "executor-org-demo"}]}})).rejects.toThrow("offline")
})

test("prunes cache partitions from superseded credentials", async () => {
  const storage = new Map<string, unknown>([["cache/sha256:old/catalog", [bundle()]]])
  const host = harness(storage)
  globalThis.fetch = (async (url: string) =>
    new Response(JSON.stringify(url.endsWith("/api/skills") ? [bundle()] : bundle()))) as typeof fetch
  await setup(host)
  expect(storage.has("cache/sha256:old/catalog")).toBe(false)
  expect([...storage.keys()].some((key) => key.endsWith("/catalog"))).toBe(true)
})

test("insecure URLs and embedded credentials are rejected", async () => {
  const host = harness()
  process.env.EXECUTOR_SKILLS_API_KEY = "test"
  for (const url of ["http://executor.example", "https://user:pass@executor.example", "https://executor.example/path"]) {
    const ctx = {...host.ctx, options: {url}}
    await expect(plugin.setup(ctx)).rejects.toThrow()
  }
})
