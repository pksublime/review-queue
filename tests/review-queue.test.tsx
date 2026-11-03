import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

type Engine = Parameters<TestBody>[0]

const PANE = {
  plugin: 'review-queue',
  component: 'Pane',
  requestId: 'review-queue',
  props: {
    title: 'Review queue',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

const PR = { number: 7, title: 'Fix it', url: 'https://github.com/o/r/pull/7' }
const FINDINGS = [
  { file: 'a.ts', line: 1, summary: 'a is wrong', short_summary: 'a wrong', failure_scenario: 'x' },
  { file: 'b.ts', line: 2, summary: 'b is wrong', failure_scenario: 'y' },
]

const comment = (body: string, state = 'SUBMITTED', viewerDidAuthor = false) => ({
  author: { login: viewerDidAuthor ? 'me' : 'them' },
  body,
  url: `https://github.com/o/r/pull/7#${body}`,
  state,
  viewerDidAuthor,
})
const thread = (id: string, path: string, line: number, first: object, last = first, isResolved = false) => ({
  id,
  isResolved,
  path,
  line,
  originalLine: line,
  first: { nodes: [first] },
  last: { nodes: [last] },
})

type Fake = {
  threads?: object[]
  fail?: { exitCode: number; stderr: string }
  rejects?: boolean
}

// Stands for gh and the engine. Records every argv, so a test can say what was run.
function engine(on: On, fake: Fake, store: Record<string, unknown> = {}) {
  const argvs: (readonly string[])[] = []
  const prompts: string[] = []
  const clock = mock.clock(on)
  on('store.get', (_, e) => ({ value: store[e.key] }))
  on('store.set', (_, e) => {
    store[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    delete store[e.key]
    return { value: undefined }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  on('prompt.submit', (_, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  on('process.run', (_, e) => {
    argvs.push(e.argv)
    if (fake.rejects) throw new Error('not found')
    if (fake.fail) return { value: { ...fake.fail, stdout: '', isStdoutTruncated: false, isStderrTruncated: false } }
    const stdout = e.argv[1] === 'pr'
      ? JSON.stringify(PR)
      : JSON.stringify([
          { data: { repository: { pullRequest: { reviewThreads: { nodes: fake.threads ?? [] } } } } },
        ])
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { argvs, prompts, clock, store }
}

const start = ($: Engine) => $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
const run = ($: Engine, command: string, args = '') =>
  $.command.run({
    command,
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })

test('findings reported through ReportFindings land in the queue, once', async ($, on) => {
  engine(on, {})
  await start($)
  await $.tool.call({ tool: 'ReportFindings', findings: FINDINGS })
  await $.tool.call({ tool: 'ReportFindings', findings: FINDINGS })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /o\/r#7/ }))?.text).toBe('o/r#7 Fix it')
    expect((await ui.find({ type: 'Text', text: /a\.ts/ }))?.text).toBe('a.ts:1')
    expect((await ui.find({ type: 'Text', text: /a wrong/ }))?.text).toBe('a wrong')
    expect((await ui.find({ type: 'Text', text: /Not posted/ }))?.text).toContain('2 new, 0 drafted')
    await ui.unmount()
  }
})

test('/next-comment works one item at a time and marks it drafted', async ($, on) => {
  const { prompts, clock } = engine(on, {})
  await start($)
  await $.tool.call({ tool: 'ReportFindings', findings: FINDINGS })

  const first = await run($, 'next-comment')
  await clock.settle()
  expect(first.text).toBe('Item 1 of 2: a.ts:1')
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('a is wrong')
  expect(prompts[0]).not.toContain('b is wrong')
  expect(prompts[0]).toContain('Do not post')
  expect(prompts[0]).toContain('gh pr list --repo o/r --state open')

  const second = await run($, 'next-comment')
  await clock.settle()
  expect(second.text).toBe('Item 2 of 2: b.ts:2')
  expect(prompts.length).toBe(2)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Not posted/ }))?.text).toContain('0 new, 2 drafted')
  await ui.unmount()
})

test('/next-comment says so when nothing is open', async ($, on) => {
  const { prompts } = engine(on, {})
  await start($)
  await $.tool.call({ tool: 'ReportFindings', findings: [FINDINGS[0]!] })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'drop:finding:a.ts:1:a is wrong' })
  await ui.unmount()

  const done = await run($, 'next-comment')
  expect(done.text).toBe('Everything is done: 0 posted, 0 resolved, 1 dropped.')
  expect(prompts.length).toBe(0)
})

test('states come from GitHub: pending is drafted, submitted is posted, resolved wins', async ($, on) => {
  const threads = [
    thread('open', 'c.ts', 3, comment('please fix')),
    thread('pending', 'd.ts', 4, comment('why'), comment('because', 'PENDING', true)),
    thread('replied', 'e.ts', 5, comment('why'), comment('because', 'SUBMITTED', true)),
    thread('done', 'f.ts', 6, comment('nit'), comment('nit'), true),
    // Patrick's own thread at a finding's line is that finding, not a second row.
    thread('mine', 'a.ts', 1, comment('a is wrong', 'SUBMITTED', true)),
  ]
  engine(on, { threads })
  await start($)
  await $.tool.call({ tool: 'ReportFindings', findings: [FINDINGS[0]!] })
  await run($, 'review-queue')

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Not posted/ }))?.text).toBe(
    'Not posted yet: 1 new, 1 drafted. Done: 2 posted, 1 resolved, 0 dropped.',
  )
  await ui.unmount()
})

