// 우사기 펫 설정 창(컨트롤센터)
// - main 이 보내는 상태(settings:state)를 받아 지금 화면을 HTML 문자열로 그리고, patch()로 바뀐 부분만 고친다.
//   (통째로 바꾸면 스위치가 움직이는 도중에 끊기고 키보드 포커스도 사라진다)
// - 우사기 그림은 펫과 같은 시트·같은 배율 규칙(쉬기 그림 키 기준)으로 canvas에 그린다.
'use strict'

const api = window.settings
// 화면에서 난 오류는 감지 기록(logs\app-watch.log)에 남긴다
window.addEventListener('error', e => { try { api.reportError(`${e.message} @${String(e.filename || '').split('/').pop()}:${e.lineno || ''}`) } catch {} })
window.addEventListener('unhandledrejection', e => { try { api.reportError(`unhandled ${e.reason && e.reason.message ? e.reason.message : e.reason}`) } catch {} })
let state = null
let sheet = null // { key, url, animations, refHeight, image }
let page = 'home'
const ui = { bubbleMode: 'ai', notifyKind: 'done', codexMsg: '', testMsg: '', testTimer: null }

const PAGES = [
  { id: 'home', label: '홈', icon: '<path d="M4 10.6 12 4l8 6.6V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1Z"/>' },
  { id: 'ai', label: 'AI 연결', icon: '<path d="M10 14a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7l-1.3 1.3"/><path d="M14 10a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 0 0 5.7 5.7l1.3-1.3"/>' },
  { id: 'bubble', label: '말풍선 설정', icon: '<path d="M6 5h12a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-7l-4.5 3v-3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z"/>' },
  { id: 'look', label: '모습·움직임', icon: '<path d="M4 7h9"/><path d="M17 7h3"/><circle cx="15" cy="7" r="2"/><path d="M4 17h3"/><path d="M11 17h9"/><circle cx="9" cy="17" r="2"/>' },
  { id: 'play', label: '상호작용', icon: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/>' },
  { id: 'notify', label: '알림', icon: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>' },
  { id: 'general', label: '일반', icon: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5"/><path d="M12 18.5V21"/><path d="M3 12h2.5"/><path d="M18.5 12H21"/><path d="m5.6 5.6 1.8 1.8"/><path d="m16.6 16.6 1.8 1.8"/><path d="m5.6 18.4 1.8-1.8"/><path d="m16.6 7.4 1.8-1.8"/>' },
]
const PROVIDER_NAME = { claude: 'Claude', gpt: 'GPT' }
const APP_NAME = { claude: 'Claude 앱', gpt: 'ChatGPT 앱' }
const MOOD_LABEL = { idle: '쉬는 중', working: '작업 중', waiting: '확인 대기', done: '완료', error: '오류' }
const MOOD_ANIM = { idle: 'idle', working: 'working', waiting: 'waiting', done: 'celebrate', error: 'error' }

// ---------- 작은 도우미 ----------
const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const svg = (body, size = 20, width = 1.75) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
const ICON_ARROW = '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>'
const ICON_OPEN = '<path d="M14 5h5v5"/><path d="m19 5-8 8"/><path d="M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4"/>'
const ICON_FOLDER = '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z"/>'
const ICON_CHECK = '<path d="m5 12.5 4.5 4.5L19 7.5"/>'
const LEAF = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#49382F" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20.5c0-4.2.3-7.6 1.4-10.3"/><path d="M13.3 10.4c.6-3 2.9-5 6.2-5.3-.2 3.4-2.4 5.7-6.2 5.3Z"/><path d="M12.6 13.2c-.9-2.6-3.1-4.1-6.1-3.9.4 2.9 2.6 4.6 6.1 3.9Z"/></svg>'
const GROUND = (w = 300) => `<svg class="ground" width="${w}" height="40" viewBox="0 0 300 40" style="bottom:14px" aria-hidden="true"><ellipse cx="150" cy="22" rx="62" ry="7" fill="#EAD39C" opacity=".75"/><path d="M14 25c40-3 78-1 118-2.5s96 1.5 154-.5" fill="none" stroke="#C9AE7A" stroke-width="1.6" stroke-linecap="round"/><path d="M40 24c-1-4-.5-7 1.5-9M44 24c.5-3 2-5 4-6" fill="none" stroke="#9DB585" stroke-width="1.6" stroke-linecap="round"/><path d="M252 23c0-3.5 1-6 3-7.5M256 23c1-2.5 2.5-4 4.5-4.5" fill="none" stroke="#9DB585" stroke-width="1.6" stroke-linecap="round"/></svg>`

function duration(ms) {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60
  if (h) return `${h}시간 ${m}분`
  if (m) return s ? `${m}분 ${s}초` : `${m}분`
  return `${s}초`
}
function clock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}
const joinNames = names => names.length > 1 ? `${names.slice(0, -1).join(', ')}와 ${names[names.length - 1]}` : names[0] || ''

const TOOL_LABEL = {
  Bash: '명령 실행', PowerShell: '명령 실행', shell: '명령 실행', exec_command: '명령 실행', local_shell: '명령 실행',
  Read: '파일 읽기', Write: '파일 쓰기', Edit: '파일 고치기', MultiEdit: '파일 고치기', NotebookEdit: '노트북 고치기', apply_patch: '파일 고치기',
  Grep: '내용 찾기', Glob: '파일 찾기', LS: '폴더 보기', WebSearch: '웹 검색', web_search: '웹 검색', WebFetch: '웹 페이지 읽기',
  Task: '도우미에게 맡기기', Agent: '도우미에게 맡기기', TodoWrite: '할 일 정리', TaskCreate: '할 일 정리', TaskUpdate: '할 일 정리',
  Skill: '스킬 쓰기', AskUserQuestion: '질문하기', ExitPlanMode: '계획 확인',
}
function prettyDetail(detail) {
  if (!detail) return ''
  const match = /^([A-Za-z][\w.-]*)( 허용할까\?)?$/.exec(detail.trim())
  if (!match) return detail
  const name = match[1]
  const mcp = /^mcp__.+?__(.+)$/.exec(name)
  const label = TOOL_LABEL[name] || (mcp ? mcp[1].replace(/[_-]+/g, ' ') : name)
  return label + (match[2] ? ' 해도 돼?' : '')
}

const sw = (checked, attrs, label, disabled = false) =>
  `<button class="switch" role="switch" aria-checked="${checked ? 'true' : 'false'}" aria-label="${esc(label)}" ${attrs}${disabled ? ' disabled' : ''}><span class="knob"></span></button>`
const pill = (kind, text) => `<span class="pill ${kind}"><span class="dot"></span>${esc(text)}</span>`
const row = (title, desc, control) => `<div class="row"><div class="row-text"><span class="row-title">${esc(title)}</span>${desc ? `<span class="row-desc">${esc(desc)}</span>` : ''}</div>${control}</div>`
const switchRow = (key, title, desc, disabled = false) => row(title, desc, sw(state.config[key], `data-set="${key}"`, title, disabled))

function avatar(id, cls = '') {
  const icon = state.icons && state.icons[id]
  if (icon && icon.url) return `<span class="av ${cls}${icon.dark ? ' dark' : ''}" aria-hidden="true"><img src="${icon.url}" alt=""></span>`
  return `<span class="av letter ${cls}" aria-hidden="true">${id === 'claude' ? 'C' : 'G'}</span>`
}
function mono(id, mood, x, y) {
  const icon = state.icons && state.icons[id]
  const face = icon && icon.url ? `<img src="${icon.url}" alt="">` : id === 'claude' ? 'C' : 'G'
  const flag = mood === 'waiting' ? '?' : mood === 'error' ? '!' : mood === 'done' ? '✓' : ''
  return `<div class="mono ${mood}${icon && icon.dark ? ' dark' : ''}" style="left:${x}%;top:${y}px" aria-hidden="true"><span class="ring"></span>${face}<span class="flag">${flag}</span></div>`
}
// 우사기 그림 자리. 실제 그리기는 drawSprites()가 한다.
const pet = (anim, height, bottom, label) => `<canvas data-anim="${anim}" data-h="${height}" style="bottom:${bottom}px" role="img" aria-label="${esc(label)}"></canvas>`
const bubble = (word, meaning, top) => `<div class="bubble" style="top:${top}px"><span class="w">${esc(word)}</span>${meaning ? `<span class="m">(${esc(meaning)})</span>` : ''}</div>`

// ---------- 연결 상태 ----------
function appConn(a) {
  if (!a.supported) return { kind: 'idle', text: 'Windows 전용' }
  if (!a.on) return { kind: 'idle', text: '꺼짐' }
  if (!a.watching) return { kind: 'error', text: '감지 다시 시작 중' }
  const info = a.info
  if (!info) return { kind: 'idle', text: '확인 중' }
  if (!info.app) return { kind: 'idle', text: '앱 꺼져 있음' }
  if (info.hidden && !info.window) return { kind: 'done', text: '연결됨 · 트레이에 있음' }
  return { kind: 'done', text: info.window ? '연결됨 · 창 찾음' : '연결됨' }
}
function hookConn(h) {
  if (!h.installed) return { kind: 'idle', text: '연결 안 됨' }
  // Codex는 hook을 신뢰(/hooks)해야 실행된다. 아직 소식을 한 번도 못 받았으면 확인을 부탁한다.
  if (!h.seen) return h.id === 'codex' ? { kind: 'waiting', text: '확인 필요' } : { kind: 'done', text: '연결됨' }
  return { kind: 'done', text: '작동 확인됨' }
}
// ChatGPT(Codex) 앱이 직접 남기는 작업 기록
function recordConn() {
  const c = state.codexSessions || {}
  if (!c.on) return { kind: 'idle', text: '꺼짐' }
  if (!c.rootFound) return { kind: 'idle', text: '기록 폴더 없음' }
  if (c.active) return { kind: 'working', text: `작업 중 ${c.active}개` }
  return { kind: 'done', text: '연결됨' }
}
const timeOf = ms => { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
const hook = id => state.hooks.find(h => h.id === id)
const appOf = key => state.apps.find(a => a.key === key)
function codexNeedsTrust() {
  const c = hook('codex')
  return !!(c && c.installed && !c.seen)
}
function attentionCount() {
  return codexNeedsTrust() && !state.codexTrustDismissed ? 1 : 0
}

// ---------- 화면: 메뉴 ----------
function renderNav() {
  const count = attentionCount()
  const items = PAGES.map(p => `
    <button class="nav" data-nav="${p.id}"${page === p.id ? ' aria-current="page"' : ''} title="${esc(p.label)}">
      ${svg(p.icon)}<span class="label">${esc(p.label)}</span>
      ${p.id === 'ai' && count ? `<span class="badge mini" aria-label="확인할 연결 ${count}개">${count}</span>` : ''}
    </button>`).join('')
  const sizeLabel = (state.sizes.find(s => s.value === state.config.size) || {}).label || `${state.config.size}px`
  return `
  <nav class="side" aria-label="메뉴">
    <div class="brand">
      <div class="brand-mark">${LEAF}</div>
      <div class="brand-text"><span class="brand-name jua">${esc(state.name)} 펫</span><span class="brand-ver">버전 ${esc(state.version)}</span></div>
    </div>
    <div class="navlist">${items}</div>
    <div class="grow"></div>
    <div class="petcard">
      <div class="petcard-head"><span class="sdot" style="background:${state.petVisible ? '#4F7A35' : '#8C7C6E'}"></span>${state.petVisible ? '펫이 바탕화면에 있어요' : '펫이 숨어 있어요'}</div>
      <span class="sub">크기 ${esc(sizeLabel)} · 자동 산책 ${state.config.wander ? '켜짐' : '꺼짐'}</span>
      <button class="btn btn-secondary btn-sm" data-act="petVisible" data-arg="${state.petVisible ? 'false' : 'true'}">${state.petVisible ? '펫 숨기기' : '펫 보이기'}</button>
    </div>
  </nav>`
}

const header = (title, lead, extra = '') => `<header class="head"><div class="head-text"><h1>${esc(title)}</h1><p class="lead">${esc(lead)}</p></div>${extra}</header>`

// ---------- 화면: 홈 ----------
const HERO_WORD = {
  working: ['우냐!', '가자! AI가 일하는 중'],
  waiting: ['하아?', '이거 해도 돼? 확인해 줘!'],
  done: ['우~라~!!', '엄청나! 다 끝났어!'],
  error: ['하아?!', '뭐야, 오류 났어!'],
  idle: ['푸루루…', ''],
}

function heroInfo(now) {
  const status = state.status || { mood: 'idle', providers: [] }
  const providers = status.providers || []
  const mood = MOOD_LABEL[status.mood] ? status.mood : 'idle'
  const inMood = providers.filter(p => p.state === mood)
  const top = inMood[0] || providers[0]
  const since = p => now - (p.jobStart || p.since)
  const src = p => p.source || APP_NAME[p.id]
  const sources = status.sources || []
  const guess = sources.some(s => /ChatGPT|Codex/.test(s)) ? 'gpt' : 'claude'
  const info = { mood, top, primary: 'Claude 앱 열기', focus: mood === 'idle' ? 'claude' : guess }
  if (top) { info.primary = `${APP_NAME[top.id]} 열기`; info.focus = top.id }
  else if (mood !== 'idle') info.primary = `${APP_NAME[guess]} 열기`
  if (mood === 'working') {
    const names = inMood.map(p => PROVIDER_NAME[p.id])
    info.title = names.length ? `${joinNames(names)}가 일하는 중이에요` : '일하는 중이에요'
    info.meta = inMood.length ? inMood.map(p => `${src(p)} ${duration(since(p))}째`).join(' · ') : (sources.join(' · ') || '작업 소식을 받았어요')
    info.note = '다 끝나면 점프하고 알려 드릴게요. 다른 창에 있어도 괜찮아요.'
  } else if (mood === 'waiting') {
    info.title = top ? `${PROVIDER_NAME[top.id]}가 확인을 기다려요` : '확인을 기다려요'
    info.meta = top ? `${src(top)} · ${duration(since(top))}째` : ''
    const detail = prettyDetail(top ? top.detail : status.detail)
    info.note = detail ? `${detail} — 앱에서 확인해야 이어서 일할 수 있어요.` : '앱에서 확인 버튼을 눌러야 이어서 일할 수 있어요.'
    if (top) info.primary = '확인하러 가기'
  } else if (mood === 'done') {
    info.title = top ? `${PROVIDER_NAME[top.id]}가 다 끝냈어요` : '다 끝났어요'
    info.meta = top && top.jobStart ? `${src(top)} · ${duration(top.since - top.jobStart)} 걸렸어요` : (top ? src(top) : sources.join(' · ') || '방금 끝났어요')
    info.note = '결과를 확인해 보세요. 초록 표시는 잠시 뒤 사라져요.'
    if (top) info.primary = '결과 보러 가기'
  } else if (mood === 'error') {
    info.title = top ? `${PROVIDER_NAME[top.id]} 응답이 멈췄어요` : '오류가 났어요'
    info.meta = `${top ? src(top) + ' · ' : ''}${prettyDetail(top ? top.detail : status.detail) || '응답이 중단됐어요'}`
    info.note = '잠시 뒤 다시 보내거나, 앱에서 자세한 내용을 확인해 주세요.'
  } else {
    info.title = '지금은 조용해요'
    info.meta = '일하는 AI가 없어요'
    info.note = 'Claude나 GPT에 일을 맡기면 우사기가 바로 알려 드릴게요.'
  }
  return info
}

function providerCard(id, now) {
  const p = ((state.status && state.status.providers) || []).find(x => x.id === id)
  if (!p) {
    return { id, source: '쉬는 중', state: 'idle', time: '–', detail: '일을 맡기면 여기 표시돼요', action: '앱 열기' }
  }
  const elapsed = now - (p.jobStart || p.since)
  const card = { id, source: p.sources && p.sources.length ? p.sources.join(' · ') : (p.source || APP_NAME[id]), state: p.state }
  if (p.state === 'done') {
    card.time = p.jobStart ? clock(p.since - p.jobStart) : '–'
    card.detail = '걸린 시간'
    card.action = '결과 보기'
  } else {
    card.time = clock(elapsed)
    const detail = prettyDetail(p.detail)
    card.detail = p.state === 'working' ? (detail ? `지금 · ${detail}` : '지금 일하는 중') : p.state === 'waiting' ? (detail || '확인이 필요해요') : (detail || '응답이 중단됐어요')
    card.action = p.state === 'waiting' ? '확인하러 가기' : p.state === 'error' ? '앱에서 확인' : '앱으로 이동'
  }
  return card
}

function renderHome(now) {
  const hero = heroInfo(now)
  const [word, meaning] = HERO_WORD[hero.mood]
  const showMeaning = meaning && state.config.meaningAI
  const active = ((state.status && state.status.providers) || []).filter(p => p.state !== 'idle')
  const slots = { claude: [28, 150], gpt: [72, 184] }
  const monos = active.map(p => mono(p.id, p.state, slots[p.id][0], slots[p.id][1])).join('')
  const cards = ['claude', 'gpt'].map(id => {
    const c = providerCard(id, now)
    return `
    <article class="pcard">
      <div class="pcard-top">
        ${avatar(id)}
        <div class="row-text"><span style="font-size:16px;font-weight:700">${PROVIDER_NAME[id]}</span><span class="sub clip">${esc(c.source)}</span></div>
        ${pill(c.state, MOOD_LABEL[c.state])}
      </div>
      <div class="pcard-bottom">
        <div class="row-text"><span class="bigtime">${esc(c.time)}</span><span class="sub clip">${esc(c.detail)}</span></div>
        <button class="btn btn-quiet btn-sm" data-act="focus" data-arg="${id}">${esc(c.action)}</button>
      </div>
    </article>`
  }).join('')

  const conns = [
    ['Claude 앱', '답변 중인지 화면에서 확인해요', appConn(appOf('claude'))],
    ['ChatGPT 앱', '채팅과 Codex 화면을 함께 확인해요', appConn(appOf('chatgpt'))],
    ['ChatGPT 앱 작업 기록', '앱이 남기는 Codex 작업 기록을 바로 읽어요', recordConn()],
    ['Codex', codexNeedsTrust() ? 'Codex에서 /hooks로 한 번 신뢰해 주세요' : '터미널 작업을 알려 줘요', hookConn(hook('codex')), 'codex'],
    ['Claude Code', '터미널 작업을 알려 줘요 · Node.js 필요', hookConn(hook('claude')), 'claude'],
  ].map(([title, desc, conn, hookId]) => row(title, desc,
    hookId && conn.text === '연결 안 됨' ? `<button class="btn btn-secondary btn-sm" data-act="hooks" data-arg="${hookId}" data-arg2="true">연결하기</button>` : pill(conn.kind, conn.text))).join('')

  return `
  <div class="page">
    ${header('홈', 'AI가 일하는 동안 우사기가 곁에서 알려 줘요.', `<button class="btn btn-secondary" data-act="open" data-arg="pets">${svg(ICON_FOLDER, 18)}펫 시트 폴더 열기</button>`)}
    <section class="card big hero" aria-label="지금 상태">
      <div class="stage">
        ${bubble(word, showMeaning ? meaning : '', 24)}
        ${GROUND()}
        ${pet(MOOD_ANIM[hero.mood], 150, 36, `${MOOD_LABEL[hero.mood]}인 우사기`)}
        ${monos}
      </div>
      <div class="hero-body">
        <span style="align-self:flex-start">${pill(hero.mood, MOOD_LABEL[hero.mood])}</span>
        <div style="display:flex;flex-direction:column;gap:8px">
          <h2 class="h2-jua">${esc(hero.title)}</h2>
          <p class="meta">${esc(hero.meta)}</p>
          <p class="sub" style="font-size:14px;line-height:22px">${esc(hero.note)}</p>
        </div>
        <div class="btns">
          <button class="btn btn-primary" data-act="focus" data-arg="${hero.focus}">${esc(hero.primary)}${svg(ICON_OPEN, 16, 1.9)}</button>
          <button class="btn btn-secondary" data-nav="notify">알림 설정</button>
        </div>
      </div>
    </section>

    <section style="display:flex;flex-direction:column;gap:12px" aria-labelledby="ai-now">
      <div class="section-head"><h2 class="h2" id="ai-now">AI 현황</h2><span class="sub">펫에 마우스를 올려도 볼 수 있어요</span></div>
      <div class="cols">${cards}</div>
    </section>

    <div class="cols" style="align-items:flex-start">
      <section class="card" aria-labelledby="quick">
        <h2 class="h2" id="quick">자주 쓰는 설정</h2>
        <div class="rows">
          ${switchRow('wander', '자동 산책', '8~20초마다 화면 안을 걸어 다녀요')}
          ${switchRow('orbit', '작업 중인 AI 아이콘 돌리기', '일하는 AI가 우사기 둘레를 돌아요')}
          ${state.platform === 'win32' ? switchRow('notify', '완료·확인 대기 알림', '다른 창에 있을 때 Windows 알림으로 알려요') : ''}
          ${switchRow('chatter', '혼잣말', '가끔 혼잣말을 하고 AI 소식을 말풍선으로 알려요')}
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <span class="row-title" id="size-label">크기</span>
          ${sizeSeg('size-label')}
        </div>
      </section>
      <section class="card" aria-labelledby="links">
        <h2 class="h2" id="links">연결</h2>
        <div class="rows">${conns}</div>
        <button class="btn btn-quiet pull-left" data-nav="ai">AI 연결 전체 보기${svg(ICON_ARROW, 16, 1.9)}</button>
      </section>
    </div>
  </div>`
}

function sizeSeg(labelledby) {
  return `<div class="seg" role="group" aria-labelledby="${labelledby}">${state.sizes.map(s =>
    `<button aria-pressed="${state.config.size === s.value}" data-set="size" data-value="${s.value}">${esc(s.label)}</button>`).join('')}</div>`
}

// ---------- 화면: AI 연결 ----------
function renderAi() {
  const codex = hook('codex')
  const showTrust = codexNeedsTrust() && !state.codexTrustDismissed
  const trust = showTrust ? `
    <section class="card big attn" aria-label="확인이 필요한 연결">
      <div class="stage">
        ${bubble('하아?', '', 22)}
        ${pet('waiting', 120, 28, '팔짱을 끼고 기다리는 우사기')}
      </div>
      <div class="attn-body">
        <span style="align-self:flex-start">${pill('waiting', '확인 필요')}</span>
        <div style="display:flex;flex-direction:column;gap:6px">
          <h2 class="h2-jua">Codex 연결을 한 번만 확인해 주세요</h2>
          <p class="sub" style="font-size:14px;line-height:22px">Codex는 처음 보는 hook을 신뢰하기 전까지 실행하지 않아요. 연결한 뒤로 아직 Codex 소식을 받지 못했어요. 한 번만 하면 돼요.</p>
        </div>
        <ol class="steps">
          <li><span class="stepno ok">${svg(ICON_CHECK, 14, 2.4)}</span><span>펫에서 Codex 연결하기</span></li>
          <li><span class="stepno">2</span><span>Codex를 다시 시작하고 입력창에 <code>/hooks</code> 입력하기</span></li>
          <li><span class="stepno">3</span><span>목록에서 <b>pet-status.js</b>를 골라 신뢰(trust)하기</span></li>
          <li><span class="stepno">4</span><span>Codex에 아무 요청이나 한 번 보내기 — 우사기가 소식을 받으면 이 안내가 사라져요</span></li>
        </ol>
        ${ui.codexMsg ? `<p class="inline-msg" role="status">${esc(ui.codexMsg)}</p>` : ''}
        <div class="btns">
          <button class="btn btn-primary" data-act="codexRecheck">다 했어요, 다시 확인</button>
          <button class="btn btn-secondary" data-act="codexTrust" data-arg="true">나중에</button>
        </div>
      </div>
    </section>` : ''

  const appCards = [
    ['claude', 'watchClaudeApp', '채팅과 작업 화면', '응답 중지 · 허용'],
    ['chatgpt', 'watchChatGPTApp', '채팅과 앱 안의 Codex 화면', '중지 · 승인'],
  ].map(([key, option, desc, buttons]) => {
    const a = appOf(key)
    const conn = appConn(a)
    const provider = key === 'claude' ? 'claude' : 'gpt'
    return `
    <article class="pcard">
      <div class="pcard-top">
        ${avatar(provider)}
        <div class="row-text"><span style="font-size:16px;font-weight:700">${esc(a.label)}</span><span class="sub">${esc(desc)}</span></div>
        ${sw(a.on, `data-set="${option}"`, `${a.label} 응답 감지`, !a.supported)}
      </div>
      <div class="facts">
        <div class="fact"><span>상태</span>${pill(conn.kind, conn.text)}</div>
        <div class="fact"><span>찾는 버튼</span><span>${esc(buttons)}</span></div>
        <div class="fact"><span>완료로 보는 때</span><span>버튼이 ${a.doneAfterIdle}초 동안 안 보이면</span></div>
      </div>
      <div class="btns">
        <button class="btn btn-quiet btn-sm pull-left" data-act="open" data-arg="log">감지 기록 열기</button>
        <button class="btn btn-quiet btn-sm" data-act="focus" data-arg="${provider}">앱 열기</button>
      </div>
    </article>`
  }).join('')

  const hookRows = [
    ['codex', 'G', '작업 · 승인 요청 · 완료 · 멈춤'],
    ['claude', 'C', '여러 세션 · API 오류까지'],
  ].map(([id, , what]) => {
    const h = hook(id)
    const conn = hookConn(h)
    const button = h.installed
      ? `<button class="btn btn-quiet btn-sm" data-act="hooks" data-arg="${id}" data-arg2="false">연결 끊기</button>`
      : `<button class="btn btn-secondary btn-sm" data-act="hooks" data-arg="${id}" data-arg2="true">연결하기</button>`
    return `<div class="row">
      ${avatar(id === 'codex' ? 'gpt' : 'claude', 'sm')}
      <div class="row-text"><span class="row-title">${esc(h.label)}</span><span class="row-desc"><code>${esc(h.file)}</code> · ${esc(what)}</span></div>
      ${pill(conn.kind, conn.text)}${button}
    </div>`
  }).join('')

  const nodeNote = state.node === null ? `
    <div class="inline-msg" style="display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px">
      <span style="flex:1 1 260px">이 PC에서 Node.js를 찾지 못했어요. Claude Code·Codex 알림은 Node.js가 있어야 실행돼요.</span>
      <button class="btn btn-secondary btn-sm" data-act="nodeDownload">Node.js 내려받기</button>
    </div>` : ''

  return `
  <div class="page">
    ${header('AI 연결', 'Claude와 GPT가 일하는 걸 우사기가 알아챌 수 있게 이어 줘요.')}
    ${trust}
    <section style="display:flex;flex-direction:column;gap:12px" aria-labelledby="desk">
      <div class="section-head"><h2 class="h2" id="desk">데스크톱 앱</h2><span class="sub">앱 화면의 버튼으로 답변 중인지 알아채요. 따로 설치할 건 없어요.</span></div>
      <div class="cols">${appCards}</div>
    </section>
    <section class="card" aria-labelledby="direct">
      <div style="display:flex;flex-direction:column;gap:4px"><h2 class="h2" id="direct">앱이 직접 남기는 기록</h2><span class="sub">화면을 읽지 않고 앱이 직접 쓰는 작업 기록에서 시작·진행·완료를 바로 받아요. 창을 숨겨 둬도 정확해요.</span></div>
      <div class="rows">
        <div class="row">
          ${avatar('gpt', 'sm')}
          <div class="row-text"><span class="row-title">ChatGPT 앱 · Codex 작업</span><span class="row-desc"><code>${esc((state.codexSessions || {}).root || '~/.codex/sessions')}</code> · 작업 시작 · 하는 일(명령 실행·파일 고치기…) · 완료 · 중단${(state.codexSessions || {}).lastEventAt ? ` · 마지막 소식 ${timeOf(state.codexSessions.lastEventAt)}` : ''}</span></div>
          ${pill(recordConn().kind, recordConn().text)}
          ${sw((state.codexSessions || {}).on, 'data-set="watchCodexSessions"', 'ChatGPT 앱 작업 기록 읽기')}
        </div>
      </div>
      <p class="note">승인 기다림은 기록에 남지 않아 화면 감지로 알아채요. ChatGPT 일반 채팅과 Claude 앱 채팅은 이런 기록이 없어서 화면 감지를 써요. Claude 앱의 Code 탭은 아래 Claude Code 연결(hooks)로 직접 받아요.</p>
    </section>
    <section class="card" aria-labelledby="term">
      <div style="display:flex;flex-direction:column;gap:4px"><h2 class="h2" id="term">터미널 (hooks)</h2><span class="sub">설정 파일에 펫 알림을 더해요. 원래 설정은 그대로 두고, 처음 한 번 백업해요. Node.js가 필요해요.</span></div>
      ${nodeNote}
      <div class="rows">${hookRows}</div>
      <p class="note">연결을 바꾼 뒤에는 Claude Code나 Codex를 다시 시작해야 적용돼요.${codex && codex.installed && state.codexTrustDismissed && !codex.seen ? ' <button class="btn btn-quiet btn-sm" data-act="codexTrust" data-arg="false">Codex 신뢰 안내 다시 보기</button>' : ''}</p>
    </section>
  </div>`
}

// ---------- 화면: 말풍선 설정 ----------
const WORDS = [
  ['야하', '신날 때 · 반가울 때'], ['후응', '맞아 (긍정)'], ['우~라~', '거대하다 · 엄청난 걸 봤을 때'], ['하아?', '뭐야? · 깜짝 놀람 · 짜증'],
  ['우마', '맛있다'], ['우냐', '가자!'], ['우라우라', '가보자고! · 기분 좋을 때'], ['푸루루', '흥얼흥얼'],
]
function renderBubble() {
  const c = state.config
  const pat = ui.bubbleMode === 'pat'
  let preview
  let caption
  if (pat) {
    preview = bubble('우라우라~', c.meaningBasic ? '기분 좋아!' : '', 20)
    caption = '펫을 클릭하면 나와요. 혼잣말을 꺼도 쓰다듬기 말풍선은 나와요.'
  } else {
    preview = c.chatter ? bubble('하아?', c.meaningAI ? '이거 해도 돼? 확인해 줘!\n명령 실행 해도 돼?' : '', 20) : ''
    caption = c.chatter ? 'AI가 확인을 기다릴 때 이렇게 알려요.' : '혼잣말이 꺼져 있어서 AI 소식 말풍선은 나오지 않아요. 상태는 아이콘과 상태 카드로 보여요.'
  }
  return `
  <div class="page">
    ${header('말풍선 설정', '우사기는 외침으로만 말해요. 뜻은 괄호 안에 작게 보여 줄 수 있어요.')}
    <div class="cols">
      <section class="card" aria-labelledby="opts">
        <h2 class="h2" id="opts">말풍선</h2>
        <div class="rows">
          ${switchRow('chatter', '혼잣말', '가끔 혼잣말을 하고, AI가 일을 시작하거나 끝내면 말풍선으로 알려요')}
          ${switchRow('meaningBasic', '우사기어 해석', '쓰다듬기·혼잣말·인사에도 뜻을 붙여요')}
          ${switchRow('meaningAI', 'AI 결과 우사기어 해석', 'AI 작업·확인 대기·오류·완료를 전할 때 뜻과 지금 하는 일을 붙여요')}
        </div>
      </section>
      <section class="card" aria-labelledby="preview">
        <div class="section-head" style="align-items:center">
          <h2 class="h2" id="preview">미리보기</h2>
          <div class="seg inline" role="group" aria-label="미리볼 상황">
            <button aria-pressed="${pat}" data-ui="bubbleMode" data-value="pat">쓰다듬기</button>
            <button aria-pressed="${!pat}" data-ui="bubbleMode" data-value="ai">AI 소식</button>
          </div>
        </div>
        <div class="stage wash" style="min-height:270px">
          ${preview}
          ${GROUND()}
          ${pet(pat ? 'review' : 'waiting', 140, 30, pat ? '손을 모으고 좋아하는 우사기' : '팔짱을 끼고 기다리는 우사기')}
        </div>
        <p class="note" role="status">${esc(caption)}</p>
      </section>
    </div>
    <section class="card" aria-labelledby="dict">
      <div class="section-head"><h2 class="h2" id="dict">우사기어 사전</h2><span class="sub">해석을 꺼도 이 뜻으로 말하고 있어요.</span></div>
      <div class="dict">${WORDS.map(([w, m]) => `<div class="word"><span class="w">${esc(w)}</span><span class="sub">${esc(m)}</span></div>`).join('')}</div>
    </section>
  </div>`
}

// ---------- 화면: 모습·움직임 ----------
const SHEET_ROWS = [
  ['1줄', '쉬기', '평소'], ['2줄', '오른쪽 걷기', '자동 산책'], ['3줄', '왼쪽 걷기', '자동 산책'], ['4줄', '잡고 이동', '드래그하는 동안'],
  ['5줄', '점프', '완료 · 놓았을 때'], ['6줄', '오류', 'AI 오류'], ['7줄', '기다리기', '확인 대기'], ['8줄', '작업', 'AI 작업 중'],
  ['9줄', '손동작', '클릭했을 때'], ['10·11줄', '시선 16방향', '커서가 가까울 때'],
]
function renderLook() {
  const c = state.config
  const size = state.sizes.find(s => s.value === c.size)
  const sp = state.sprite
  const sourceText = !sp ? '그림을 읽지 못했어요' : sp.source === 'default' ? '기본 우사기 그림' : '내 그림 적용 중'
  const species = c.useSprite ? '' : `
    <div style="display:flex;flex-direction:column;gap:8px">
      <span class="row-title" id="species-label">그림 대신 그릴 동물</span>
      <div class="seg" role="group" aria-labelledby="species-label" style="flex-wrap:wrap">${state.species.map(s =>
        `<button aria-pressed="${c.species === s.id}" data-set="species" data-value="${s.id}">${esc(s.label)}</button>`).join('')}</div>
    </div>`
  return `
  <div class="page">
    ${header('모습·움직임', '바탕화면에서 우사기가 얼마나 크고, 어떻게 움직일지 정해요.')}
    <section class="card big" style="flex-direction:row;flex-wrap:wrap;padding:0;gap:0;overflow:hidden" aria-labelledby="size">
      <div class="stage" style="flex:1 1 300px;min-height:240px">
        <span class="sub" style="position:absolute;left:16px;top:12px">실제 크기</span>
        <div style="position:absolute;left:24px;right:24px;bottom:30px;height:1.5px;background:#C9AE7A"></div>
        ${pet('idle', c.size, 31, `크기 ${size ? size.label : ''}로 서 있는 우사기`)}
      </div>
      <div style="flex:1 1 340px;padding:32px;display:flex;flex-direction:column;justify-content:center;gap:16px">
        <div style="display:flex;flex-direction:column;gap:4px">
          <h2 class="h2-jua" id="size">크기</h2>
          <p class="sub" style="font-size:14px;line-height:22px">발 위치는 그대로 두고 위쪽으로 커져요. 지금 ${esc(size ? size.label : '')} · 키 ${c.size}px</p>
        </div>
        ${sizeSeg('size')}
      </div>
    </section>
    <div class="cols">
      <section class="card" aria-labelledby="move">
        <h2 class="h2" id="move">움직임</h2>
        <div class="rows">
          ${switchRow('wander', '자동 산책', '8~20초마다 150~500px씩 걸어요. 화면 밖으로는 나가지 않아요')}
          ${switchRow('walk2d', '위아래·대각선으로도 걷기', '끄면 지금 높이에서 좌우로만 걸어요. 도망갈 때도 같아요', !state.config.wander)}
          ${switchRow('orbit', '작업 중인 AI 아이콘 돌리기', '일하는 AI가 우사기 둘레를 돌아요. 마우스를 올리면 멈추고 커져요')}
        </div>
      </section>
      <section class="card" aria-labelledby="sheet">
        <div class="section-head" style="align-items:center"><h2 class="h2" id="sheet">펫 그림</h2>${pill(sp && c.useSprite ? 'done' : 'idle', c.useSprite ? sourceText : '그림 시트 꺼짐')}</div>
        ${sp ? `<div class="facts"><div class="fact"><span>파일</span><code>${esc(sp.file)}</code></div><div class="fact"><span>인식</span><span>${sp.rows === 11 ? '11줄 · 9가지 동작 + 16방향 시선' : `${sp.rows}줄`}</span></div></div>` : ''}
        <p class="note">같은 11줄 형식의 PNG를 sprite.png로 펫 시트 폴더에 넣으면 2초 안에 바뀌어요. 지우면 기본 우사기로 돌아가요.</p>
        <div class="rows">${switchRow('useSprite', '그림 시트 쓰기', '끄면 간단한 그림으로 그려요')}</div>
        ${species}
        <div class="btns"><button class="btn btn-secondary btn-sm" data-act="open" data-arg="pets">${svg(ICON_FOLDER, 16)}펫 시트 폴더 열기</button></div>
      </section>
    </div>
    <section class="card" aria-labelledby="rows">
      <div class="section-head"><h2 class="h2" id="rows">시트 줄 안내</h2><span class="sub">새 그림을 만들 때 이 순서로 줄을 놓아 주세요. 칸 사이는 투명하게 띄워요.</span></div>
      <ol class="sheetrows">${SHEET_ROWS.map(([no, name, when]) => `<li><span class="no">${esc(no)}</span><span>${esc(name)}</span><span class="when">${esc(when)}</span></li>`).join('')}</ol>
    </section>
  </div>`
}

// ---------- 화면: 알림 ----------
const KINDS = {
  done: { label: '완료', provider: 'claude', app: 'Claude 앱', title: 'Claude 앱 작업 완료', body: '3분 12초 걸렸어요. 눌러서 열기', anim: 'celebrate' },
  waiting: { label: '확인 대기', provider: 'gpt', app: 'ChatGPT 앱', title: 'ChatGPT 앱이 확인을 기다려요', body: '“승인” 눌러 줘', anim: 'waiting' },
  error: { label: '오류', provider: 'claude', app: 'Claude 앱', title: 'Claude 앱 오류', body: '응답이 중단됐어요', anim: 'error' },
}
function renderNotify() {
  const on = state.config.notify
  const win32 = state.platform === 'win32'
  const kind = KINDS[ui.notifyKind]
  const rules = [
    ['done', '완료', '오래 걸린 작업이 끝났을 때', '데스크톱 앱은 15초, 터미널(Claude Code · Codex)은 60초 넘게 걸린 작업만. 걸린 시간을 함께 알려요.'],
    ['waiting', '확인 대기', '15초 넘게 기다리고 있을 때', '금방 누르는 승인은 조용히 넘어가요.'],
    ['error', '오류', '3초 뒤에도 그대로일 때', '사용량 한도, 서버 혼잡 같은 이유를 함께 알려요.'],
    ['idle', '알리지 않음', '그 앱을 지금 보고 있을 때', 'Windows 방해 금지(집중 모드) 중일 때도 조용히 있어요.'],
  ]
  return `
  <div class="page">
    ${header('알림', '다른 창에서 일하는 동안 AI가 끝나거나 기다리면 Windows 알림으로 알려 드려요.')}
    <section class="card big" style="flex-direction:row;flex-wrap:wrap;padding:0;gap:0;overflow:hidden" aria-labelledby="main-switch">
      <div style="flex:1 1 380px;padding:28px;display:flex;flex-direction:column;gap:20px">
        <div style="display:flex;align-items:center;gap:16px">
          <div class="row-text"><h2 class="h2-jua" id="main-switch">완료·확인 대기 알림</h2><span class="sub">알림을 누르면 그 앱이 앞으로 와요.</span></div>
          ${sw(on, 'data-set="notify"', '완료·확인 대기 알림', !win32)}
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <span class="row-title" id="kind-label">미리볼 알림</span>
          <div class="seg" role="group" aria-labelledby="kind-label">${Object.entries(KINDS).map(([id, k]) =>
            `<button aria-pressed="${ui.notifyKind === id}" data-ui="notifyKind" data-value="${id}">${esc(k.label)}</button>`).join('')}</div>
        </div>
        <div class="toast" style="opacity:${on ? 1 : 0.45}">
          ${avatar(kind.provider, 'sm')}
          <div class="toast-text"><span class="toast-app">우사기 펫 · 지금</span><span class="toast-title">${esc(kind.title)}</span><span class="toast-body">${esc(kind.body)}</span></div>
        </div>
        ${!win32 ? '<p class="note">알림은 Windows에서만 보낼 수 있어요.</p>' : on ? '' : '<p class="note">알림이 꺼져 있어요. 상태는 펫의 아이콘과 상태 카드로만 보여요.</p>'}
        <div class="btns" style="align-items:center"><button class="btn btn-secondary btn-sm" data-act="testNotify" data-arg="${ui.notifyKind}"${on && win32 ? '' : ' disabled'}>이 알림 직접 받아 보기</button>${ui.testMsg ? `<span class="note" role="status">${esc(ui.testMsg)}</span>` : ''}</div>
      </div>
      <div class="stage" style="flex:0 1 260px;min-height:300px">
        ${GROUND(260)}
        ${pet(on ? kind.anim : 'idle', 128, 30, on ? `${kind.label} 알림을 보내는 우사기` : '쉬고 있는 우사기')}
      </div>
    </section>
    <section class="card" aria-labelledby="when">
      <h2 class="h2" id="when">언제 알려 주나요</h2>
      <div>${rules.map(([k, label, title, body]) => `<div class="rule">${pill(k, label)}<div class="row-text"><span class="row-title">${esc(title)}</span><span class="row-desc">${esc(body)}</span></div></div>`).join('')}</div>
      <p class="note">트레이 아이콘에 마우스를 올리면 지금 상태를 한 줄씩 볼 수 있어요. 예: “Claude 앱 · 작업 중 2분”</p>
    </section>
  </div>`
}

// ---------- 화면: 일반 ----------
function renderGeneral() {
  const login = state.login
  const folders = [
    ['pets', '펫 시트 폴더', '내 그림(sprite.png)과 AI 아이콘(icons)을 넣는 곳', state.paths.pets],
    ['data', '설정 폴더', '설정(config.json)과 AI 세션 기록', state.paths.data],
    ['logs', '감지 기록', '앱 감지가 이상할 때 보는 기록과 아이콘 그림', state.paths.logs],
  ]
  return `
  <div class="page">
    ${header('일반', '켜질 때, 파일 위치, 펫 정보를 관리해요.')}
    <section class="card big" style="gap:8px" aria-labelledby="start">
      <div style="display:flex;align-items:center;gap:16px">
        <div class="row-text"><h2 class="h2-jua" id="start">${state.platform === 'darwin' ? '로그인할 때 실행' : 'Windows 시작할 때 실행'}</h2><span class="sub" style="font-size:14px;line-height:22px">컴퓨터를 켜면 우사기가 바로 바탕화면에 나와요.</span></div>
        ${sw(login.on, 'data-act="login"', '시작할 때 실행', !login.supported)}
      </div>
      <p class="note">${login.supported ? '펫 폴더를 다른 곳으로 옮겼다면 이 설정을 한 번 껐다 켜 주세요.' : '설치된 배포본(UsagiPet.exe)에서만 바꿀 수 있어요.'}</p>
    </section>
    <section class="card" style="gap:8px" aria-labelledby="folders">
      <h2 class="h2" id="folders">폴더</h2>
      <div>${folders.map(([id, name, desc, p]) => `
        <div class="folder">
          <span style="color:#78675C;display:flex">${svg(ICON_FOLDER)}</span>
          <div class="row-text" style="flex:1 1 240px"><span class="row-title">${esc(name)}</span><span class="row-desc">${esc(desc)}</span></div>
          <code>${esc(p)}</code>
          <button class="btn btn-secondary btn-sm" data-act="open" data-arg="${id}">열기</button>
        </div>`).join('')}</div>
    </section>
    <div class="cols">
      <section class="card" aria-labelledby="pet">
        <h2 class="h2" id="pet">펫</h2>
        <p class="sub" style="font-size:14px;line-height:22px">숨겨도 트레이에서 다시 불러올 수 있어요. 종료하면 AI 감지와 알림도 함께 멈춰요.</p>
        <div class="btns" style="margin-top:auto">
          <button class="btn btn-secondary" data-act="petVisible" data-arg="${state.petVisible ? 'false' : 'true'}">${state.petVisible ? '펫 숨기기' : '펫 보이기'}</button>
          <button class="btn btn-quiet" data-act="quit">${esc(state.name)} 펫 종료</button>
        </div>
      </section>
      <section class="card about" aria-labelledby="about">
        <div class="stage">
          <div style="position:absolute;left:12px;right:12px;bottom:19px;height:1px;background:#C9AE7A"></div>
          ${pet('idle', 85, 20, '쉬고 있는 우사기')}
        </div>
        <div class="about-body">
          <h2 class="jua" id="about" style="font-size:20px;line-height:26px">${esc(state.name)} 펫 ${esc(state.version)}</h2>
          <span class="sub">${state.platform === 'win32' ? 'Windows 64비트' : esc(state.platform)} · Electron ${esc(state.electron)}</span>
          <span class="sub">바탕화면에서 Claude와 GPT를 지켜보는 작은 친구</span>
          ${state.readme ? '<button class="btn btn-quiet btn-sm pull-left" style="margin-top:8px" data-act="open" data-arg="readme">사용 설명서(README) 열기</button>' : ''}
        </div>
      </section>
    </div>
  </div>`
}


// ---------- 화면: 상호작용 ----------
// 원작 속 우사기 모습에서 가져온 행동 (KAI-YOU·ciatr 캐릭터 소개 참고)
const PLAYS = [
  { id: 'pat', emoji: '🤲', title: '쓰다듬기', desc: '클릭하면 손을 모으고 좋아해요.', when: '펫을 한 번 클릭' },
  { id: 'poke', emoji: '💢', title: '여러 번 찌르면 "하아?!"', desc: '"하아?"는 뭐냐고 묻거나 짜증 날 때 쓰는 우사기 말이에요. 주먹을 마구 날리다 돌아서서 버둥거려요.', when: '2.5초 안에 세 번 클릭' },
  { id: 'snack', emoji: '🍮', title: '간식 먹기', desc: '먹보 우사기. 간식을 세 입에 먹고 "우마!" (맛있다) 해요.', when: '우클릭 메뉴 "간식 주기" · 가끔 혼자서' },
  { id: 'dance', emoji: '🎵', title: '갑자기 춤추기', desc: '흥이 나면 갑자기 춤을 춰요. "우 우나나 우나~" "우나나 야하야하~~" "쁘릿!"', when: '가끔, 쉬고 있을 때' },
  { id: 'acorn', emoji: '🌰', title: '도토리 닦기', desc: '도토리를 꺼내 반짝반짝해질 때까지 닦아요.', when: '가끔, 쉬고 있을 때' },
  { id: 'flee', emoji: '💨', title: '휘저으면 도망가기', desc: '위험을 느끼면 재빨리 물러나는 우사기. "우라!" 하고 잰걸음으로 달아나요.', when: '펫 근처에서 마우스를 빠르게 흔들 때 (20초에 한 번)' },
  { id: 'nap', emoji: '🥞', title: '도라야키 이불 낮잠', desc: '커다란 도라야키를 이불 삼아 자요. 자는 동안은 산책을 쉬어요.', when: '3분 동안 컴퓨터를 안 쓰면 · 마우스를 움직이거나 누르면 깨요' },
  { id: 'greet', emoji: '👋', title: '돌아오면 반기기', desc: '자리를 비웠다 돌아오면 점프하며 "야하!" 하고 반겨요.', when: '2분 넘게 비웠다가 돌아왔을 때' },
]
// 상호작용마다 쓰는 시트 동작. 시트에 있으면 '전용 그림', 없으면 기존 동작에 효과를 얹는다.
const PLAY_ART = { pat: 'review', poke: 'fight', snack: 'eat', dance: 'dance', acorn: 'acorn', flee: 'dash', nap: 'nap', greet: 'greet' }
function renderPlay() {
  const all = state.config.playAll
  const have = new Set((state.sprite && state.sprite.animations) || [])
  const cards = PLAYS.map(p => {
    const on = state.play[p.id]
    return `
    <article class="pcard" style="gap:12px">
      <div class="pcard-top" style="align-items:flex-start">
        <span class="av letter" aria-hidden="true" style="font-size:20px">${p.emoji}</span>
        <div class="row-text"><span style="font-size:16px;line-height:24px;font-weight:700">${esc(p.title)}</span><span class="sub">${esc(p.desc)}</span></div>
        ${sw(on, `data-set="play.${p.id}"`, p.title, !all)}
      </div>
      <div class="facts" style="padding:10px 14px">
        <div class="fact"><span>언제</span><span>${esc(p.when)}</span></div>
        <div class="fact"><span>그림</span>${have.has(PLAY_ART[p.id]) ? pill('done', '전용 그림') : pill('idle', '효과로 대신')}</div>
      </div>
      <button class="btn btn-quiet btn-sm pull-left" data-act="playNow" data-arg="${p.id}"${all && on ? '' : ' disabled'}>지금 해 보기</button>
    </article>`
  }).join('')
  return `
  <div class="page">
    ${header('상호작용', '우사기가 바탕화면에서 하는 행동을 골라요. 원작 속 우사기 모습에서 가져왔어요.')}
    <section class="card big" style="flex-direction:row;flex-wrap:wrap;padding:0;gap:0;overflow:hidden" aria-labelledby="play-all">
      <div class="stage" style="flex:0 1 240px;min-height:220px">
        ${bubble(all ? '우라우라~' : '푸루루…', '', 18)}
        ${GROUND(240)}
        ${pet(all ? 'review' : 'idle', 120, 30, all ? '손을 모으고 좋아하는 우사기' : '쉬고 있는 우사기')}
      </div>
      <div style="flex:1 1 360px;padding:28px;display:flex;flex-direction:column;justify-content:center;gap:12px">
        <div style="display:flex;align-items:center;gap:16px">
          <div class="row-text"><h2 class="h2-jua" id="play-all">상호작용 켜기</h2><span class="sub">끄면 클릭·간식·춤·낮잠 같은 행동을 모두 쉬어요. AI 상태 표시와 드래그는 그대로예요.</span></div>
          ${sw(all, 'data-set="playAll"', '상호작용 켜기')}
        </div>
        <p class="note">"지금 해 보기"로 바로 볼 수 있어요. 우사기는 한 번에 한 가지만 하고, AI가 일하기 시작하면 하던 행동을 멈춰요.</p>
      </div>
    </section>
    <section style="display:flex;flex-direction:column;gap:12px" aria-labelledby="play-list">
      <div class="section-head"><h2 class="h2" id="play-list">행동</h2><span class="sub">${PLAYS.filter(p => state.play[p.id]).length}개 켜짐</span></div>
      <div class="cols">${cards}</div>
    </section>
  </div>`
}

const RENDER = { home: renderHome, ai: renderAi, bubble: renderBubble, look: renderLook, play: renderPlay, notify: renderNotify, general: renderGeneral }

// ---------- DOM 고치기 ----------
// 새 HTML을 지금 DOM과 비교해서 같은 자리의 같은 요소는 그대로 두고 속성·글자만 바꾼다.
function patch(parent, html) {
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  patchChildren(parent, tpl.content)
}
function patchChildren(a, b) {
  const an = Array.from(a.childNodes)
  const bn = Array.from(b.childNodes)
  for (let i = 0; i < bn.length; i++) {
    const x = an[i], y = bn[i]
    if (!x) { a.appendChild(y); continue }
    if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName) { a.replaceChild(y, x); continue }
    if (x.nodeType !== 1) { if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue; continue }
    const isCanvas = x.nodeName === 'CANVAS'
    for (const { name } of Array.from(x.attributes)) {
      if (isCanvas && (name === 'width' || name === 'height')) continue // 그리기 쪽에서 정하는 값
      if (!y.hasAttribute(name)) x.removeAttribute(name)
    }
    for (const { name, value } of Array.from(y.attributes)) {
      if (isCanvas && name === 'style') {
        // 크기(width·height)는 그리기 쪽 값이라 두고, 바닥 위치만 맞춘다.
        if (x._bottom !== value) { x._bottom = value; x.style.bottom = ((/bottom:\s*(-?\d+)/.exec(value) || [])[1] || 0) + 'px' }
        continue
      }
      if (x.getAttribute(name) !== value) x.setAttribute(name, value)
    }
    if (!isCanvas) patchChildren(x, y)
  }
  for (let i = an.length - 1; i >= bn.length; i--) a.removeChild(an[i])
}

let lastPage = ''
function render() {
  if (!state) return
  const now = Date.now()
  const app = document.getElementById('app')
  patch(app, renderNav() + `<main id="main">${(RENDER[page] || renderHome)(now)}</main>`)
  app.removeAttribute('aria-busy')
  if (page !== lastPage) {
    lastPage = page
    const main = document.getElementById('main')
    if (main) main.scrollTop = 0
    const title = (PAGES.find(p => p.id === page) || PAGES[0]).label
    document.title = `${state.name} 펫 설정 — ${title}`
  }
}

// ---------- 우사기 그리기 ----------
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
function animationFor(name) {
  const a = sheet && sheet.animations
  if (!a) return null
  const idle = a.idle || Object.values(a)[0]
  if (name === 'celebrate') {
    const jump = a.done || idle
    // 점프한 뒤 쉬기 자세로 잠깐 멈췄다가 다시 점프 (펫과 같은 박자)
    return { frames: jump.frames.concat(Array(6).fill(idle.frames[0])), fps: jump.fps || 8 }
  }
  return a[name] || idle
}
function drawSprites(t) {
  requestAnimationFrame(drawSprites)
  if (!sheet || !sheet.image || !sheet.image.complete) return
  const dpr = window.devicePixelRatio || 1
  for (const canvas of document.querySelectorAll('canvas[data-anim]')) {
    const anim = animationFor(canvas.dataset.anim)
    if (!anim || !anim.frames.length) continue
    const height = Number(canvas.dataset.h) || 90
    const scale = height / sheet.refHeight
    const maxW = Math.max(...anim.frames.map(f => (f.cx != null ? 2 * Math.max(f.cx - f.x, f.x + f.w - f.cx) : f.w)))
    const maxExtent = Math.max(...anim.frames.map(f => f.h + (f.lift || 0)))
    const cssW = Math.ceil(maxW * scale), cssH = Math.ceil(maxExtent * scale)
    const sizeKey = `${cssW}x${cssH}@${dpr}`
    if (canvas._size !== sizeKey) {
      canvas._size = sizeKey
      canvas.width = Math.round(cssW * dpr)
      canvas.height = Math.round(cssH * dpr)
      canvas.style.width = cssW + 'px'
      canvas.style.height = cssH + 'px'
      canvas._frame = ''
    }
    const index = reduceMotion.matches ? 0 : Math.floor(t / 1000 * (anim.fps || 6)) % anim.frames.length
    const frameKey = `${canvas.dataset.anim}:${index}:${sheet.key}`
    if (canvas._frame === frameKey) continue
    canvas._frame = frameKey
    const f = anim.frames[index]
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    const w = f.w * scale, h = f.h * scale
    const dx = f.cx != null ? cssW / 2 - (f.cx - f.x) * scale : (cssW - w) / 2
    ctx.drawImage(sheet.image, f.x, f.y, f.w, f.h, dx, cssH - h - (f.lift || 0) * scale, w, h)
  }
}

async function loadSheet() {
  const data = await api.getSprite()
  if (!data) { sheet = null; return }
  const image = new Image()
  image.src = data.url
  sheet = { ...data, image }
  image.onload = () => { for (const c of document.querySelectorAll('canvas[data-anim]')) c._frame = '' }
}

// ---------- 입력 ----------
function navigate(next) {
  if (!RENDER[next]) next = 'home'
  page = next
  if (location.hash.slice(1) !== next) history.replaceState(null, '', '#' + next)
  ui.codexMsg = ''
  render()
}

document.addEventListener('click', async event => {
  const el = event.target.closest('button')
  if (!el || el.disabled || !state) return
  if (el.dataset.nav) { navigate(el.dataset.nav); return }
  if (el.dataset.ui) { ui[el.dataset.ui] = el.dataset.value; render(); return }
  if (el.dataset.set) {
    const key = el.dataset.set
    let value
    if (el.dataset.value !== undefined) value = key === 'size' ? Number(el.dataset.value) : el.dataset.value
    else value = el.getAttribute('aria-checked') !== 'true'
    // 바로 반영해 보이고(스위치가 움직이게), main 이 저장한 결과로 다시 맞춘다.
    if (el.classList.contains('switch')) el.setAttribute('aria-checked', String(value))
    if (key.startsWith('play.')) state.play[key.slice(5)] = value
    else state.config[key] = value
    // 스위치가 다른 곳의 값을 보여 주는 경우도 바로 맞춘다 (main 이 다시 보내 줄 때까지 깜빡이지 않게)
    if (key === 'watchCodexSessions' && state.codexSessions) state.codexSessions.on = value
    const watched = { watchClaudeApp: 'claude', watchChatGPTApp: 'chatgpt' }[key]
    if (watched) { const a = state.apps.find(x => x.key === watched); if (a) a.on = value }
    render()
    await api.action('set', key, value)
    return
  }
  const act = el.dataset.act
  if (!act) return
  if (act === 'login') {
    const on = el.getAttribute('aria-checked') !== 'true'
    el.setAttribute('aria-checked', String(on))
    state.login.on = on
    await api.action('login', on)
  } else if (act === 'codexRecheck') {
    state = await api.getState()
    ui.codexMsg = codexNeedsTrust() ? '아직 Codex에서 소식이 없어요. Codex를 다시 시작한 뒤 /hooks에서 신뢰하고, 아무 요청이나 한 번 보내 보세요.' : ''
    render()
  } else if (act === 'testNotify') {
    const result = await api.action('testNotify', el.dataset.arg)
    ui.testMsg = result === 'sent' ? '보냈어요. 화면 오른쪽 아래(또는 알림 센터)를 보고, 알림을 눌러 보세요.' : '알림이 꺼져 있어요.'
    render()
    clearTimeout(ui.testTimer)
    ui.testTimer = setTimeout(() => { ui.testMsg = ''; render() }, 8000)
  } else if (act === 'focus') {
    await api.action('focus', el.dataset.arg)
  } else {
    const parse = v => (v === 'true' ? true : v === 'false' ? false : v)
    const args = [el.dataset.arg, el.dataset.arg2].filter(v => v !== undefined).map(parse)
    await api.action(act, ...args)
  }
})

// ---------- 시작 ----------
api.onState(next => {
  const sheetChanged = !state || !state.sprite || !next.sprite || state.sprite.key !== next.sprite.key || state.spriteKey !== next.spriteKey
  state = next
  if (sheetChanged) loadSheet()
  if (ui.codexMsg && !codexNeedsTrust()) ui.codexMsg = ''
  render()
})
api.onNavigate(next => navigate(next))
window.addEventListener('hashchange', () => navigate(location.hash.slice(1)))

;(async () => {
  page = RENDER[location.hash.slice(1)] ? location.hash.slice(1) : 'home'
  state = await api.getState()
  await loadSheet()
  render()
  requestAnimationFrame(drawSprites)
  // 작업 시간(2분 13초째)을 1초마다 새로 그린다.
  setInterval(() => { if (!document.hidden) render() }, 1000)
})()
