// An isometric city that builds itself from the session: one building per edited file,
// grouped in districts by top-level folder. Pure: the world in, an SVG string out.

export type Building = { file: string; district: string; edits: number; born: number; historic: boolean }

export type City = { buildings: Building[]; pulses: Pulse[] }

export type PulseKind = 'web' | 'agent' | 'read' | 'shell' | 'fire' | 'compact'
// A fire keeps to the building it started in, even as the city grows around it.
type Pulse = { kind: PulseKind; at: number; file?: string }

// What the city reads from the core's signals.
export type Weather = { context: number | null; rateLimit: number | null; costUsd: number; shell: number }

export type CityEvent =
  | { kind: 'tool'; category: string; file?: string; isError: boolean }
  | { kind: 'compact' }
  | { kind: 'usage' }

const MAX_BUILDINGS = 300
// How long a pulse stays drawn, in seconds.
const PULSE_SECONDS: Record<PulseKind, number> = { web: 10, agent: 9, read: 6, shell: 6, fire: 20, compact: 4 }

export const createCity = (): City => ({ buildings: [], pulses: [] })

export function loadCity(saved: unknown): City {
  const raw = (saved as { buildings?: unknown } | undefined)?.buildings
  if (!Array.isArray(raw)) return createCity()
  const buildings = raw
    .filter(
      (b): b is Building =>
        typeof b === 'object' &&
        b !== null &&
        typeof b.file === 'string' &&
        typeof b.district === 'string' &&
        Number.isFinite(b.edits) &&
        b.edits > 0,
    )
    .slice(-MAX_BUILDINGS)
  // Born long ago, so nothing replays its growth on load.
  return { buildings: buildings.map(b => ({ ...b, born: 0, historic: b.historic === true })), pulses: [] }
}

// Another session in the same repo may have saved since this one loaded: keep its buildings too.
export function mergeCity(city: City, saved: City) {
  for (const other of saved.buildings) {
    const mine = city.buildings.find(b => b.file === other.file)
    if (mine === undefined) city.buildings.unshift(other)
    else mine.edits = Math.max(mine.edits, other.edits)
  }
  if (city.buildings.length > MAX_BUILDINGS) city.buildings.splice(0, city.buildings.length - MAX_BUILDINGS)
}

export const saveCity = (city: City) => ({
  buildings: city.buildings.map(({ file, district, edits, historic }) => ({ file, district, edits, historic })),
})

const PULSED = new Set<string>(['web', 'agent', 'read', 'shell'])

const isLive = (p: Pulse, now: number) => now - p.at < PULSE_SECONDS[p.kind] * 1000

// What the event changed: whether to redraw and save, and when a pulse it started fades out.
export type Change = { redraw: boolean; save: boolean; fadesIn?: number }

export function applyEvent(city: City, event: CityEvent, now: number): Change {
  city.pulses = city.pulses.filter(p => isLive(p, now))
  const pulse = (kind: PulseKind, file?: string): Change => {
    city.pulses.push({ kind, at: now, file })
    return { redraw: true, save: false, fadesIn: PULSE_SECONDS[kind] * 1000 }
  }

  if (event.kind === 'usage') return { redraw: true, save: false }
  if (event.kind === 'compact') {
    for (const b of city.buildings) b.historic = true
    return { ...pulse('compact'), save: true }
  }
  if (event.isError) return pulse('fire', city.buildings[Math.floor(now) % Math.max(1, city.buildings.length)]?.file)
  if (event.category === 'edit' && event.file !== undefined) {
    const found = city.buildings.find(b => b.file === event.file)
    if (found !== undefined) {
      found.edits += 1
      found.historic = false
    } else {
      const parts = event.file.split('/')
      city.buildings.push({ file: event.file, district: parts.length > 1 ? (parts[0] ?? '/') : '/', edits: 1, born: now, historic: false })
      if (city.buildings.length > MAX_BUILDINGS) {
        // ponytail: drops the smallest building, oldest first, never the new one; a real zoning pass if repos outgrow 300 files.
        let smallest = 0
        for (let i = 1; i < city.buildings.length - 1; i++) {
          if ((city.buildings[i]?.edits ?? Infinity) < (city.buildings[smallest]?.edits ?? Infinity)) smallest = i
        }
        city.buildings.splice(smallest, 1)
      }
    }
    return { redraw: true, save: true }
  }
  if (!PULSED.has(event.category)) return { redraw: false, save: false }
  return pulse(event.category as PulseKind)
}

