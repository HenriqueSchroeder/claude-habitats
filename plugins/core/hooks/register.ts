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

let signals = fresh()
const listeners = new Set<HabitatListener>()
const scenes = new Set<string>()

function emit(event: HabitatEvent) {
  for (const listener of listeners) {
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
  const usage = await $.session.usage()
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

async function activate($: EngineInterface, scene: string | null) {
  signals = { ...signals, active: scene }
  await $.store.set('active', scene ?? 'none')
  if (scene === null) await $.theme.clear()
  emit({ kind: 'activate', scene })
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
    const keyOf = (scene: string) => `world:${scene}:${signals.repo ?? 'none'}`
    const habitat = {
      signals: () => signals,
      subscribe: (listener: HabitatListener) => {
        listeners.add(listener)
        return () => void listeners.delete(listener)
      },
      claim: async (scene: string) => {
        scenes.add(scene)
        const saved = await beneath.store.get('active')
        if (saved === 'none') return false
        // The first scene to load takes the backdrop until /habitat picks another.
        if (signals.active === null && (saved === undefined || saved === scene || !scenes.has(String(saved)))) {
          signals = { ...signals, active: scene }
        }
        return signals.active === scene
      },
      load: (scene: string) => beneath.store.get(keyOf(scene)),
      save: (scene: string, data: unknown) => beneath.store.set(keyOf(scene), data),
      rnd: (seed: number, salt = 0) => {
        const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453
        return x - Math.floor(x)
      },
      phase: (now: number, seconds: number) => `-${((now / 1000) % seconds).toFixed(2)}s`,
      svg: (body: string, style = '') =>
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice"><style>${style}</style>${body}</svg>`,
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

  on('turn.start', (_, e, next) => {
    signals = { ...signals, turns: signals.turns + 1 }
    setMood('thinking')
    emit({ kind: 'turn.start' })
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const category = categoryOf(e.tool)
    setMood('tool')
    const input = (e as { input?: { file_path?: unknown } }).input
    const path = typeof input?.file_path === 'string' ? input.file_path : undefined
    const root = signals.repo
    const file = path !== undefined && root !== null && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
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
      setMood('thinking')
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
    await refreshUsage($)
    return next(e)
  })
}
