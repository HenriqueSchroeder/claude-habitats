import type { EngineInterface, Register } from 'claude-code'

import type { HabitatCategory, HabitatEvent, HabitatListener, HabitatMood, HabitatSignals } from '../types'

const CATEGORIES: Record<string, HabitatCategory> = {
  Edit: 'edit',
  Write: 'edit',
  NotebookEdit: 'edit',
  Bash: 'shell',
  Read: 'read',
  Grep: 'read',
  Glob: 'read',
  WebFetch: 'web',
  WebSearch: 'web',
  Agent: 'agent',
  Task: 'agent',
}

const categoryOf = (tool: string): HabitatCategory => CATEGORIES[tool] ?? (tool.startsWith('mcp__') ? 'mcp' : 'other')

const fresh = (): HabitatSignals => ({
  repo: null,
  turns: 0,
  mood: 'idle',
  tools: { edit: 0, shell: 0, read: 0, web: 0, agent: 0, mcp: 0, other: 0 },
  errors: 0,
  compactions: 0,
  files: {},
  context: null,
  costUsd: 0,
  rateLimit: null,
  active: null,
})

// ponytail: module state, so reloading the core alone drops the scenes' subscriptions
// until they reload too; a registry in $.store if core updates ever ship mid-session.
let signals = fresh()
// Tools can run in parallel, so the mood stays 'tool' until the last one returns.
let running = 0
const listeners = new Map<string, HabitatListener>()
const scenes = new Set<string>()

function emit(event: HabitatEvent) {
  for (const listener of listeners.values()) {
    // One broken scene must not stop the others from hearing the event.
    try {
      listener(signals, event)
    } catch {}
  }
}

function setMood(mood: HabitatMood) {
  signals = { ...signals, mood }
}

async function refreshUsage($: EngineInterface) {
  let usage
  try {
    usage = await $.session.usage()
  } catch {
    return
  }
  const percent = usage.context.percent
  const fiveHour = usage.rateLimits.find(limit => limit.kind === 'five_hour')
  const next = {
    context: percent === undefined ? null : percent / 100,
    costUsd: usage.cost?.usd ?? 0,
    rateLimit: fiveHour === undefined ? null : fiveHour.percentUsed / 100,
  }
  if (next.context === signals.context && next.costUsd === signals.costUsd && next.rateLimit === signals.rateLimit) return
  signals = { ...signals, ...next }
  emit({ kind: 'usage' })
}

// Each scene owns its theme: the new one sets it, and on 'off' the old one clears it.
async function activate($: EngineInterface, scene: string | null) {
  const previous = signals.active
  signals = { ...signals, active: scene }
  await $.store.set('active', scene ?? 'none')
  emit({ kind: 'activate', scene, previous })
}

// Who draws the backdrop: the scene picked with /habitat, else the first scene to load.
export const claims = (saved: unknown, active: string | null, scene: string) =>
  saved === scene || (saved === undefined && (active === null || active === scene))

// A saved scene that is no longer installed would leave the backdrop empty for good.
async function adoptOrphan($: EngineInterface) {
  const first = [...scenes][0]
  if (signals.active !== null || first === undefined) return
  const saved = await $.store.get('active')
  if (saved !== 'none' && !scenes.has(String(saved))) await activate($, first)
}

function describe() {
  const s = signals
  const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n * 100)}%`)
  const tools = Object.entries(s.tools)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k} ${n}`)
    .join(', ')
  return [
    `Scene: ${s.active ?? 'off'} (installed: ${[...scenes].join(', ') || 'none'})`,
    `Repo: ${s.repo ?? 'none'}`,
    `Turns ${s.turns} · mood ${s.mood} · errors ${s.errors} · compactions ${s.compactions}`,
    `Tools: ${tools || 'none yet'}`,
    `Files edited: ${Object.keys(s.files).length}`,
    `Context ${pct(s.context)} · 5h limit ${pct(s.rateLimit)} · cost $${s.costUsd.toFixed(2)}`,
  ].join('\n')
}

export const register: Register = on => {
  on('engine.create', async (_, e, next) => {
    const beneath = await next(e)
    const keyOf = (scene: string) => `world:${scene}:${signals.repo}`
    const habitat = {
      signals: async () => signals,
      subscribe: (scene: string, listener: HabitatListener) => void listeners.set(scene, listener),
      claim: async (scene: string) => {
        scenes.add(scene)
        const saved = await beneath.store.get('active')
        if (claims(saved, signals.active, scene)) signals = { ...signals, active: scene }
        return signals.active === scene
      },
      // Outside a repository there is no place to keep a world: it lives for the session.
      load: async (scene: string) => (signals.repo === null ? undefined : beneath.store.get(keyOf(scene))),
      save: async (scene: string, data: unknown) => {
        if (signals.repo !== null) await beneath.store.set(keyOf(scene), data)
      },
    }
    return { ...beneath, habitat }
  })

  on('session.start', async ($, e, next) => {
    signals = { ...fresh(), active: signals.active }
    const repo = await $.session.repo()
    signals = { ...signals, repo: repo?.root ?? null }
    await $.command.register({ name: 'habitat', description: 'Show the session signals, or pick a scene: /habitat <scene> or /habitat off' })
    $.clock.every(30_000, () => void refreshUsage($))
    return next(e)
  })

  on('command.run', { command: 'habitat' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === '') return { text: describe() }
    if (arg === 'off') {
      await activate($, null)
      return { text: 'Habitat is off' }
    }
    if (!scenes.has(arg)) return { text: `No scene "${arg}". Installed: ${[...scenes].join(', ') || 'none'}` }
    await activate($, arg)
    return { text: `Habitat: ${arg}` }
  })

  on('turn.start', async ($, e, next) => {
    // Every scene has loaded by the first turn, so an orphaned pick can fall back now.
    await adoptOrphan($)
    signals = { ...signals, turns: signals.turns + 1 }
    setMood('thinking')
    emit({ kind: 'turn.start' })
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const category = categoryOf(e.tool)
    running += 1
    setMood('tool')
    // Tool arguments sit on the event itself, beside `tool`.
    const args = e as { file_path?: unknown; notebook_path?: unknown }
    const path = typeof args.file_path === 'string' ? args.file_path : typeof args.notebook_path === 'string' ? args.notebook_path : undefined
    const root = signals.repo
    // Only files inside the repo count: the scenes are the repo's.
    const file = path !== undefined && root !== null && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : undefined
    try {
      const result = await next(e)
      const isError = result.isError === true || result.deny !== undefined
      const files = category === 'edit' && file !== undefined && !isError ? { ...signals.files, [file]: (signals.files[file] ?? 0) + 1 } : signals.files
      signals = {
        ...signals,
        tools: { ...signals.tools, [category]: signals.tools[category] + 1 },
        errors: signals.errors + (isError ? 1 : 0),
        files,
      }
      emit({ kind: 'tool', category, tool: e.tool, file, isError })
      return result
    } finally {
      running -= 1
      if (running === 0) setMood('thinking')
    }
  })

  on('session.compact', async (_, e, next) => {
    const result = await next(e)
    signals = { ...signals, compactions: signals.compactions + 1 }
    emit({ kind: 'compact' })
    return result
  })

  on('turn.complete', async ($, e, next) => {
    setMood('idle')
    emit({ kind: 'turn.complete' })
    void refreshUsage($)
    return next(e)
  })
}