// Isometric projection: grid cell (gx, gy) at height z to screen pixels.
const TILE_W = 96
const TILE_H = 48
const OX = 800
const OY = 290
const GRID = 12
const ROADS = [3, 7]
const at = (gx: number, gy: number, z = 0): [number, number] => [OX + ((gx - gy) * TILE_W) / 2, OY + ((gx + gy) * TILE_H) / 2 - z]
const pt = ([x, y]: [number, number]) => `${x.toFixed(1)},${y.toFixed(1)}`
const poly = (points: [number, number][], fill: string, extra = '') => `<polygon points="${points.map(pt).join(' ')}" fill="${fill}"${extra}/>`

// Deterministic noise in [0, 1), so a redraw puts every star and tree back in place.
const rnd = (seed: number, salt = 0) => {
  const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453
  return x - Math.floor(x)
}
// A negative delay that keeps a CSS loop where it was before the redraw.
const phase = (now: number, seconds: number) => `-${((now / 1000) % seconds).toFixed(2)}s`

const hash = (text: string) => {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0
  return Math.abs(h)
}

// Blocks are 3x3 lots between the roads; the middle one holds the landmarks.
const BLOCKS = [0, 1, 2].flatMap(by => [0, 1, 2].map(bx => [bx * 4, by * 4] as const))
const CIVIC = 4
const LIBRARY: [number, number] = [4, 5]
const FACTORY: [number, number] = [6, 4]

type Lot = { gx: number; gy: number; edits: number; born: number; historic: boolean; district: string; files: string[] }

function zone(buildings: Building[]): Lot[] {
  const districts = [...new Set(buildings.map(b => b.district))]
  const homes = BLOCKS.filter((_, i) => i !== CIVIC)
  const lots = new Map<string, Lot>()
  const filled = new Map<number, number>()
  for (const b of buildings) {
    const block = districts.indexOf(b.district) % homes.length
    const n = filled.get(block) ?? 0
    filled.set(block, n + 1)
    const [bx, by] = homes[block] ?? [0, 0]
    // A full block stacks new files onto its lots, so busy districts grow up, not out.
    const gx = bx + (n % 9) % 3
    const gy = by + Math.floor((n % 9) / 3)
    const key = `${gx},${gy}`
    const lot = lots.get(key)
    if (lot === undefined) lots.set(key, { gx, gy, edits: b.edits, born: b.born, historic: b.historic, district: b.district, files: [b.file] })
    else
      lots.set(key, {
        ...lot,
        edits: lot.edits + b.edits,
        born: Math.max(lot.born, b.born),
        historic: lot.historic && b.historic,
        files: [...lot.files, b.file],
      })
  }
  return [...lots.values()]
}

const heightOf = (edits: number) => Math.min(250, 16 + 22 * Math.sqrt(edits))

// 0 at noon, 1 at night. The five-hour rate-limit window sets the hour when known.
function nightOf(rateLimit: number | null, now: number) {
  const hour = rateLimit === null ? new Date(now).getHours() + new Date(now).getMinutes() / 60 : 6 + rateLimit * 16
  if (hour >= 7 && hour <= 17) return 0
  if (hour > 17 && hour < 20) return (hour - 17) / 3
  if (hour > 5 && hour < 7) return 1 - (hour - 5) / 2
  return 1
}

type Rgb = [number, number, number]
const lerp = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map(i => a[i]! + (b[i]! - a[i]!) * t) as Rgb
const mix = (a: Rgb, b: Rgb, t: number) => `rgb(${lerp(a, b, t).map(Math.round).join(',')})`
const move = ([x, y]: [number, number]) => `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`

function box(gx: number, gy: number, h: number, colors: [string, string, string], inset = 0.15, extra = '') {
  const a = at(gx + inset, gy + inset)
  const b = at(gx + 1 - inset, gy + inset)
  const c = at(gx + 1 - inset, gy + 1 - inset)
  const d = at(gx + inset, gy + 1 - inset)
  const up = ([x, y]: [number, number]): [number, number] => [x, y - h]
  return (
    poly([d, c, up(c), up(d)], colors[1], extra) +
    poly([c, b, up(b), up(c)], colors[2], extra) +
    poly([up(a), up(b), up(c), up(d)], colors[0], extra)
  )
}

