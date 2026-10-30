// node --test test/  (Electron 없이 실행)
const test = require('node:test')
const assert = require('node:assert/strict')
const { aggregateMood, createProviderTracker, formatDuration, DONE_SHOW_MS } = require('../llm-status')

const T0 = 1_800_000_000_000
const e = (source, mood, at, detail = '') => ({ source, mood, at, detail })

test('캐릭터 기분은 가장 급한 상태 (대기 > 오류 > 작업 > 완료)', () => {
  const entries = [e('Claude 앱', 'working', T0), e('Codex', 'waiting', T0 - 1000, 'Bash 허용할까?'), e('Claude Code', 'done', T0)]
  const r = aggregateMood(entries, T0)
  assert.equal(r.mood, 'waiting')
  assert.equal(r.detail, 'Bash 허용할까?')
  assert.deepEqual(r.sources, ['Codex'])
})

test('오래된 상태는 무시 (작업 5분, 대기 2시간)', () => {
  assert.equal(aggregateMood([e('Claude Code', 'working', T0 - 6 * 60_000)], T0).mood, 'idle')
  assert.equal(aggregateMood([e('Claude Code', 'waiting', T0 - 60 * 60_000)], T0).mood, 'waiting')
})

test('AI별 상태: Claude 작업 중, GPT 대기', () => {
  const t = createProviderTracker()
  const { providers } = t.update([e('Claude 앱', 'working', T0), e('ChatGPT 앱', 'waiting', T0, '승인')], T0)
  assert.deepEqual(providers.map(p => [p.id, p.state]), [['claude', 'working'], ['gpt', 'waiting']])
  assert.deepEqual(providers[0].surfaces, ['app'])
})

test('작업 → 완료 이벤트에 걸린 시간 (중간 승인 대기 포함)', () => {
  const t = createProviderTracker()
  t.update([e('Codex', 'working', T0)], T0)
  const w = t.update([e('Codex', 'waiting', T0 + 10_000, 'Bash 허용할까?')], T0 + 10_000)
  assert.equal(w.events[0].type, 'waiting')
  t.update([e('Codex', 'working', T0 + 20_000)], T0 + 20_000)
  const d = t.update([e('Codex', 'done', T0 + 95_000)], T0 + 95_000)
  assert.equal(d.events.length, 1)
  assert.equal(d.events[0].type, 'done')
  assert.equal(d.events[0].provider, 'gpt')
  assert.equal(d.events[0].duration, 95_000)
})

test('완료는 잠깐만 표시하고 사라짐', () => {
  const t = createProviderTracker()
  t.update([e('Claude Code', 'working', T0)], T0)
  assert.equal(t.update([e('Claude Code', 'done', T0 + 1000)], T0 + 1000).providers[0].state, 'done')
  assert.equal(t.update([e('Claude Code', 'done', T0 + 1000)], T0 + 1000 + DONE_SHOW_MS + 1).providers.length, 0)
})

test('같은 AI의 여러 출처: 앱이 일하고 CLI가 완료면 작업 중', () => {
  const t = createProviderTracker()
  const { providers } = t.update([e('Claude 앱', 'working', T0), e('Claude Code', 'done', T0)], T0)
  assert.equal(providers[0].state, 'working')
})

test('짧게 바뀐 상태는 이벤트를 한 번만', () => {
  const t = createProviderTracker()
  t.update([e('Claude 앱', 'working', T0)], T0)
  const a = t.update([e('Claude 앱', 'working', T0 + 1000)], T0 + 1000)
  assert.equal(a.events.length, 0)
})

test('시간 표시', () => {
  assert.equal(formatDuration(45_000), '45초')
  assert.equal(formatDuration(133_000), '2분 13초')
  assert.equal(formatDuration(120_000), '2분')
  assert.equal(formatDuration(3_900_000), '1시간 5분')
})


test('작업 목록은 같은 AI의 작업과 대기를 모두 집계하고 우선순위로 정렬한다', () => {
  const t = createProviderTracker()
  const entries = [
    { ...e('Codex', 'working', T0), taskId: 'codex:a' },
    { ...e('Codex', 'waiting', T0, '승인 필요'), taskId: 'codex:b' },
    { ...e('Claude Code', 'working', T0), taskId: 'claude:c' },
  ]
  const gpt = t.update(entries, T0).providers.find(p => p.id === 'gpt')
  assert.equal(gpt.state, 'waiting')
  assert.deepEqual(gpt.tasks.map(t => t.id), ['codex:b', 'codex:a'])
  assert.deepEqual(gpt.counts, { waiting: 1, error: 0, working: 1, done: 0 })
})

test('같은 Codex 세션의 hook과 기록은 중복 집계하지 않고 승인 대기를 보존한다', () => {
  const t = createProviderTracker()
  const result = t.update([
    { ...e('Codex', 'waiting', T0), taskId: 'codex:a' },
    { ...e('Codex 앱', 'working', T0 + 1000), taskId: 'codex:a', since: T0 - 5000 },
  ], T0 + 1000).providers[0]
  assert.equal(result.tasks.length, 1)
  assert.equal(result.tasks[0].state, 'waiting')
  assert.equal(result.counts.working, 0)
})

test('작업 시간은 도구 신호가 갱신돼도 유지하고 새 작업은 다시 잰다', () => {
  const t = createProviderTracker()
  const entry = (mood, at) => ({ ...e('Claude Code', mood, at), taskId: 'claude:a' })
  t.update([entry('working', T0)], T0)
  const updated = t.update([entry('working', T0 + 1000)], T0 + 1000)
  assert.equal(updated.providers[0].tasks[0].since, T0)
  t.update([entry('done', T0 + 2000)], T0 + 2000)
  assert.equal(t.update([entry('working', T0 + 3000)], T0 + 3000).providers[0].tasks[0].since, T0 + 3000)
})

test('오래된 세션과 표시 시간이 지난 완료는 작업 목록에서 빠진다', () => {
  const t = createProviderTracker()
  const result = t.update([
    { ...e('Codex', 'working', T0), taskId: 'codex:active' },
    { ...e('Codex', 'working', T0 - 360000), taskId: 'codex:old' },
    { ...e('Codex', 'done', T0 - DONE_SHOW_MS - 1), taskId: 'codex:done' },
  ], T0).providers[0]
  assert.deepEqual(result.tasks.map(t => t.id), ['codex:active'])
})
