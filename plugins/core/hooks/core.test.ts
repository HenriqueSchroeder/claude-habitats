import { expect, test, type TestBody } from 'claude-code/testing'

import { claims } from './register'

const REPO = { root: '/work/repo', remote: null, internal: false, name: 'repo' }

const habitat = async ($: Parameters<TestBody>[0]) => {
  const result = await $.command.run({
    command: 'habitat',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  return 'text' in result ? String(result.text) : ''
}

test('edits inside the repo are counted, ones outside are not, and the mood settles', async ($, on) => {
  on('session.repo', () => ({ value: REPO }))
  on('command.register', () => ({ value: { command: 'habitat' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: REPO.root, surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: '/work/repo/hooks/a.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Edit', file_path: '/work/repo/hooks/a.ts', old_string: 'b', new_string: 'c' })
  await $.tool.call({ tool: 'Write', file_path: '/tmp/elsewhere.ts', content: '' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })

  const text = await habitat($)
  expect(text).toContain('Repo: /work/repo')
  expect(text).toContain('Tools: edit 3, shell 1')
  expect(text).toContain('Files edited: 1')
  expect(text).toContain('mood thinking')
})

test('a refused tool counts as an error', async ($, on) => {
  on('session.repo', () => ({ value: REPO }))
  on('command.register', () => ({ value: { command: 'habitat' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ deny: 'no' }))

  await $.session.start({ cwd: REPO.root, surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: '/work/repo/a.ts', old_string: 'a', new_string: 'b' })

  const text = await habitat($)
  expect(text).toContain('errors 1')
  expect(text).toContain('Files edited: 0')
})

test('the picked scene wins; with no pick, the first to load', () => {
  expect(claims('tree', null, 'city')).toBe(false)
  expect(claims('tree', null, 'tree')).toBe(true)
  expect(claims('tree', 'city', 'tree')).toBe(true)
  expect(claims(undefined, null, 'city')).toBe(true)
  expect(claims(undefined, 'city', 'tree')).toBe(false)
  expect(claims('none', null, 'city')).toBe(false)
})