function windows(gx: number, gy: number, h: number, inset = 0.15) {
  const b = at(gx + 1 - inset, gy + inset)
  const c = at(gx + 1 - inset, gy + 1 - inset)
  const d = at(gx + inset, gy + 1 - inset)
  let path = ''
  for (let z = 12; z < h - 6; z += 13) {
    path += `M${pt([d[0] + 6, d[1] - z - 3])}L${pt([c[0] - 4, c[1] - z])}M${pt([c[0] + 4, c[1] - z])}L${pt([b[0] - 6, b[1] - z - 3])}`
  }
  return path
}

export function renderCity(city: City, weather: Weather, now: number): string {
  const pulses = city.pulses.filter(p => isLive(p, now))
  const night = nightOf(weather.rateLimit, now)
  const smog = (weather.context ?? 0) * 0.45
  const shade = 1 - night * 0.55
  const parts: string[] = []
  const styles: string[] = []

  // Sky: day blue to night navy, browner as the context window fills.
  const top = mix(lerp([96, 165, 235], [8, 12, 34], night), [120, 104, 80], smog * 0.6)
  const low = mix(lerp([200, 225, 245], [36, 34, 70], night), [170, 140, 100], smog * 0.8)
  parts.push(
    `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${low}"/></linearGradient></defs>`,
    `<rect width="1600" height="1000" fill="url(#sky)"/>`,
  )
  if (night > 0.4) {
    let stars = ''
    for (let i = 0; i < 50; i++) stars += `<circle cx="${(rnd(i, 1) * 1600).toFixed(0)}" cy="${(rnd(i, 2) * 260).toFixed(0)}" r="${(1 + rnd(i, 3)).toFixed(1)}"/>`
    parts.push(`<g fill="#fff" opacity="${((night - 0.4) * (1 - smog)).toFixed(2)}">${stars}</g>`)
    parts.push(`<circle cx="1330" cy="120" r="34" fill="#f4eed8" opacity="${night.toFixed(2)}"/>`)
  } else {
    parts.push(`<circle cx="1300" cy="${(130 + night * 200).toFixed(0)}" r="46" fill="#fff4c2" opacity=".9"/>`)
  }

  // Far skyline: its lights are what the session has cost.
  let skyline = ''
  let skylights = ''
  const lights = Math.min(90, Math.round(weather.costUsd * 12))
  for (let i = 0; i < 40; i++) {
    const x = i * 40
    const h = 30 + rnd(i, 7) * 90
    skyline += `<rect x="${x}" y="${(330 - h).toFixed(0)}" width="38" height="${h.toFixed(0)}"/>`
    if (i < lights) skylights += `<rect x="${x + 8 + rnd(i, 8) * 20}" y="${(336 - h * rnd(i, 9)).toFixed(0)}" width="3" height="3"/>`
  }
  parts.push(`<g fill="${mix([70, 90, 120], [16, 20, 44], night)}" opacity=".85">${skyline}</g>`)
  parts.push(`<g fill="#ffe7a3" opacity="${(0.25 + night * 0.75).toFixed(2)}">${skylights}</g>`)

  // A plane lands for each web call.
  for (const p of pulses.filter(p => p.kind === 'web')) {
    parts.push(
      `<g class="plane" style="animation-delay:-${((now - p.at) / 1000).toFixed(2)}s"><path d="M0 0l34 -4l6 -8h6l-3 9l18 -2l4 -6h4l-2 8l-4 3l-60 4z" fill="#e8eef7"/><circle cx="2" cy="0" r="2" fill="#ff5d5d" class="blink"/></g>`,
    )
  }

  // Ground, roads and the lots.
  const grass = mix([96, 140, 78], [24, 40, 34], night)
  parts.push(poly([at(-0.5, -0.5), at(GRID + 0.5, -0.5), at(GRID + 0.5, GRID + 0.5), at(-0.5, GRID + 0.5)], grass))
  const asphalt = mix([92, 96, 104], [34, 36, 46], night)
  for (const r of ROADS) {
    parts.push(poly([at(r, -0.5), at(r + 1, -0.5), at(r + 1, GRID + 0.5), at(r, GRID + 0.5)], asphalt))
    parts.push(poly([at(-0.5, r), at(GRID + 0.5, r), at(GRID + 0.5, r + 1), at(-0.5, r + 1)], asphalt))
  }

  // Traffic grows with the context window.
  const cars = Math.min(26, 4 + Math.round((weather.context ?? 0) * 22))
  for (let i = 0; i < cars; i++) {
    const road = i % 4
    const back = i % 8 >= 4
    const dur = 11 + rnd(i, 4) * 8
    styles.push(`.c${i}{animation:r${road}${back ? 'b' : ''} ${dur.toFixed(1)}s linear infinite;animation-delay:${phase(now + i * 3100, dur)}}`)
    parts.push(`<g class="c${i}"><rect x="-5" y="-3" width="10" height="6" rx="2" fill="${['#f2c14e', '#e45b5b', '#e8eef7', '#5bb3e4'][i % 4]}"/><circle r="2" cx="4" fill="#fff6b0" opacity="${night.toFixed(2)}"/></g>`)
  }
  ROADS.forEach((r, i) => {
    const [a0, a1] = [at(r + 0.5, -0.5), at(r + 0.5, GRID + 0.5)]
    const [b0, b1] = [at(-0.5, r + 0.5), at(GRID + 0.5, r + 0.5)]
    const kf = (name: string, from: [number, number], to: [number, number]) => `@keyframes ${name}{from{transform:${move(from)}}to{transform:${move(to)}}}`
    styles.push(kf(`r${i}`, a0, a1), kf(`r${i}b`, a1, a0), kf(`r${i + 2}`, b0, b1), kf(`r${i + 2}b`, b1, b0))
  })

  // An agent sends a truck down the main road.
  for (const p of pulses.filter(p => p.kind === 'agent')) {
    parts.push(
      `<g class="truck" style="animation-delay:-${((now - p.at) / 1000).toFixed(2)}s"><rect x="-12" y="-7" width="18" height="10" fill="#d9822b"/><rect x="6" y="-4" width="7" height="7" fill="#f4f4f4"/></g>`,
    )
  }
  styles.push(
    `.truck{animation:truck 9s linear both}@keyframes truck{from{transform:${move(at(3.5, -0.5))}}to{transform:${move(at(3.5, GRID + 0.5))}}}`,
  )

  // Buildings and landmarks, back to front.
  const lots = zone(city.buildings)
  type Piece = { depth: number; svg: string }
  const pieces: Piece[] = []
  const recent = (kind: PulseKind) => pulses.some(p => p.kind === kind)

  for (const lot of lots) {
    const h = heightOf(lot.edits)
    const hue = hash(lot.district) % 360
    const colors: [string, string, string] = lot.historic
      ? [`hsl(40 8% ${70 * shade}%)`, `hsl(40 6% ${54 * shade}%)`, `hsl(40 5% ${42 * shade}%)`]
      : [`hsl(${hue} 45% ${64 * shade}%)`, `hsl(${hue} 42% ${48 * shade}%)`, `hsl(${hue} 40% ${37 * shade}%)`]
    const [bx, by] = at(lot.gx + 0.5, lot.gy + 0.85)
    const growing = now - lot.born < 1600
    // Windows go with their building, so the ones in front still cover them.
    const body = box(lot.gx, lot.gy, h, colors) + `<path d="${windows(lot.gx, lot.gy, h)}" class="win"/>`
    pieces.push({
      depth: lot.gx + lot.gy,
      svg: growing
        ? `<g class="grow" style="transform-origin:${bx.toFixed(0)}px ${by.toFixed(0)}px;animation-delay:-${((now - lot.born) / 1000).toFixed(2)}s">${body}</g>`
        : body,
    })
  }

  // Lots nobody has built on yet keep their trees.
  const used = new Set(lots.map(l => `${l.gx},${l.gy}`))
  BLOCKS.forEach(([bx, by], block) => {
    if (block === CIVIC) return
    for (let i = 0; i < 9; i++) {
      const gx = bx + (i % 3)
      const gy = by + Math.floor(i / 3)
      if (used.has(`${gx},${gy}`) || rnd(gx * 13 + gy, 5) < 0.45) continue
      const [x, y] = at(gx + 0.5, gy + 0.5)
      pieces.push({
        depth: gx + gy,
        svg: `<rect x="${x - 2}" y="${y - 16}" width="4" height="14" fill="#5a3d24"/><circle cx="${x}" cy="${y - 22}" r="11" fill="${mix([60, 120, 60], [20, 52, 34], night)}"/>`,
      })
    }
  })

  // The library glows while Claude reads; the factory smokes with the shell.
  const [lx, ly] = LIBRARY
  pieces.push({
    depth: lx + ly,
    svg:
      box(lx, ly, 46, [`hsl(40 30% ${88 * shade}%)`, `hsl(40 20% ${70 * shade}%)`, `hsl(40 18% ${58 * shade}%)`], 0.08) +
      `<path d="${windows(lx, ly, 46, 0.08)}" class="lib${recent('read') ? ' reading' : ''}" stroke-width="5" stroke-dasharray="4 7"/>`,
  })
  const [fx, fy] = FACTORY
  const smoke = 2 + Math.min(6, Math.round(Math.log2(1 + weather.shell))) + (recent('shell') ? 3 : 0)
  const [sx, sy] = at(fx + 0.75, fy + 0.3, 110)
  let puffs = ''
  for (let i = 0; i < smoke; i++) {
    puffs += `<circle class="puff" cx="${sx.toFixed(0)}" cy="${sy.toFixed(0)}" r="9" style="animation-delay:${phase(now + i * (6000 / smoke), 6)}"/>`
  }
  pieces.push({
    depth: fx + fy,
    svg:
      box(fx, fy, 40, [`hsl(8 30% ${46 * shade}%)`, `hsl(8 32% ${34 * shade}%)`, `hsl(8 34% ${26 * shade}%)`], 0.06) +
      box(fx + 0.6, fy + 0.15, 110, [`hsl(8 10% ${40 * shade}%)`, `hsl(8 10% ${30 * shade}%)`, `hsl(8 10% ${22 * shade}%)`], 0.3) +
      `<g fill="${mix([200, 200, 200], [90, 90, 100], night)}">${puffs}</g>`,
  })

  pieces.sort((a, b) => a.depth - b.depth)
  parts.push(...pieces.map(p => p.svg))

  // A failed tool sets a building alight.
  for (const p of pulses.filter(p => p.kind === 'fire')) {
    const lot = lots.find(l => p.file !== undefined && l.files.includes(p.file))
    const [x, y] = lot === undefined ? at(fx + 0.5, fy + 0.5, 40) : at(lot.gx + 0.5, lot.gy + 0.5, heightOf(lot.edits))
    parts.push(
      `<g style="transform:translate(${x.toFixed(0)}px,${y.toFixed(0)}px)"><ellipse class="flame" rx="14" ry="24" cy="-18" fill="#ff7a1a"/><ellipse class="flame f2" rx="8" ry="15" cy="-12" fill="#ffd34d"/></g>`,
    )
  }

  // Smog over everything as the context fills, and a flash of clean air on compaction.
  if (smog > 0.02) parts.push(`<rect width="1600" height="1000" fill="#8c7a58" opacity="${(smog * 0.5).toFixed(2)}"/>`)
  for (const p of pulses.filter(p => p.kind === 'compact')) {
    parts.push(`<rect width="1600" height="1000" fill="#fff" class="flash" style="animation-delay:-${((now - p.at) / 1000).toFixed(2)}s"/>`)
  }

  styles.push(
    `.win{fill:none;stroke:#ffd98a;stroke-width:4;stroke-dasharray:5 6;opacity:${(0.08 + night * 0.8).toFixed(2)}}`,
    `.lib{fill:none;stroke:#ffe9a8;opacity:${(0.2 + night * 0.5).toFixed(2)}}`,
    '.reading{animation:read 1.2s ease-in-out infinite alternate}@keyframes read{from{opacity:.4}to{opacity:1}}',
    '.puff{animation:puff 6s ease-out infinite}@keyframes puff{from{transform:translate(0,0) scale(.5);opacity:.8}to{transform:translate(60px,-150px) scale(3);opacity:0}}',
    '.puff{transform-box:fill-box;transform-origin:center}',
    '.grow{animation:grow 1.6s cubic-bezier(.2,.8,.3,1) both}@keyframes grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}',
    '.plane{animation:fly 10s linear both}@keyframes fly{from{transform:translate(1700px,120px)}to{transform:translate(-120px,250px)}}',
    '.blink{animation:blink 1s steps(2) infinite}@keyframes blink{50%{opacity:0}}',
    '.flame{transform-box:fill-box;transform-origin:bottom;animation:flick .4s ease-in-out infinite alternate}.f2{animation-duration:.3s}',
    '@keyframes flick{from{transform:scale(.85,1)}to{transform:scale(1.1,1.2)}}',
    '.flash{animation:flash 4s ease-out both}@keyframes flash{from{opacity:.7}to{opacity:0}}',
  )

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice"><style>${styles.join('')}</style>${parts.join('')}</svg>`
}
