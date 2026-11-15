import type { EngineInterface, Register, ThemeSetArgs, Timer } from 'claude-code'

import { applyEvent, loadCity, mergeCity, renderCity, saveCity, type City } from './city'

const SCENE = 'city'
const THEME: ThemeSetArgs = { backdrop: { scene: SCENE, glass: { blur: 18, tint: '#0b1224', opacity: 0.5 } } }
// A burst of parallel tool calls redraws once, not once per call.
const REDRAW_MS = 300

let city: City | null = null
// Calls into the core are async, so drawing reads the last signals the core sent.
let signals: Awaited<ReturnType<EngineInterface['habitat']['signals']>> | null = null
let redrawing: Timer | null = null

// Without habitat-core installed, $.habitat is missing and the call throws.
async function hasCore($: EngineInterface) {
  try {
    signals = await $.habitat.signals()
    return true
  } catch {
    return false
  }
}

async function show($: EngineInterface) {
  const set = await $.theme.set(THEME)
  if (!set.isDrawn) $.ui.toast(`habitat-city is set but not drawn: ${set.reason}`)
}

function redraw($: EngineInterface, delay = REDRAW_MS) {
  if (delay === REDRAW_MS && redrawing !== null) return
  const timer = $.clock.after(delay, () => {
    if (timer === redrawing) redrawing = null
    if (signals?.active === SCENE) $.ui.invalidate('ui.render')
  })
  if (delay === REDRAW_MS) redrawing = timer
}

async function persist($: EngineInterface) {
  if (city === null) return
  mergeCity(city, loadCity(await $.habitat.load(SCENE)))
  await $.habitat.save(SCENE, saveCity(city))
}

function listen($: EngineInterface) {
  $.habitat.subscribe(SCENE, (latest, event) => {
    signals = latest
    if (event.kind === 'activate') {
      if (event.scene === SCENE) void show($)
      else if (event.scene === null && event.previous === SCENE) void $.theme.clear()
      return
    }
    if (city === null || (event.kind !== 'tool' && event.kind !== 'compact' && event.kind !== 'usage')) return
    const change = applyEvent(city, event, Date.now())
    if (change.save) void persist($)
    if (change.redraw) redraw($)
    // Nothing else may redraw before a plane or a fire is done, so clear it when it is.
    if (change.fadesIn !== undefined) redraw($, change.fadesIn + 100)
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // The core sets the repo in its own session.start, so the city loads after it.
    const result = await next(e)
    if (!(await hasCore($))) {
      $.ui.toast('habitat-city needs habitat-core: install it from the same marketplace')
      return result
    }
    city = loadCity(await $.habitat.load(SCENE))
    listen($)
    const claimed = await $.habitat.claim(SCENE)
    signals = await $.habitat.signals()
    if (claimed) await show($)
    // The hour of the day moves the light even when nothing else happens.
    $.clock.every(60_000, () => redraw($))
    return result
  })

  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    if (e.props.plugin !== $.plugin.name || e.props.scene !== SCENE || city === null || signals === null) return next(e)
    if (e.surface !== 'desktop' && e.surface !== 'mobile') return next(e)
    const { Svg } = $.ui.resolve(e)
    const s = signals
    const weather = { context: s.context, rateLimit: s.rateLimit, costUsd: s.costUsd, shell: s.tools.shell }
    const count = city.buildings.length
    return <Svg source={renderCity(city, weather, Date.now())} alt={`A city of ${count} building${count === 1 ? '' : 's'}`} />
  })
}
