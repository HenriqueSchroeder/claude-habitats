import { expect, test } from 'claude-code/testing'

import { applyEvent, createCity, loadCity, mergeCity, renderCity, saveCity } from './city'

const calm = { context: 0.1, rateLimit: 0.2, costUsd: 1, shell: 0 }
const edit = (file: string, isError = false) => ({ kind: 'tool' as const, category: 'edit', file, isError })

test('each edited file raises one building, and edits make it taller', () => {
  const city = createCity()
  applyEvent(city, edit('hooks/a.ts'), 1000)
  applyEvent(city, edit('hooks/a.ts'), 2000)
  applyEvent(city, edit('docs/b.md'), 3000)
  expect(city.buildings.length).toBe(2)
  expect(city.buildings.find(b => b.file === 'hooks/a.ts')?.edits).toBe(2)
  expect(city.buildings.find(b => b.file === 'docs/b.md')?.district).toBe('docs')
})

test('a failed edit builds nothing and sets a fire', () => {
  const city = createCity()
  applyEvent(city, edit('a.ts', true), 1000)
  expect(city.buildings.length).toBe(0)
  expect(city.pulses.map(p => p.kind)).toEqual(['fire'])
})

test('compaction turns the city historic, and a new edit renews a building', () => {
  const city = createCity()
  applyEvent(city, edit('a.ts'), 1000)
  applyEvent(city, { kind: 'compact' }, 2000)
  expect(city.buildings[0]?.historic).toBe(true)
  applyEvent(city, edit('a.ts'), 3000)
  expect(city.buildings[0]?.historic).toBe(false)
})

test('the saved world loads back, and junk loads as an empty city', () => {
  const city = createCity()
  applyEvent(city, edit('src/x.ts'), 1000)
  const loaded = loadCity(JSON.parse(JSON.stringify(saveCity(city))))
  expect(loaded.buildings.map(b => [b.file, b.edits])).toEqual([['src/x.ts', 1]])
  expect(loadCity(undefined).buildings.length).toBe(0)
  expect(loadCity({ buildings: [{ file: 1 }] }).buildings.length).toBe(0)
})

test('the city never outgrows its cap', () => {
  const city = createCity()
  for (let i = 0; i < 320; i++) applyEvent(city, edit(`d${i % 12}/f${i}.ts`), i)
  expect(city.buildings.length).toBe(300)
})

test('a crowded, stormy city still fits the Svg limit and has no NaN', () => {
  const city = createCity()
  for (let i = 0; i < 300; i++) applyEvent(city, edit(`d${i % 12}/f${i}.ts`), 0)
  const now = 5000
  for (const category of ['web', 'agent', 'read', 'shell']) applyEvent(city, { kind: 'tool', category, isError: false }, now)
  applyEvent(city, edit('x.ts', true), now)
  applyEvent(city, { kind: 'compact' }, now)
  for (const weather of [calm, { context: 1, rateLimit: null, costUsd: 40, shell: 500 }, { context: null, rateLimit: 1, costUsd: 0, shell: 0 }]) {
    const svg = renderCity(city, weather, now)
    expect(svg.length).toBeLessThan(131072)
    expect(svg.includes('NaN')).toBe(false)
  }
})

test('pulses fade once their time is up', () => {
  const city = createCity()
  applyEvent(city, { kind: 'tool', category: 'web', isError: false }, 0)
  expect(renderCity(city, calm, 1000).includes('class="plane"')).toBe(true)
  expect(renderCity(city, calm, 60_000).includes('class="plane"')).toBe(false)
})

test('two sessions saving the same repo keep each other\'s buildings', () => {
  const mine = createCity()
  applyEvent(mine, edit('a.ts'), 0)
  applyEvent(mine, edit('a.ts'), 0)
  const theirs = createCity()
  applyEvent(theirs, edit('a.ts'), 0)
  applyEvent(theirs, edit('b.ts'), 0)
  mergeCity(mine, loadCity(saveCity(theirs)))
  expect(mine.buildings.map(b => [b.file, b.edits]).sort()).toEqual([['a.ts', 2], ['b.ts', 1]])
})

test('a broken save never yields NaN heights', () => {
  const city = loadCity({ buildings: [{ file: 'a', district: '/', edits: Number.NaN }, { file: 'b', district: '/', edits: -2 }] })
  expect(city.buildings.length).toBe(0)
})

test('a fire stays on its building as the city grows', () => {
  const city = createCity()
  applyEvent(city, edit('a/x.ts'), 0)
  const change = applyEvent(city, edit('q.ts', true), 1)
  expect(change.fadesIn).toBe(20_000)
  expect(city.pulses[0]?.file).toBe('a/x.ts')
})
