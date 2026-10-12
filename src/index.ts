import { Plugin, Skill } from "@opencode/plugin"
import { open } from "node:fs/promises"
import { isAbsolute } from "node:path"
import { z } from "zod"
import { ExecutorSkills, catalog, digest, id, instructions, revision, verify } from "./catalog.js"
import type { Summary, Bundle } from "./catalog.js"

const options = z.object({
  url: z.url(), apiKeyEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/).default("EXECUTOR_SKILLS_API_KEY"),
  apiKeyFile: z.string().min(1).optional(),
  pollSeconds: z.number().int().min(10).max(3600).default(30),
  allowInsecureHttp: z.boolean().default(false),
})

export default Plugin.define({
  id: "skillbridge",
  async setup(ctx) {
    const config = options.parse(ctx.options)
    const url = new URL(config.url)
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/")
      throw new Error("SkillBridge: URL must be an origin without credentials, query, or path")
    if (url.protocol !== "https:" && !(url.protocol === "http:" && config.allowInsecureHttp))
      throw new Error("SkillBridge requires HTTPS (or explicit allowInsecureHttp)")
    const credential = config.apiKeyFile
      ? await readCredential(config.apiKeyFile)
      : process.env[config.apiKeyEnv]
    if (!credential) throw new Error(`Set ${config.apiKeyEnv} or apiKeyFile before loading SkillBridge`)
    const client = new ExecutorSkills(url.origin, () => credential)
    // Partition persistent cache by endpoint AND credential, without retaining the credential.
    const prefix = `cache/${digest(url.origin + "\0" + credential)}/`
    const state = {
      skills: [] as Summary[], bundles: new Map<string, Bundle>(),
      loading: new Map<string, Promise<Bundle>>(), applied: "",
      cleanup: new Set<string>(),
    }
    const controller = new AbortController()
    const warn = (_error: unknown) => console.warn("SkillBridge operation failed; retaining verified state")
    await pruneOtherCaches(ctx.storage, prefix).catch(warn)
    const cached = catalog.safeParse(await ctx.storage.get(prefix + "catalog"))
    if (cached.success) {
      state.skills = cached.data
      state.applied = revisionOfCatalog(cached.data)
      await reconcileBundles()
    }

    function bundleKey(skill: Summary) {
      return prefix + "bundle/" + id(skill) + "/" + digest(revision(skill))
    }

    async function reconcileBundles() {
      // The persisted catalog is authoritative after restart; an in-memory
      // removal queue alone cannot recover cleanup interrupted by a shutdown.
      let after: string | undefined
      try {
        do {
          const page = await ctx.storage.scan({prefix: prefix + "bundle/", after, limit: 100})
          page.entries.forEach((entry) => state.cleanup.add(entry.key))
          after = page.next
        } while (after)
      } catch (error) { warn(error) }
      // Scan before deleting so removal cannot disturb page boundaries. Check
      // live revisions, including bundles hydrated while reload/scan awaited.
      const active = new Set(state.skills.map(bundleKey))
      await Promise.all([...state.cleanup].map(async (key) => {
        if (active.has(key)) { state.cleanup.delete(key); return }
        try {
          await ctx.storage.remove(key)
          state.cleanup.delete(key)
        } catch (error) { warn(error) }
      }))
    }

    async function load(skillID: string, signal?: AbortSignal): Promise<Bundle> {
      const skill = state.skills.find((skill) => id(skill) === skillID)
      if (!skill) throw new Error(`Executor skill not found: ${skillID}`)
      const retained = state.bundles.get(skillID)
      if (retained && revision(retained) === revision(skill)) return retained
      const storedKey = bundleKey(skill)
      const stored = await ctx.storage.get(storedKey)
      const current = state.skills.find((entry) => id(entry) === skillID)
      if (!current) throw new Error(`Executor skill was removed while loading: ${skillID}`)
      if (revision(current) !== revision(skill)) return load(skillID, signal)
      if (stored) {
        const parsed = z.unknown().transform((value, ctx) => {
          try { return verify(value, skill) } catch { ctx.addIssue({code: "custom", message: "Invalid cached bundle"}); return z.NEVER }
        }).safeParse(stored)
        if (parsed.success) { state.bundles.set(skillID, parsed.data); return parsed.data }
      }
      const key = `${skillID}\0${revision(skill)}`
      const pending = state.loading.get(key)
      if (pending) return pending
      const loading: Promise<Bundle> = (async () => {
        const loaded = await client.get(skill, signal ? AbortSignal.any([controller.signal, signal]) : controller.signal)
        const current = state.skills.find((entry) => id(entry) === skillID)
        if (!current) throw new Error(`Executor skill was removed while loading: ${skillID}`)
        if (revision(current) !== revision(loaded)) return load(skillID, signal)
        state.bundles.set(skillID, loaded)
        await ctx.storage.set(storedKey, JSON.parse(JSON.stringify(loaded))).catch(warn)
        const latest = state.skills.find((entry) => id(entry) === skillID)
        if (!latest || revision(latest) !== revision(loaded)) state.cleanup.add(storedKey)
        return loaded
      })().finally(() => state.loading.delete(key))
      state.loading.set(key, loading)
      return loading
    }

    const refresh = async () => {
      const skills = await client.list(controller.signal)
      const next = revisionOfCatalog(skills)
      const stale = state.skills.filter((previous) => {
        const current = skills.find((skill) => id(skill) === id(previous))
        return !current || revision(current) !== revision(previous)
      })
      stale.forEach((skill) => state.cleanup.add(bundleKey(skill)))
      if (revisionOfCatalog(state.skills) !== next) state.applied = ""
      state.skills = skills
      state.bundles.forEach((bundle, key) => {
        const current = skills.find((skill) => id(skill) === key)
        if (!current || revision(current) !== revision(bundle)) state.bundles.delete(key)
      })
      if (next !== state.applied) {
        await ctx.storage.set(prefix + "catalog", JSON.parse(JSON.stringify(skills)))
        await ctx.skill.reload()
        await ctx.command.reload()
        state.applied = next
      }
      await reconcileBundles()
    }

    await ctx.skill.transform((editor) => {
      state.skills.forEach((skill) => {
        const candidate = state.bundles.get(id(skill))
        const loaded = candidate && revision(candidate) === revision(skill) ? candidate : undefined
        // No MCP origin schema or other fork-only fields; works on upstream V2.
        editor.add(Skill.Info.make({
          id: Skill.ID.make(id(skill)), name: Skill.Name.make(`executor-${skill.owner}-${skill.name}`),
          description: skill.description,
          path: `/skillbridge/${id(skill)}/remote.md` as Skill.Info["path"],
          content: loaded ? instructions(loaded) :
            `Load this Executor skill using executor_skill_load with skill="${id(skill)}". Its files are remote, not local.`,
        }))
      })
    })
    await ctx.command.transform((editor) => {
      state.skills.forEach((skill) => editor.add({
        name: id(skill), description: skill.description,
        execute: async (input) => {
          await ctx.session.prompt({
            ...input.prompt, sessionID: input.sessionID, delivery: input.delivery,
            skills: [...(input.prompt.skills ?? []), {id: Skill.ID.make(id(skill))}],
          })
        },
      }))
    })
    await ctx.session.hook("prompt", async (event) => {
      const selected = [...new Set((event.prompt.skills ?? []).map((skill) => skill.id))]
        .filter((skillID) => state.skills.some((entry) => id(entry) === skillID))
      if (!selected.length) return
      await Promise.all(selected.map((skillID) => load(skillID)))
      await ctx.skill.reload()
    })
    // Preload before the built-in skill tool executes; its permission checks remain intact.
    await ctx.tool.hook("execute.before", async (event) => {
      if (event.tool !== "skill") return
      const input = z.object({id: z.string()}).safeParse(event.input)
      if (!input.success || !state.skills.some((skill) => id(skill) === input.data.id)) return
      await load(input.data.id)
      await ctx.skill.reload()
    })
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "executor_skill_load", description: "Load an Executor native skill by its qualified ID. Bundle files remain remote.",
        input: {type: "object", properties: {skill: {type: "string"}}, required: ["skill"], additionalProperties: false},
        execute: async (input, context) => {
          const {skill} = z.object({skill: z.string()}).parse(input)
          // Use the host's native skill tool for permission enforcement instead of bypassing it.
          const native = (await ctx.tool.list()).find((tool) => tool.id === "skill")
          if (!native) throw new Error("OpenCode native skill tool is unavailable")
          await load(skill, context.signal)
          await ctx.skill.reload()
          const result = await native.execute({id: skill}, context)
          return {
            content: result.content,
            ...(result.metadata === undefined ? {} : {metadata: result.metadata}),
          }
        },
      })
      editor.add({
        name: "executor_skill_file", description: "Read a verified remote Executor bundle file by qualified skill ID and exact relative path. Binary content is base64; nothing is executed.",
        input: {type: "object", properties: {skill: {type: "string"}, path: {type: "string"}}, required: ["skill", "path"], additionalProperties: false},
        execute: async (input, context) => {
          const data = z.object({skill: z.string(), path: z.string()}).parse(input)
          const native = (await ctx.tool.list()).find((tool) => tool.id === "skill")
          if (!native) throw new Error("OpenCode native skill tool is unavailable")
          // Apply the same native skill permission check before returning any bundle bytes.
          await load(data.skill, context.signal)
          await ctx.skill.reload()
          await native.execute({id: data.skill}, context)
          const bundle = await load(data.skill, context.signal)
          const file = bundle.files.find((file) => file.path === data.path)
          if (!file) throw new Error("File is not in this skill's verified manifest")
          return {content: JSON.stringify({path: file.path, digest: file.digest, size: file.size,
            content: file.content, encoding: file.encoding ?? "utf8"})}
        },
      })
    })
    try {
      await refresh()
    } catch (error) {
      if (!cached.success) throw error
      warn(error)
    }
    // One refresh at a time; cleanup cancels network work and prevents another poll.
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      await refresh().catch(warn)
      if (!controller.signal.aborted) timer = setTimeout(poll, config.pollSeconds * 1000)
    }
    timer = setTimeout(poll, config.pollSeconds * 1000)
    return () => { controller.abort(); clearTimeout(timer) }
  },
})

function revisionOfCatalog(skills: Summary[]) {
  return JSON.stringify(skills.map((skill) => [id(skill), revision(skill)]).sort(([a], [b]) => a.localeCompare(b)))
}

async function readCredential(file: string) {
  if (!isAbsolute(file)) throw new Error("SkillBridge: apiKeyFile must be an absolute path")
  const handle = await open(file, "r")
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new Error("SkillBridge: apiKeyFile must be a regular file")
    if (process.platform !== "win32" && (info.mode & 0o077) !== 0)
      throw new Error("SkillBridge: apiKeyFile must not be accessible by group or other users")
    if (process.getuid && info.uid !== process.getuid())
      throw new Error("SkillBridge: apiKeyFile must be owned by the OpenCode service user")
    return (await handle.readFile("utf8")).trim()
  } finally { await handle.close() }
}

async function pruneOtherCaches(storage: Plugin.Context["storage"], prefix: string) {
  let after: string | undefined
  do {
    const page = await storage.scan({prefix: "cache/", after, limit: 100})
    await Promise.all(page.entries.filter((entry) => !entry.key.startsWith(prefix)).map((entry) => storage.remove(entry.key)))
    after = page.next
  } while (after)
}
