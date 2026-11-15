export type HabitatCategory = 'edit' | 'shell' | 'read' | 'web' | 'agent' | 'mcp' | 'other'

export type HabitatMood = 'idle' | 'thinking' | 'tool'

export type HabitatSignals = {
  /** The repository root, or null outside a git repository. */
  repo: string | null
  turns: number
  mood: HabitatMood
  tools: Record<HabitatCategory, number>
  errors: number
  compactions: number
  /** Edits per file this session, paths relative to the repo root. */
  files: Record<string, number>
  /** Context window fill, 0 to 1; null before the first response. */
  context: number | null
  costUsd: number
  /** Share of the five-hour rate limit used, 0 to 1; null when unknown. */
  rateLimit: number | null
  /** The scene that draws the backdrop now, or null when none does. */
  active: string | null
}

export type HabitatEvent =
  | { kind: 'turn.start' }
  | { kind: 'turn.complete' }
  | { kind: 'tool'; category: HabitatCategory; tool: string; file?: string; isError: boolean }
  | { kind: 'compact' }
  | { kind: 'usage' }
  | { kind: 'activate'; scene: string | null }

export type HabitatListener = (signals: HabitatSignals, event: HabitatEvent) => void

export type Habitat = {
  signals: () => HabitatSignals
  /** Calls the listener on every event; returns the unsubscribe. */
  subscribe: (listener: HabitatListener) => () => void
  /** A scene announces itself; true when it should draw the backdrop now. */
  claim: (scene: string) => Promise<boolean>
  /** The scene's saved world for the current repo. */
  load: (scene: string) => Promise<unknown>
  save: (scene: string, data: unknown) => Promise<void>
  /** Deterministic noise in [0, 1). */
  rnd: (seed: number, salt?: number) => number
  /** A negative animation-delay that keeps a CSS loop in phase across redraws. */
  phase: (now: number, seconds: number) => string
  /** A full-bleed 1600x1000 SVG document. */
  svg: (body: string, style?: string) => string
}

declare module 'claude-code' {
  interface EngineInterface {
    habitat: Habitat
  }
}
