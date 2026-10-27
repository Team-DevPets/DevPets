// 작업 상태 합치기 — 순수 로직 (Electron 없이 테스트할 수 있게 분리)
//
// 상태 출처(entry)는 세 종류다.
//   - Claude Code · Codex hooks 가 쓰는 세션 파일      source: 'Claude Code' | 'Codex'
//   - Claude 앱 · ChatGPT 앱 화면 감지                 source: 'Claude 앱' | 'ChatGPT 앱'
//   - ChatGPT(Codex) 앱이 직접 남기는 작업 기록        source: 'Codex 앱'   (codex-sessions.js)
//   - 외부 프로그램이 쓰는 status.json                 source: ''
// entry = { mood: 'idle'|'working'|'waiting'|'done'|'error', detail, at, source }
//
// 여기서 두 가지를 계산한다.
//   1. 캐릭터 전체 기분 (aggregateMood): 가장 급한 상태 하나
//   2. AI(provider)별 상태 (createProviderTracker): Claude·GPT 각각의 상태, 언제부터인지, 상태가 바뀌는 순간의 이벤트

const MOODS = ['idle', 'working', 'waiting', 'done', 'error']
// 이 시간이 지나도록 소식이 없으면 쉬는 것으로 본다.
const STALE_MS = { working: 5 * 60 * 1000, waiting: 2 * 60 * 60 * 1000, error: 2 * 60 * 60 * 1000, done: 5 * 60 * 1000 }
// 캐릭터 기분 우선순위: 확인 대기 > 오류 > 작업 중 > 완료
const MOOD_PRIORITY = ['waiting', 'error', 'working', 'done']

const PROVIDERS = [
  { id: 'claude', label: 'Claude', surfaces: { 'Claude 앱': 'app', 'Claude Code': 'cli' } },
  { id: 'gpt', label: 'GPT', surfaces: { 'ChatGPT 앱': 'app', 'Codex 앱': 'app', Codex: 'cli' } },
]
const PROVIDER_OF = {}
for (const p of PROVIDERS) for (const source of Object.keys(p.surfaces)) PROVIDER_OF[source] = p.id

// AI별 표시에서 '완료'는 잠깐 축하하고 사라지는 상태다.
const DONE_SHOW_MS = 4000

function isFresh(entry, now) {
  return MOODS.includes(entry.mood) && entry.mood !== 'idle' && now - entry.at <= STALE_MS[entry.mood]
}

function newest(list) {
  return list.reduce((a, b) => (b.at > a.at ? b : a))
}

// 캐릭터 전체 기분 — 가장 급한 상태 하나와 그 출처들
function aggregateMood(entries, now = Date.now()) {
  const fresh = entries.filter(e => isFresh(e, now))
  for (const mood of MOOD_PRIORITY) {
    const list = fresh.filter(e => e.mood === mood)
    if (!list.length) continue
    const top = newest(list)
    return { mood, detail: top.detail || '', at: top.at, sessions: list.length, sources: [...new Set(list.map(e => e.source).filter(Boolean))] }
  }
  return { mood: 'idle', detail: '', at: 0, sessions: 0, sources: [] }
}

// 한 AI의 지금 상태 (여러 출처 중 가장 급한 것)
function providerState(entries, providerId, now) {
  const mine = entries.filter(e => PROVIDER_OF[e.source] === providerId && isFresh(e, now))
  for (const state of MOOD_PRIORITY) {
    let list = mine.filter(e => e.mood === state)
    if (state === 'done') list = list.filter(e => now - e.at <= DONE_SHOW_MS)
    if (!list.length) continue
    const top = newest(list)
    return {
      state,
      detail: top.detail || '',
      source: top.source,
      project: top.project || '',
      sessionId: top.sessionId || '',
      cwd: top.cwd || '',
      since: top.since || top.at,
      duration: top.duration || 0,
      sources: [...new Set(list.map(e => e.source))],
    }
  }
  return { state: 'idle', detail: '', source: '', sources: [] }
}

// AI별 상태를 시간에 따라 추적한다. update()는 매번 지금 상태와, 직전 호출 이후 생긴 이벤트를 돌려준다.
//   provider: { id, label, state, since(그 상태가 시작된 시각), jobStart(이번 작업 시작), detail, source, sources, surfaces: ['app'|'cli'] }
//   event:    { type: 'done', provider, label, source, duration } | { type: 'waiting'|'error', provider, label, source, detail }
function createProviderTracker() {
  const prev = {}
  return {
    update(entries, now = Date.now()) {
      const providers = []
      const events = []
      for (const p of PROVIDERS) {
        const cur = providerState(entries, p.id, now)
        const before = prev[p.id] || { state: 'idle', since: now, source: '', jobStart: 0, project: '', sessionId: '' }
        let since = before.since
        // 한 작업의 시작 시각: 쉬다가(또는 완료 후) 일을 시작한 순간. 중간에 승인 대기가 끼어도 이어서 잰다.
        let jobStart = before.jobStart
        const newSession = !!cur.sessionId && cur.sessionId !== before.sessionId
        if (cur.state !== before.state) {
          since = now
          const busy = state => state === 'working' || state === 'waiting' || state === 'error'
          if (busy(cur.state) && !busy(before.state)) jobStart = now
        }
        if (cur.state === 'done' && (before.state === 'working' || (before.state === 'done' && newSession))) {
          events.push({ type: 'done', provider: p.id, label: p.label, source: cur.source || before.source, project: cur.project || before.project, sessionId: cur.sessionId || before.sessionId, cwd: cur.cwd || (cur.sessionId === before.sessionId ? before.cwd : ''), duration: cur.duration || now - (jobStart || cur.since || before.since) })
        }
        if ((cur.state === 'waiting' || cur.state === 'error') && (cur.state !== before.state || newSession)) {
          events.push({ type: cur.state, provider: p.id, label: p.label, source: cur.source, project: cur.project, sessionId: cur.sessionId, cwd: cur.cwd, detail: cur.detail })
        }
        prev[p.id] = {
          state: cur.state,
          since,
          source: cur.state === 'idle' ? '' : (cur.source || before.source),
          project: cur.state === 'idle' ? '' : (cur.project || before.project),
          sessionId: cur.state === 'idle' ? '' : (cur.sessionId || before.sessionId),
          cwd: cur.cwd || '',
          jobStart: cur.state === 'idle' ? 0 : jobStart,
        }
        if (cur.state !== 'idle') {
          providers.push({
            id: p.id,
            label: p.label,
            state: cur.state,
            since,
            jobStart,
            detail: cur.detail,
            source: cur.source,
            project: cur.project,
            sessionId: cur.sessionId,
            duration: cur.duration,
            sources: cur.sources,
            surfaces: [...new Set(cur.sources.map(s => p.surfaces[s]).filter(Boolean))],
          })
        }
      }
      return { providers, events }
    },
  }
}

// 2분 13초 / 45초
function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60
  if (h) return `${h}시간 ${m}분`
  if (m) return s ? `${m}분 ${s}초` : `${m}분`
  return `${s}초`
}

module.exports = { MOODS, STALE_MS, MOOD_PRIORITY, PROVIDERS, PROVIDER_OF, DONE_SHOW_MS, aggregateMood, providerState, createProviderTracker, formatDuration }