// Written by the first test, read by the second: each test starts with $.state
// empty, as a session started after a restart does.
const kept: Record<string, unknown> = {}

test('one session works the queue and the store keeps it', async ($, on) => {
  const { clock } = engine(on, {}, kept)
  await start($)
  await $.tool.call({ tool: 'ReportFindings', findings: FINDINGS })
  await run($, 'next-comment')
  await clock.settle()
  expect(Object.keys(kept)).toEqual(['queue-1:o/r#7'])
})

test('the next session picks up that PR where it stopped', async ($, on) => {
  const { prompts, clock } = engine(on, {}, kept)
  await start($)

  const next = await run($, 'next-comment')
  await clock.settle()
  expect(next.text).toBe('Item 2 of 2: b.ts:2')
  expect(prompts.length).toBe(1)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Not posted/ }))?.text).toContain('0 new, 2 drafted')
  await ui.unmount()
})

test('a value an earlier version stored in state is declined', async ($, on) => {
  on('state.get', { key: 'queue' }, () => ({ value: { value: { items: [{ nope: 1 }] }, version: 1 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Nothing/ }))?.text).toBe('Nothing in the queue.')
  await ui.unmount()
})

test('gh missing, or not signed in, says so in the pane and keeps the findings', async ($, on) => {
  const fake: Fake = { rejects: true }
  engine(on, fake)
  await start($)
  await $.tool.call({ tool: 'ReportFindings', findings: FINDINGS })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Could not run gh/ }))?.text).toContain('cli.github.com')
  expect((await ui.find({ type: 'Text', text: /Not posted/ }))?.text).toContain('2 new')
  await ui.unmount()

  delete fake.rejects
  fake.fail = { exitCode: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login' }
  const said = await run($, 'review-queue')
  expect(said.text).toContain('gh auth login')
})

test('findings kept with no PR move into the PR once it is known', async ($, on) => {
  const fake: Fake = { fail: { exitCode: 1, stderr: 'no pull requests found for branch "x"' } }
  const { store } = engine(on, fake)
  await start($)
  await $.tool.call({ tool: 'ReportFindings', findings: FINDINGS })

  delete fake.fail
  const said = await run($, 'review-queue', '7')
  expect(said.text).toContain('o/r#7: Not posted yet: 2 new')
  expect(Object.keys(store)).toEqual(['queue-1:o/r#7'])
})

test('every gh call only reads', async ($, on) => {
  const { argvs } = engine(on, { threads: [thread('open', 'c.ts', 3, comment('please fix'))] })
  await start($)
  await $.tool.call({ tool: 'ReportFindings', findings: FINDINGS })
  await run($, 'review-queue')
  await run($, 'next-comment')

  expect(argvs.length).toBeGreaterThan(0)
  for (const argv of argvs) {
    const isPrView = argv[1] === 'pr' && argv[2] === 'view'
    const query = argv.find(arg => arg.startsWith('query='))
    const isQuery = argv[1] === 'api' && argv[2] === 'graphql' && !!query && !/mutation/.test(query)
    expect(isPrView || isQuery).toBe(true)
  }
})

test('a bad PR argument never reaches gh', async ($, on) => {
  const { argvs } = engine(on, {})
  await start($)
  const said = await run($, 'review-queue', '--repo x')
  expect(said.text).toContain('Usage')
  expect(argvs.length).toBe(0)
})
