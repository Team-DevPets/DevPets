// 바탕화면 펫 — 메인 프로세스
// 투명·프레임 없는 창을 항상 위에 띄우고, 상태 파일을 지켜보며 펫 표정을 바꿉니다.
const { app, BrowserWindow, ipcMain, Menu, Tray, Notification, nativeImage, screen, shell, dialog, powerMonitor } = require('electron')
const { spawn, execFile } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const WINDOW_WIDTH = 180
const BASE_WINDOW_HEIGHT = 340 // 기본 크기(90px)일 때의 창 높이. 펫 위쪽은 말풍선·AI 상태 카드 자리. 펫이 커지면 위쪽으로 늘어난다.
const LEGACY_WINDOW_HEIGHT = 300 // 0.1.10까지의 창 높이 (저장된 위치를 옮길 때 사용)
const DATA_DIR = path.join(os.homedir(), '.claude-desk-pet')
const CONFIG_PATH = path.join(DATA_DIR, 'config.json')
const STATUS_PATH = path.join(DATA_DIR, 'status.json') // 직접 쓰는 외부 프로그램·예전 hooks용
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions') // Claude Code 세션마다 파일 하나

const SPECIES = ['mochi', 'cat', 'dog', 'rabbit', 'penguin', 'dragon']
const SPECIES_LABEL = { mochi: '모찌', cat: '고양이', dog: '강아지', rabbit: '토끼', penguin: '펭귄', dragon: '드래곤' }
const SIZES = [
  { label: '작게', value: 70 },
  { label: '보통', value: 90 },
  { label: '크게', value: 110 },
  { label: '아주 크게', value: 130 },
]
const MOOD_LABEL = { idle: '쉬는 중', working: '작업 중', waiting: '확인 기다리는 중', done: '완료', error: '오류' }
// 우사기 상호작용 (원작 속 우사기 행동에서 가져옴). 하나씩 켜고 끌 수 있고, playAll 로 한꺼번에 끈다.
const PLAY_IDS = ['pat', 'poke', 'snack', 'dance', 'acorn', 'flee', 'nap', 'greet']
const playOn = id => config.playAll !== false && !(config.play && config.play[id] === false)

let win = null
let tray = null
let currentHeight = BASE_WINDOW_HEIGHT
let currentStatus = { mood: 'idle', detail: '', at: 0, sessions: 0, sources: [], providers: [] }
let quitting = false
let config = { species: 'rabbit', name: '우사기', x: null, y: null, wander: false, chatter: false, calmMode: true, size: null, claudePath: '', useSprite: true, watchClaudeApp: true, watchChatGPTApp: true, orbit: true, notify: true, meaningBasic: false, meaningAI: true, hookSeen: {}, codexTrustDismissed: false, playAll: true, play: {} }

// ---------- 설정 ----------

function loadConfig() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }
  } catch {}
}

function saveConfig() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    writeFileAtomic(CONFIG_PATH, JSON.stringify(config, null, 2))
  } catch {}
}

// 쓰는 도중 꺼져도 파일이 반쯤 잘리지 않도록 임시 파일에 쓰고 바꿔치기한다.
function writeFileAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`
  try {
    fs.writeFileSync(tmp, text)
    fs.renameSync(tmp, file)
  } catch {
    try { fs.unlinkSync(tmp) } catch {}
    fs.writeFileSync(file, text)
  }
}

// ---------- 스프라이트 시트 자동 인식 ----------
// 투명 배경 기준으로 칸을 자동으로 잘라 쓴다.
// 11줄 형식이면 9가지 동작 + 16방향 시선, 아니면 줄 순서대로 idle, working, waiting, done, error, walk 에 배정한다.
// sprite.json 으로 배정을 바꿀 수 있다: { "rows": { "idle": 0, "working": 7, "walk": 2 }, "fps": 8, "height": 120 }
const SPRITE_PNG = path.join(DATA_DIR, 'sprite.png')
const SPRITE_JSON = path.join(DATA_DIR, 'sprite.json')
const APP_DIR = app.isPackaged ? path.dirname(process.execPath) : __dirname
const PETS_DIR = path.join(APP_DIR, 'pets')
const PROJECT_SPRITE_PNG = path.join(PETS_DIR, 'sprite.png')
const PROJECT_SPRITE_JSON = path.join(PETS_DIR, 'sprite.json')
const DEFAULT_SPRITE_PNG = path.join(__dirname, 'assets', 'default-pet.png')
// 0,1 → (5,6,7 / 2,3,4)를 번갈아 7번: 주먹이 1·7·4·7·4·7·4·7번 프레임에서 모두 8번 나온다.
const DANCE_FIST_ORDER = [0, 1, 5, 6, 7, 2, 3, 4, 5, 6, 7, 2, 3, 4, 5, 6, 7, 2, 3, 4, 5, 6, 7]
// 다리 꼬기: 서서 1초(4번 프레임을 10번 더) 가만히 있다가 5번 프레임부터 다리를 꼬고, 다 꼰 7번 프레임에서 0.5초(5프레임) 더 멈춰 있는다.
const DANCE_LEGS_ORDER = [0, 1, 2, 3, 4, ...Array(10).fill(4), 5, 6, 7, ...Array(5).fill(7)]
const DEFAULT_SPRITE_OPTIONS = {
  // fight: 12~15번째 줄(7칸씩)을 이어 붙인 28프레임 한 동작 — 정면 → 주먹 연타 → 돌아서 버둥 돌진
  // dance: 16~22번째 줄을 이어 붙인 잠옷 춤 — 주먹질 8번(16) → 웅크렸다 좌우로 기울며 흔들기(17~21) → 서서 멈춤 → 다리 꼬고 멈춤(22), 71프레임
  //   say: 그 프레임이 나올 때 우사기가 할 말 (renderer의 PLAY_LINES 키). 문자열이면 첫 프레임, { 순서: 키 }면 그 순서의 프레임.
  //   16번째 줄은 [준비, 주먹(1)] [당기기, 당기기, 주먹(4)] [당기기, 당기기, 주먹(7)]. 프레임 순서를 정해 주먹을 딱 8번 뻗게 한다.
  // 다른 상호작용 그림(먹기 eat · 도토리 acorn · 낮잠 nap · 반기기 greet · 잰걸음 dash)은 줄을 붙인 뒤
  // pets/sprite.json 의 rows 로 줄 번호를 정해 준다 (예: { "rows": { "eat": 22, "nap": [23, 24] } }, 0부터 셈). 없는 줄을 가리키면 그 동작은 효과로 대신한다.
  rows: { idle: 0, walk: 1, walkLeft: 2, dragging: 3, done: 4, error: 5, waiting: 6, working: 7, review: 8, fight: [11, 12, 13, 14], dance: [
    { row: 15, frames: DANCE_FIST_ORDER, say: 'danceFist' },
    { row: 16, say: 'danceSway' }, 17, 18, 19, 20,
    { row: 21, frames: DANCE_LEGS_ORDER, say: { [DANCE_LEGS_ORDER.indexOf(5)]: 'danceCross' } }, // 다리를 꼬기 시작할 때 "쁘릿!"
  ] },
  fps: 6,
  fpsByMood: { walk: 10, done: 8, fight: 10, eat: 6, dance: 10, acorn: 6, nap: 3, greet: 8, dash: 12 },
  height: 120,
}
const MOOD_ORDER = ['idle', 'working', 'waiting', 'done', 'error', 'walk']

function sliceSheet(image) {
  const { width, height } = image.getSize()
  const bmp = image.toBitmap() // BGRA
  const alphaAt = (x, y) => bmp[(y * width + x) * 4 + 3]
  const seen = new Uint8Array(width * height)
  const boxes = []
  const stack = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (seen[i] || alphaAt(x, y) < 16) continue
      let minX = x, maxX = x, minY = y, maxY = y, count = 0
      stack.push(i); seen[i] = 1
      while (stack.length) {
        const j = stack.pop()
        const jx = j % width, jy = (j - jx) / width
        count++
        if (jx < minX) minX = jx; if (jx > maxX) maxX = jx
        if (jy < minY) minY = jy; if (jy > maxY) maxY = jy
        // 8방향 + 2픽셀 틈까지 같은 덩어리로 (선이 끊긴 그림 대비)
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const nx = jx + dx, ny = jy + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const k = ny * width + nx
          if (!seen[k] && alphaAt(nx, ny) >= 16) { seen[k] = 1; stack.push(k) }
        }
      }
      if (count > 40) boxes.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 })
    }
  }
  // 겹치는 상자 합치기 (한 캐릭터가 여러 덩어리로 나뉜 경우: 떨어진 귀, 소품 등)
  const merge = () => {
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
      const A = boxes[a], B = boxes[b], pad = 6
      if (A.x < B.x + B.w + pad && B.x < A.x + A.w + pad && A.y < B.y + B.h + pad && B.y < A.y + A.h + pad) {
        const x = Math.min(A.x, B.x), y = Math.min(A.y, B.y)
        boxes[a] = { x, y, w: Math.max(A.x + A.w, B.x + B.w) - x, h: Math.max(A.y + A.h, B.y + B.h) - y }
        boxes.splice(b, 1)
        return true
      }
    }
    return false
  }
  while (merge()) {}
  // 줄로 묶기: 세로로 겹치면 같은 줄
  boxes.sort((a, b) => a.y - b.y || a.x - b.x)
  const rows = []
  for (const box of boxes) {
    const row = rows.find(r => box.y < r.bottom && box.y + box.h > r.top)
    if (row) { row.frames.push(box); row.top = Math.min(row.top, box.y); row.bottom = Math.max(row.bottom, box.y + box.h) }
    else rows.push({ top: box.y, bottom: box.y + box.h, frames: [box] })
  }
  rows.sort((a, b) => a.top - b.top)
  // lift: 같은 줄 바닥선보다 얼마나 떠 있는지. 점프처럼 공중에 뜬 그림의 높이를 그대로 살린다.
  return rows.map(r => r.frames.sort((a, b) => a.x - b.x).map(f => ({ ...f, lift: r.bottom - (f.y + f.h) })))
}

// 한 동작(줄) 안에서 가장 넓은 폭과, 떠 있는 높이까지 포함한 가장 큰 높이
function measure(frames) {
  return {
    // 몸 중심(cx)에 맞춰 그리는 프레임은 중심에서 더 먼 쪽의 두 배가 차지하는 폭
    maxW: Math.max(...frames.map(f => (f.cx != null ? 2 * Math.max(f.cx - f.x, f.x + f.w - f.cx) : f.w))),
    maxExtent: Math.max(...frames.map(f => f.h + f.lift)),
  }
}

// 프레임마다 몸통 가운데(불투명 픽셀이 많은 세로줄들의 가운데)를 cx 로 적어 둔다.
function anchorFrames(image, frames) {
  try {
    const { width } = image.getSize()
    const bmp = image.toBitmap()
    for (const f of frames) {
      const counts = []
      for (let x = 0; x < f.w; x++) {
        let n = 0
        for (let y = 0; y < f.h; y++) if (bmp[((f.y + y) * width + f.x + x) * 4 + 3] >= 24) n++
        counts.push(n)
      }
      const max = Math.max(...counts)
      const cols = counts.map((n, i) => (n >= max * 0.45 ? i : -1)).filter(i => i >= 0)
      if (cols.length) f.cx = f.x + (cols[0] + cols[cols.length - 1] + 1) / 2
    }
  } catch {}
}

let spriteCache = { key: '', data: null }
function loadSprite() {
  try {
    const project = fs.existsSync(PROJECT_SPRITE_PNG)
    const custom = project || fs.existsSync(SPRITE_PNG)
    const imagePath = project ? PROJECT_SPRITE_PNG : custom ? SPRITE_PNG : DEFAULT_SPRITE_PNG
    const optionsPath = project ? PROJECT_SPRITE_JSON : SPRITE_JSON
    const stat = fs.statSync(imagePath)
    const key = imagePath + ':' + stat.mtimeMs + ':' + stat.size + ':' + (custom && fs.existsSync(optionsPath) ? fs.statSync(optionsPath).mtimeMs : 0)
    if (spriteCache.key === key) return spriteCache.data
    const bytes = fs.readFileSync(imagePath)
    const image = nativeImage.createFromBuffer(bytes)
    if (image.isEmpty()) throw new Error('empty')
    const rows = sliceSheet(image)
    if (!rows.length) throw new Error('no frames')
    const v2 = rows.length >= 11 && rows[9].length === 8 && rows[10].length === 8
    let opts = !custom || v2 ? DEFAULT_SPRITE_OPTIONS : {}
    if (custom) {
      try {
        const saved = JSON.parse(fs.readFileSync(optionsPath, 'utf8'))
        opts = { ...opts, ...saved, rows: { ...opts.rows, ...saved.rows } }
      } catch {}
    }
    const assigned = {}
    MOOD_ORDER.forEach((mood, i) => { if (rows[i]) assigned[mood] = i })
    Object.assign(assigned, opts.rows || {})
    const animations = {}
    for (const [mood, idx] of Object.entries(assigned)) {
      // 한 동작이 여러 줄에 걸쳐 있으면 ([11, 12, 13, 14]) 순서대로 이어 붙인다. 줄이 하나라도 없으면 그 동작은 쓰지 않는다.
      // 줄 대신 { row, frames: [프레임 번호…], say }를 적으면 그 줄의 프레임을 적은 순서대로 쓴다 (반복·건너뛰기·대사).
      const list = Array.isArray(idx) ? idx : [idx]
      const pick = item => {
        if (item && typeof item === 'object') {
          const row = rows[item.row]
          if (!row) return null
          const order = Array.isArray(item.frames) ? item.frames : row.map((_, n) => n)
          if (!order.every(n => row[n])) return null
          const says = typeof item.say === 'string' ? { 0: item.say } : item.say || {}
          return order.map((n, k) => (says[k] ? { ...row[n], say: String(says[k]) } : row[n]))
        }
        return rows[item] || null
      }
      const parts = list.map(pick)
      if (!parts.length || !parts.every(Boolean)) continue
      const frames = parts.flat()
      if (list.length > 1) anchorFrames(image, frames) // 주먹·효과선이 튀어나와도 몸이 흔들리지 않게 몸 중심 기준으로 그린다
      animations[mood] = { frames, fps: (opts.fpsByMood && opts.fpsByMood[mood]) || opts.fps || 6, ...measure(frames) }
    }
    const used = Object.values(assigned).flat().map(item => (item && typeof item === 'object' ? item.row : item))
    const extras = rows.map((frames, i) => ({ frames, i })).filter(r => !used.includes(r.i) && !(v2 && (r.i === 9 || r.i === 10))).map(r => ({ frames: r.frames, fps: opts.fps || 6, ...measure(r.frames) }))
    // 11줄 형식: 0–8줄은 동작, 9–10줄은 위쪽부터 시계 방향 16방향 시선
    const gaze = v2 ? [...rows[9], ...rows[10]] : []
    // 모든 동작을 같은 배율로 그리기 위한 기준 높이(쉬기 그림). 프로펠러처럼 큰 소품이 있어도 몸 크기가 줄지 않는다.
    const reference = animations.idle || Object.values(animations)[0]
    const refHeight = Math.max(...reference.frames.map(f => f.h))
    const data = {
      key,
      url: 'data:image/png;base64,' + bytes.toString('base64'),
      imagePath,
      animations,
      extras,
      gaze,
      gazeFit: gaze.length ? measure(gaze) : null,
      refHeight,
      height: opts.height || 120,
      rows: rows.length,
      source: project ? 'project' : custom ? 'user' : 'default',
    }
    spriteCache = { key, data }
    return data
  } catch {
    spriteCache = { key: '', data: null }
    return null
  }
}

function watchSpriteFolder() {
  let timer = null
  const reload = () => {
    clearTimeout(timer)
    timer = setTimeout(() => { applyWindowHeight(); pushConfig(); pushViewport(); refreshTray() }, 300)
  }
  for (const folder of [PETS_DIR, DATA_DIR]) {
    try {
      fs.mkdirSync(folder, { recursive: true })
      fs.watch(folder, { persistent: false }, (_, name) => { if (name === 'sprite.png' || name === 'sprite.json') reload() })
    } catch {}
  }
  setInterval(() => {
    const before = spriteCache.key
    loadSprite()
    if (spriteCache.key !== before) reload()
    refreshLlmIcons()
  }, 2000)
}

function activeSprite() {
  return config.useSprite === false ? null : loadSprite()
}

// 화면에 보이는 펫 높이(px). 크기 메뉴 > 차분한 모드(90) > 시트 설정 순서로 정한다.
function petHeight(sprite = activeSprite()) {
  if (SIZES.some(s => s.value === config.size)) return config.size
  if (!sprite) return 90
  return config.calmMode ? 90 : Math.min(170, sprite.height || 120)
}

function windowHeight() {
  return BASE_WINDOW_HEIGHT + Math.max(0, Math.round((petHeight() - 90) * 1.4))
}

function configForRenderer() {
  const sprite = activeSprite()
  return { ...config, windowHeight: currentHeight, petHeight: petHeight(sprite), llmIcons, sprite: sprite ? { ...sprite, imagePath: undefined, height: petHeight(sprite) } : null }
}

function pushConfig() {
  if (win && !win.isDestroyed()) win.webContents.send('pet:config', configForRenderer())
  pushSettings()
}

// ---------- 작업 상태 (hooks 세션 파일 · status.json · 데스크톱 앱 감지) ----------
// 출처마다 따로 기록하고 여기서 합친다. 합치는 규칙(우선순위·오래된 상태·AI별 상태)은 llm-status.js 에 있다.
const llmStatus = require('./llm-status')
const providerTracker = llmStatus.createProviderTracker()
// ChatGPT(Codex) 앱이 ~/.codex/sessions 에 직접 남기는 작업 기록 (화면 감지보다 정확하고, 창이 숨어 있어도 된다)
const { createCodexSessionWatcher } = require('./codex-sessions')
let codexWatch = null
let codexWatchTimer = null
let codexFsWatch = null
let codexLogKey = ''

function startCodexWatch() {
  stopCodexWatch()
  if (config.watchCodexSessions === false) return
  codexWatch = createCodexSessionWatcher()
  codexWatch.scan()
  const info = codexWatch.info()
  watchLog(`codex-sessions start root=${info.root} found=${info.rootFound} files=${info.files}`)
  codexWatchTimer = setInterval(() => codexWatch && codexWatch.scan(), 15000) // 새 대화 파일 찾기
  // 새 파일이 생기면 바로 알아채도록 폴더도 지켜본다 (Windows는 하위 폴더까지 한 번에 지켜볼 수 있다)
  try {
    let timer = null
    codexFsWatch = fs.watch(info.root, { recursive: true, persistent: false }, () => {
      clearTimeout(timer)
      timer = setTimeout(() => codexWatch && codexWatch.scan(), 200)
    })
    codexFsWatch.on('error', () => {})
  } catch {}
}

function stopCodexWatch() {
  clearInterval(codexWatchTimer)
  if (codexFsWatch) try { codexFsWatch.close() } catch {}
  codexWatch = null
  codexWatchTimer = null
  codexFsWatch = null
}

function readStatusFile(file, source = '') {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    const mood = llmStatus.MOODS.includes(raw.mood) ? raw.mood : 'idle'
    return { mood, detail: typeof raw.detail === 'string' ? raw.detail.slice(0, 160) : '', at: Number(raw.at) || 0, source }
  } catch {
    return null
  }
}

function collectEntries() {
  const entries = []
  const legacy = readStatusFile(STATUS_PATH)
  if (legacy) entries.push(legacy)
  let names = []
  try { names = fs.readdirSync(SESSIONS_DIR) } catch {}
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const entry = readStatusFile(path.join(SESSIONS_DIR, name), name.startsWith('codex-') ? 'Codex' : 'Claude Code')
    if (!entry) continue
    entries.push(entry)
    markHookSeen(name.startsWith('codex-') ? 'codex' : 'claude')
  }
  for (const a of WATCHED_APPS) {
    const state = appStates[a.key]
    if (state && state.mood !== 'idle') entries.push({ ...state, source: a.label })
  }
  if (codexWatch) {
    codexWatch.poll()
    const codex = codexWatch.entries()
    entries.push(...codex)
    const info = codexWatch.info()
    const key = `${info.active}|${info.lastEventAt}`
    if (key !== codexLogKey) {
      codexLogKey = key
      watchLog(`codex-sessions active=${info.active} files=${info.files} last=${info.lastEventAt ? new Date(info.lastEventAt).toISOString() : '-'}${codex.length ? ' ' + codex.map(e => e.mood + (e.detail ? ':' + e.detail : '')).join(',') : ''}`)
      pushSettings()
    }
  }
  return entries
}

function collectStatus(now = Date.now()) {
  const entries = collectEntries()
  const { providers, events } = providerTracker.update(entries, now)
  for (const event of events) handleProviderEvent(event)
  return { ...llmStatus.aggregateMood(entries, now), providers }
}

// 끝난 세션 파일이 남아 있으면 하루 뒤 정리한다 (세션 종료 hook이 못 돈 경우 대비).
function cleanupSessions() {
  let names = []
  try { names = fs.readdirSync(SESSIONS_DIR) } catch { return }
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  for (const name of names) {
    const file = path.join(SESSIONS_DIR, name)
    try { if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file) } catch {}
  }
}

let lastProviderLog = null
function watchStatus() {
  let last = ''
  const tick = () => {
    const status = collectStatus()
    // 완료는 '사건'이라 시각까지 비교해야 연달아 끝난 작업에도 점프한다. 나머지는 바뀐 내용만 보낸다.
    const providerKey = status.providers.map(p => `${p.id}:${p.state}:${p.since}:${p.detail}:${p.sources.join('+')}`).join(',')
    const key = `${status.mood}|${status.detail}|${status.mood === 'done' ? status.at : ''}|${status.sessions}|${status.sources.join(',')}|${providerKey}`
    if (key === last) return
    if (providerKey !== lastProviderLog) {
      lastProviderLog = providerKey
      const line = llmStatus.PROVIDERS.map(p => {
        const s = status.providers.find(x => x.id === p.id)
        return `${p.id}=${s ? `${s.state}(${s.sources.join('+')}${s.detail ? ':' + s.detail : ''})` : 'idle'}`
      }).join(' ')
      watchLog(`status ${line}`)
    }
    last = key
    currentStatus = status
    if (win && !win.isDestroyed()) win.webContents.send('pet:status', status)
    updateTrayTooltip()
    pushSettings()
  }
  setInterval(tick, 700)
  setInterval(updateTrayTooltip, 30000) // 툴팁의 '작업 중 N분'을 갱신
  tick()
  cleanupSessions()
  setInterval(cleanupSessions, 60 * 60 * 1000)
}

// ---------- 알림 · 앱 전환 ----------
// 다른 일을 하는 동안 AI가 끝났거나 확인을 기다리면 Windows 알림(트레이 풍선)으로 알려 준다.
//   - 데스크톱 앱이 이미 앞에 떠 있으면 알리지 않는다 (보고 있으니까).
//   - 완료: 앱은 15초 이상, 터미널(Claude Code·Codex)은 60초 이상 걸린 작업만.
//   - 확인 대기: 15초 넘게 기다리고 있을 때만 (금방 누르는 경우는 조용히).
const APP_OF_PROVIDER = { claude: 'claude', gpt: 'chatgpt' }
const SOURCE_SURFACE = { 'Claude 앱': 'app', 'ChatGPT 앱': 'app', 'Codex 앱': 'app', 'Claude Code': 'cli', Codex: 'cli' }
const pendingNotice = {}
let balloonProvider = null

function appInForeground(provider) {
  const info = appInfo[APP_OF_PROVIDER[provider]]
  return !!(info && info.fg)
}

// Windows 알림: 최신 알림(토스트)을 쓴다. 트레이 풍선 알림은 Windows 11에서 조용히 안 뜨거나,
// 알림 센터에서 눌렀을 때 펫에게 전달되지 않는 경우가 있었다 (로그 10:34~10:37).
// 토스트는 Windows가 앱을 알아볼 수 있어야 떠서, 시작 메뉴에 앱 ID가 든 바로 가기를 만들어 둔다 (ensureAppIdentity).
const APP_USER_MODEL_ID = 'com.usagipet.desktop'
const recentNotices = [] // 알림 객체가 정리(GC)되면 눌러도 반응이 없어서 최근 몇 개를 붙잡아 둔다

function ensureAppIdentity() {
  if (process.platform !== 'win32') return
  app.setAppUserModelId(APP_USER_MODEL_ID)
  if (!app.isPackaged) return
  const shortcut = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', '우사기 펫.lnk')
  try {
    let current = null
    try { current = shell.readShortcutLink(shortcut) } catch {}
    const ok = current && current.target && current.target.toLowerCase() === process.execPath.toLowerCase() && current.appUserModelId === APP_USER_MODEL_ID
    if (ok) return
    const written = shell.writeShortcutLink(shortcut, 'create', {
      target: process.execPath,
      cwd: path.dirname(process.execPath),
      appUserModelId: APP_USER_MODEL_ID,
      description: '바탕화면 우사기 펫',
      icon: process.execPath,
      iconIndex: 0,
    })
    watchLog(`start-menu shortcut ${written ? 'written' : 'failed'} ${shortcut}`)
  } catch (error) {
    watchLog(`start-menu shortcut error ${error.message}`)
  }
}

function notifyBalloon(provider, title, content) {
  if (!tray || tray.isDestroyed()) return
  balloonProvider = provider
  const icon = llmIconImages[provider]
  try {
    try { tray.removeBalloon() } catch {}
    tray.displayBalloon({ title, content, ...(icon ? { icon, iconType: 'custom' } : { iconType: 'info' }), respectQuietTime: true })
  } catch (error) {
    watchLog(`balloon failed: ${error.message}`)
  }
}

function notify(provider, title, content) {
  if (config.notify === false || process.platform !== 'win32') return
  watchLog(`notify [${provider}] ${title} — ${content}`)
  if (!Notification.isSupported()) return notifyBalloon(provider, title, content)
  try {
    const notice = new Notification({ title, body: content, ...(llmIconImages[provider] ? { icon: llmIconImages[provider] } : {}) })
    notice.on('show', () => watchLog(`toast shown [${provider}]`))
    notice.on('click', () => {
      watchLog(`toast clicked [${provider}]`)
      focusProvider(provider)
    })
    notice.on('failed', (_, error) => {
      watchLog(`toast failed [${provider}] ${error} — 트레이 풍선으로 대신 보냄`)
      notifyBalloon(provider, title, content)
    })
    notice.show()
    recentNotices.push(notice)
    if (recentNotices.length > 8) recentNotices.shift()
  } catch (error) {
    watchLog(`toast error ${error.message} — 트레이 풍선으로 대신 보냄`)
    notifyBalloon(provider, title, content)
  }
}

function handleProviderEvent(event) {
  clearTimeout(pendingNotice[event.provider])
  const surface = SOURCE_SURFACE[event.source] || 'cli'
  if (event.type === 'done') {
    if (surface === 'app' && appInForeground(event.provider)) return
    if (event.duration < (surface === 'app' ? 15000 : 60000)) return
    notify(event.provider, `${event.source || event.label} 작업 완료`, `${llmStatus.formatDuration(event.duration)} 걸렸어요. 눌러서 열기`)
    return
  }
  // 확인 대기 · 오류는 잠깐 기다렸다가 그대로면 알린다.
  pendingNotice[event.provider] = setTimeout(() => {
    const now = (currentStatus.providers || []).find(p => p.id === event.provider)
    if (!now || now.state !== event.type) return
    if (surface === 'app' && appInForeground(event.provider)) return
    const title = event.type === 'waiting' ? `${event.source || event.label}가 확인을 기다려요` : `${event.source || event.label} 오류`
    notify(event.provider, title, event.detail || (event.type === 'waiting' ? '권한 확인이 필요해요' : '응답이 중단됐어요'))
  }, event.type === 'waiting' ? 15000 : 3000)
}

// Microsoft Store 앱은 실행 파일을 직접 실행하지 않고 앱 ID(AUMID)로 연다.
// 설치 폴더 이름 "Claude_3.1623.0.0_x64__pzs8sxrjxfjjc" → 패키지 패밀리 "Claude_pzs8sxrjxfjjc", 앱 ID는 AppxManifest.xml 의 <Application Id>.
function storeAppId(exe) {
  const match = /\\WindowsApps\\([^\\]+)\\/i.exec(exe)
  if (!match) return null
  const parts = match[1].split('_')
  if (parts.length < 2) return null
  const root = exe.slice(0, exe.toLowerCase().indexOf(match[1].toLowerCase()) + match[1].length)
  try {
    const manifest = fs.readFileSync(path.join(root, 'AppxManifest.xml'), 'utf8')
    const appId = /<Application\b[^>]*\bId="([^"]+)"/.exec(manifest)
    if (appId && /^[\w.-]+$/.test(parts[0]) && /^[\w]+$/.test(parts[parts.length - 1]) && /^[\w.-]+$/.test(appId[1])) {
      return `${parts[0]}_${parts[parts.length - 1]}!${appId[1]}`
    }
  } catch {}
  return null
}

// 시작 메뉴에 등록된 앱 ID(AppID). Windows가 직접 쓰는 값이라 스토어 앱·일반 설치 모두 가장 확실하게 연다.
// PowerShell 한 번이 1초쯤 걸려서 켤 때 미리 읽어 두고 10분 동안 재사용한다.
const START_APP_NAMES = { claude: /^Claude$/i, gpt: /^(ChatGPT|Codex)$/i }
let startApps = { at: 0, list: null, pending: null }
function loadStartApps(force = false) {
  if (process.platform !== 'win32') return Promise.resolve([])
  if (!force && startApps.list && Date.now() - startApps.at < 10 * 60 * 1000) return Promise.resolve(startApps.list)
  if (startApps.pending) return startApps.pending
  const command = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; @(Get-StartApps | Where-Object { $_.Name -match '^(Claude|ChatGPT|Codex)$' } | Select-Object Name,AppID) | ConvertTo-Json -Compress"
  startApps.pending = new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 8000 }, (error, stdout) => {
      let list = []
      try {
        const parsed = JSON.parse(String(stdout).trim() || '[]')
        list = (Array.isArray(parsed) ? parsed : [parsed]).filter(a => a && typeof a.Name === 'string' && typeof a.AppID === 'string')
      } catch {}
      if (error) watchLog(`start-apps error ${error.message}`)
      startApps = { at: Date.now(), list, pending: null }
      watchLog(`start-apps ${JSON.stringify(list)}`)
      resolve(list)
    })
  })
  return startApps.pending
}

// 그 AI의 데스크톱 앱을 앞으로 가져온다. 이미 켜져 있으면 앱이 자기 창을 앞으로 띄운다 (한 번만 실행되는 앱).
// 순서: 시작 메뉴 앱 ID → 설치 폴더에서 계산한 스토어 앱 ID → 실행 파일 직접 실행. 웹 Claude는 앱을 전혀 못 찾을 때만 연다.
async function focusProvider(provider) {
  if (process.platform !== 'win32') return provider === 'claude' ? (openClaude(), true) : false
  const exe = llmExeCandidates(provider)[0] || ''
  const candidates = (await loadStartApps()).filter(a => START_APP_NAMES[provider].test(a.Name) && /^[\w.!-]+$/.test(a.AppID))
  // 같은 이름이 여럿이면(ChatGPT·Codex) 지금 감지한 앱과 같은 패키지를 고른다.
  const family = exe ? (storeAppId(exe) || '').split('!')[0] : ''
  const listed = candidates.find(a => family && a.AppID.toLowerCase().startsWith(family.toLowerCase() + '!')) || candidates[0]
  const aumid = (listed && listed.AppID) || (exe ? storeAppId(exe) : null)
  const launch = (cmd, args, how) => new Promise(resolve => {
    try {
      const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true })
      child.on('error', error => { watchLog(`focus [${provider}] ${how} failed: ${error.message}`); resolve(false) })
      child.on('spawn', () => { child.unref(); resolve(true) })
    } catch (error) {
      watchLog(`focus [${provider}] ${how} failed: ${error.message}`)
      resolve(false)
    }
  })
  if (aumid) {
    watchLog(`focus [${provider}] app-id ${aumid}${listed ? ' (start menu)' : ' (manifest)'}`)
    if (await launch('explorer.exe', [`shell:AppsFolder\\${aumid}`], 'app-id')) return true
  }
  // 스토어 앱(WindowsApps) 실행 파일은 직접 실행할 수 없어서 일반 설치일 때만 시도한다.
  if (exe && !/\\WindowsApps\\/i.test(exe)) {
    watchLog(`focus [${provider}] exe ${exe}`)
    if (await launch(exe, [], 'exe')) return true
  }
  watchLog(`focus [${provider}] app not found (exe=${exe || '-'})`)
  if (provider === 'claude') { openClaude(); return true }
  return false
}

// ---------- 창 ----------

function petBounds() {
  const bottom = currentHeight - 114
  return activeSprite()
    ? { top: bottom - petHeight(), bottom }
    : { top: currentHeight - 108 - Math.round(130 * petHeight() / 90), bottom: currentHeight - 108 }
}

function clampToScreen(x, y) {
  const bounds = petBounds()
  const { workArea } = screen.getDisplayNearestPoint({ x: Math.round(x + WINDOW_WIDTH / 2), y: Math.round(y + (bounds.top + bounds.bottom) / 2) })
  return [
    Math.round(Math.min(Math.max(x, workArea.x - WINDOW_WIDTH / 2), workArea.x + workArea.width - WINDOW_WIDTH / 2)),
    Math.round(Math.min(Math.max(y, workArea.y - bounds.top), workArea.y + workArea.height - bounds.bottom)),
  ]
}

// setPosition 대신 크기까지 지정해서 옮긴다.
// Windows에서 배율이 다른 모니터 사이로 옮길 때 창 크기가 조금씩 변하는 현상을 막는다.
function moveWindow(x, y) {
  if (!win || win.isDestroyed()) return
  const b = win.getBounds()
  if (b.x === x && b.y === y && b.width === WINDOW_WIDTH && b.height === currentHeight) return
  win.setBounds({ x, y, width: WINDOW_WIDTH, height: currentHeight })
}

// 펫 크기가 바뀌면 발 위치는 그대로 두고 창을 위쪽으로 늘리거나 줄인다.
function applyWindowHeight() {
  const next = windowHeight()
  if (next === currentHeight) return
  if (!win || win.isDestroyed()) { currentHeight = next; return }
  const [x, y] = win.getPosition()
  const grow = next - currentHeight
  currentHeight = next
  config.windowHeight = next
  const [nx, ny] = clampToScreen(x, y - grow)
  win.setBounds({ x: nx, y: ny, width: WINDOW_WIDTH, height: currentHeight })
}

// 모니터를 뽑거나 배율을 바꾸면 펫이 화면 밖에 남지 않게 다시 안쪽으로 들인다.
function keepOnScreen() {
  if (!win || win.isDestroyed()) return
  const [x, y] = win.getPosition()
  const [nx, ny] = clampToScreen(x, y)
  moveWindow(nx, ny)
  pushViewport()
}

function createWindow() {
  currentHeight = windowHeight()
  const { workArea } = screen.getPrimaryDisplay()
  const bounds = petBounds()
  const startX = config.x ?? workArea.x + workArea.width - WINDOW_WIDTH - 24
  // 저장된 y는 창 위쪽 끝이라, 창 높이가 바뀌었으면 그만큼 옮겨서 펫 발 위치를 그대로 둔다.
  const savedHeight = Number(config.windowHeight) || LEGACY_WINDOW_HEIGHT
  const startY = config.y != null ? config.y + savedHeight - currentHeight : workArea.y + workArea.height - bounds.bottom
  // 저장된 위치가 지금은 없는 모니터라면 가장 가까운 화면 안으로 옮긴다.
  const [x, y] = clampToScreen(startX, startY)
  // 위치와 창 높이를 함께 기록해 둔다 (다음 실행 때 높이 차이만큼 옮기는 기준).
  config.x = x
  config.y = y
  config.windowHeight = currentHeight
  win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: currentHeight,
    x,
    y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  })
  win.setAlwaysOnTop(true, 'floating')
  win.setIgnoreMouseEvents(true, { forward: true })
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  // 시작할 때 다른 창의 포커스를 뺏지 않는다. ready-to-show가 안 오는 환경을 대비해 3초 뒤에는 무조건 보인다.
  let shown = false
  const showOnce = () => { if (!shown && win && !win.isDestroyed()) { shown = true; win.showInactive() } }
  win.once('ready-to-show', showOnce)
  setTimeout(showOnce, 3000)
  let positionSaveTimer = null
  const remember = () => {
    if (!win || win.isDestroyed()) return
    const [nx, ny] = win.getPosition()
    if (config.x === nx && config.y === ny) return
    config.x = nx
    config.y = ny
    pushViewport()
    clearTimeout(positionSaveTimer)
    positionSaveTimer = setTimeout(saveConfig, 500)
  }
  win.on('move', remember)
  win.on('moved', remember)
  win.on('close', () => { clearTimeout(positionSaveTimer); saveConfig() })
  // 페이지가 다 뜬 뒤 지금 상태를 한 번 보낸다 (펫을 켜기 전부터 AI가 일하고 있던 경우, 바뀔 때까지 모르고 있던 문제).
  win.webContents.on('did-finish-load', () => { pushConfig(); pushViewport(); win.webContents.send('pet:status', currentStatus) })
  // 외부 링크나 새 창은 앱 안에서 열지 않는다.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', e => e.preventDefault())
}

function pushViewport() {
  if (!win || win.isDestroyed()) return
  const [x, y] = win.getPosition()
  const bounds = petBounds()
  const { workArea } = screen.getDisplayNearestPoint({ x: x + WINDOW_WIDTH / 2, y: Math.round(y + (bounds.top + bounds.bottom) / 2) })
  win.webContents.send('pet:viewport', { roomAbove: y + bounds.top - workArea.y })
}

// ---------- 커서 추적 · 드래그 ----------

let dragAnchor = null
function followDrag() {
  if (!dragAnchor || !win || win.isDestroyed()) return
  const cursor = screen.getCursorScreenPoint()
  const [dx, dy] = clampToScreen(cursor.x - dragAnchor.x, cursor.y - dragAnchor.y)
  moveWindow(dx, dy)
}

// 펫 근처(약 170px)에서 0.7초 안에 마우스를 크게 여러 번 왔다 갔다 하면 '흔들기'로 본다.
const shake = { samples: [] }
function detectShake(cursor, cx, cy, dist) {
  const now = Date.now()
  if (dist > 170 || dragAnchor) { shake.samples.length = 0; return }
  shake.samples.push({ t: now, x: cursor.x, y: cursor.y })
  while (shake.samples.length && now - shake.samples[0].t > 700) shake.samples.shift()
  if (shake.samples.length < 6) return
  let path = 0, flips = 0, lastSign = 0
  for (let i = 1; i < shake.samples.length; i++) {
    const dx = shake.samples[i].x - shake.samples[i - 1].x, dy = shake.samples[i].y - shake.samples[i - 1].y
    path += Math.hypot(dx, dy)
    const sign = Math.abs(dx) > 6 ? Math.sign(dx) : 0
    if (sign && lastSign && sign !== lastSign) flips++
    if (sign) lastSign = sign
  }
  if (path < 900 || flips < 3) return
  shake.samples.length = 0
  if (!playOn('flee') || napping || now - lastFleeAt < 20000) return
  lastFleeAt = now
  win.webContents.send('pet:play', 'flee')
  napping = false
  // 커서에서 멀어지는 쪽으로 (가로 위주로, 세로는 절반만 반영해서 화면 위로 너무 치솟지 않게)
  dash(cx - cursor.x || 1, (cy - cursor.y) * 0.5)
}

// 키보드·마우스를 마지막으로 쓴 뒤 지난 초. 낮잠(3분)과 '돌아오면 반기기'에 쓴다.
function watchUserIdle() {
  setInterval(() => {
    if (!win || win.isDestroyed()) return
    let seconds = 0
    try { seconds = powerMonitor.getSystemIdleTime() } catch {}
    win.webContents.send('pet:idle', seconds)
  }, 2000)
}

function watchCursor() {
  let last = ''
  let near = false
  setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return
    followDrag()
    const cursor = screen.getCursorScreenPoint()
    const [x, y] = win.getPosition()
    const { workArea } = screen.getDisplayNearestPoint(cursor)
    const cx = x + WINDOW_WIDTH / 2
    const bounds = petBounds()
    const cy = y + (bounds.top + bounds.bottom) / 2
    const dist = Math.hypot(cursor.x - cx, cursor.y - cy)
    detectShake(cursor, cx, cy, dist)
    if (dist < 140) near = true
    else if (dist > 180) near = false
    const angle = (Math.atan2(cursor.x - cx, -(cursor.y - cy)) + Math.PI * 2) % (Math.PI * 2)
    const direction = Math.round(angle / (Math.PI / 8)) % 16
    // 펫 머리 중심 기준 상대 위치를 -1..1 로 정규화 (화면 절반 거리에서 포화). 가까이 있을 때만 쓴다.
    const nx = near ? Math.max(-1, Math.min(1, (cursor.x - cx) / (workArea.width / 2))) : 0
    const ny = near ? Math.max(-1, Math.min(1, (cursor.y - cy) / (workArea.height / 2))) : 0
    // 창 안에 있을 때만 클릭 판정용 좌표를 보낸다. 멀리서 마우스를 움직일 때는 신호를 보내지 않는다.
    const inside = cursor.x >= x && cursor.x < x + WINDOW_WIDTH && cursor.y >= y && cursor.y < y + currentHeight
    const localX = inside ? cursor.x - x : null
    const localY = inside ? cursor.y - y : null
    const centered = dist < 16
    const key = `${nx.toFixed(2)},${ny.toFixed(2)},${near},${near ? direction : -1},${centered},${localX},${localY}`
    if (key !== last) {
      last = key
      win.webContents.send('pet:cursor', { x: nx, y: ny, near, direction, centered, localX, localY })
    }
  }, 40)
}

// ---------- 산책 ----------
// 손으로 옮길 때는 펫을 화면 가장자리 밖으로 반쯤 걸쳐 둘 수 있지만, 혼자 걸을 때는 몸 전체가 화면 안에 있는 범위에서만 움직인다.
function walkRange() {
  if (!win || win.isDestroyed()) return null
  const [x, y] = win.getPosition()
  const bounds = petBounds()
  const { workArea } = screen.getDisplayNearestPoint({ x: Math.round(x + WINDOW_WIDTH / 2), y: Math.round(y + (bounds.top + bounds.bottom) / 2) })
  // 걷기 그림은 키와 비슷한 폭이라 몸 절반 폭을 키의 0.6배로 잡는다 (약간의 여유 포함).
  const half = Math.ceil(petHeight() * 0.6)
  const inset = WINDOW_WIDTH / 2 - half // 창 가장자리에서 몸까지의 투명한 여백
  // 세로: 몸(머리~발)이 작업 영역 안에 있는 범위. 위쪽은 귀 끝이 붙지 않게 조금 띄운다.
  return {
    min: Math.round(workArea.x - inset),
    max: Math.round(workArea.x + workArea.width - WINDOW_WIDTH + inset),
    minY: Math.round(workArea.y - bounds.top + 8),
    maxY: Math.round(workArea.y + workArea.height - bounds.bottom),
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let facing = 1 // 위아래로만 걸을 때는 직전에 보던 쪽을 본다

// (ux, uy) 방향으로 한 걸음 speed px 씩 최대 steps 걸음 움직인다.
// 화면 안에 있으면 경계를 넘기 직전에 멈추고, 가장자리에 걸쳐 있었다면 안쪽으로 들어오는 걸음만 허락한다.
async function moveAlong(ux, uy, steps, speed, interval, generation, keepGoing = () => true) {
  let [fx, fy] = win.getPosition()
  for (let i = 0; i < steps; i++) {
    if (generation !== walkGeneration || !keepGoing() || dragAnchor || !win || win.isDestroyed() || !win.isVisible()) break
    const r = walkRange()
    if (!r) break
    const [x, y] = win.getPosition()
    if (Math.round(fx) !== x || Math.round(fy) !== y) { fx = x; fy = y } // 다른 곳에서 옮겼으면 거기서부터
    const nx = fx + ux * speed, ny = fy + uy * speed
    const insideX = x >= r.min && x <= r.max
    const insideY = y >= r.minY && y <= r.maxY
    const outX = ux !== 0 && (insideX ? nx < r.min || nx > r.max : (x < r.min) === (ux < 0))
    const outY = uy !== 0 && (insideY ? ny < r.minY || ny > r.maxY : (y < r.minY) === (uy < 0))
    if (outX || outY) break
    fx = nx
    fy = ny
    moveWindow(Math.round(fx), Math.round(fy))
    await sleep(interval)
  }
}

// 산책 방향 고르기: 가로(자주) · 대각선 · 위아래(가끔). 벽에 붙어 있으면 그쪽으로는 가지 않는다.
const WALK_DIRS = [[1, 0, 3], [-1, 0, 3], [1, 1, 2], [1, -1, 2], [-1, 1, 2], [-1, -1, 2], [0, 1, 1], [0, -1, 1]]
function pickWalkDirection(r, x, y) {
  const all = config.walk2d === false ? WALK_DIRS.filter(d => d[1] === 0) : WALK_DIRS
  const ok = all.filter(([dx, dy]) =>
    !(dx < 0 && x <= r.min + 30) && !(dx > 0 && x >= r.max - 30) && !(dy < 0 && y <= r.minY + 30) && !(dy > 0 && y >= r.maxY - 30))
  // 화면 밖에 걸쳐 있으면 안쪽으로
  if (x < r.min) return [1, 0]
  if (x > r.max) return [-1, 0]
  const list = ok.length ? ok : all
  let pick = Math.random() * list.reduce((n, d) => n + d[2], 0)
  for (const d of list) { pick -= d[2]; if (pick <= 0) return [d[0], d[1]] }
  return [list[0][0], list[0][1]]
}

// 걷는 그림의 방향: 가로로 움직이면 그쪽, 위아래로만 움직이면 직전에 보던 쪽
function walkFacing(ux) {
  if (ux > 0) facing = 1
  else if (ux < 0) facing = -1
  return facing
}

let walkTimer = null
let walkGeneration = 0
let napping = false // 도라야키 이불 낮잠 중에는 혼자 걷지 않는다
let playing = false // 간식·춤 같은 상호작용 중에도 걷지 않는다 (걸으면 하던 행동이 끊겨서)
let dashing = false // 도망가는 중

// 휘저으면 도망가기: 잰걸음(평소의 2배 속도)으로 커서 반대쪽으로 약 190px 달아난다.
let lastFleeAt = 0
async function dash(vx, vy = 0) {
  if (!win || win.isDestroyed() || dragAnchor || !win.isVisible()) return
  const generation = ++walkGeneration
  clearTimeout(walkTimer)
  if (config.walk2d === false) vy = 0
  const r = walkRange()
  const [x0, y0] = win.getPosition()
  // 벽 쪽으로 도망가게 되면 반대로 꺾는다
  if (r) {
    if ((vx > 0 && x0 >= r.max - 40) || (vx < 0 && x0 <= r.min + 40)) vx = -vx
    if ((vy > 0 && y0 >= r.maxY - 40) || (vy < 0 && y0 <= r.minY + 40)) vy = -vy
  }
  const len = Math.hypot(vx, vy) || 1
  const ux = vx / len, uy = vy / len
  win.webContents.send('pet:walk', walkFacing(ux) * 2)
  dashing = true
  await moveAlong(ux, uy, 32, 6, 22, generation)
  dashing = false
  if (generation === walkGeneration && win && !win.isDestroyed()) win.webContents.send('pet:walk', 0)
  if (generation === walkGeneration) scheduleWalk()
}
function scheduleWalk() {
  const generation = ++walkGeneration
  clearTimeout(walkTimer)
  if (!config.wander) {
    if (win && !win.isDestroyed()) win.webContents.send('pet:walk', 0)
    return
  }
  walkTimer = setTimeout(async () => {
    const range = walkRange()
    if (range && !dragAnchor && !napping && !playing && win.isVisible() && range.max - range.min > 40) {
      const [x0, y0] = win.getPosition()
      const [dx, dy] = pickWalkDirection(range, x0, y0)
      const len = Math.hypot(dx, dy)
      // 한 번에 150~500px (한 걸음 3px, 약 2~7초) 걷는다. 대각선도 같은 빠르기.
      const steps = 50 + Math.floor(Math.random() * 117)
      win.webContents.send('pet:walk', walkFacing(dx))
      await moveAlong(dx / len, dy / len, steps, 3, 40, generation, () => !!config.wander)
      if (generation === walkGeneration && win && !win.isDestroyed()) win.webContents.send('pet:walk', 0)
    }
    if (generation === walkGeneration) scheduleWalk()
  }, 8000 + Math.random() * 12000) // 8~20초마다
}

// ---------- Claude 앱 열기 ----------

function openClaude() {
  const tryOpen = (cmd, args) =>
    new Promise(resolve => {
      try {
        const child = spawn(cmd, args, { detached: true, stdio: 'ignore', shell: false, windowsHide: true })
        child.on('error', () => resolve(false))
        child.on('spawn', () => {
          child.unref()
          resolve(true)
        })
      } catch {
        resolve(false)
      }
    })

  ;(async () => {
    if (config.claudePath && fs.existsSync(config.claudePath)) {
      if (await tryOpen(config.claudePath, [])) return
    }
    if (process.platform === 'darwin') {
      if (await tryOpen('open', ['-a', 'Claude'])) return
    } else if (process.platform === 'win32') {
      const candidates = [
        path.join(process.env.LOCALAPPDATA || '', 'AnthropicClaude', 'claude.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Claude', 'Claude.exe'),
      ]
      for (const exe of candidates) {
        if (fs.existsSync(exe) && (await tryOpen(exe, []))) return
      }
      // 스토어 설치 앱도 시작 메뉴에 등록된 앱 ID로 직접 연다.
      const appId = await new Promise(resolve => {
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Get-StartApps | Where-Object { $_.Name -eq 'Claude' } | Select-Object -First 1 -ExpandProperty AppID"], { windowsHide: true, timeout: 5000 }, (error, stdout) => resolve(error ? '' : stdout.trim()))
      })
      if (appId && /^[\w.!-]+$/.test(appId) && await tryOpen('explorer.exe', [`shell:AppsFolder\\${appId}`])) return
    }
    // 마지막 수단: 웹 Claude (Claude 앱을 전혀 찾지 못했을 때만)
    watchLog('open-claude: Claude 앱을 찾지 못해 웹 Claude를 엽니다')
    shell.openExternal('https://claude.ai')
  })()
}

// ---------- Claude Code · Codex hooks 연결 (메뉴에서 설치·제거) ----------
// hooks/install.js 와 같은 일을 앱 안에서 한다. 두 도구 모두 같은 형식의 hooks를 지원해서 같은 스크립트를 쓴다.
// 설치에는 Node.js가 필요 없지만, hook 실행에는 Node.js가 필요하다.
const INSTALLED_HOOK = path.join(DATA_DIR, 'hooks', 'pet-status.js')
const HOOK_TARGETS = {
  claude: {
    label: 'Claude Code',
    file: path.join(os.homedir(), '.claude', 'settings.json'),
    events: ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'Notification', 'Stop', 'StopFailure', 'SessionEnd'],
    asyncEvents: ['PreToolUse', 'PostToolUse', 'PostToolUseFailure'], // 자주 불리는 이벤트는 Claude Code를 기다리게 하지 않는다
    timeouts: {},
    args: '',
    restartNote: '실행 중인 Claude Code는 다시 시작해야 적용돼요.',
  },
  codex: {
    label: 'Codex',
    file: path.join(os.homedir(), '.codex', 'hooks.json'),
    events: ['UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop', 'Interrupt', 'SessionEnd'],
    asyncEvents: [],
    timeouts: { Interrupt: 3, SessionEnd: 3 }, // Codex는 이 두 이벤트의 제한 시간을 최대 3초로 둔다
    args: ' --source codex',
    restartNote: 'Codex를 다시 시작한 뒤, 처음 한 번은 Codex CLI에서 /hooks 로 펫 hook을 검토하고 신뢰(trust)해 주세요. 신뢰하기 전에는 실행되지 않아요.',
  },
}

function hookSourcePath() {
  const candidates = [
    path.join(__dirname, 'hooks', 'pet-status.js'), // 소스 폴더에서 실행
    path.join(APP_DIR, 'hooks', 'pet-status.js'), // Windows 배포본
  ]
  return candidates.find(p => fs.existsSync(p)) || null
}

const isPetHook = entry => Array.isArray(entry && entry.hooks) && entry.hooks.some(h => typeof h.command === 'string' && h.command.includes('pet-status.js'))

function readHookFile(file) {
  if (!fs.existsSync(file)) return {}
  // 읽을 수 없는 설정 파일은 덮어쓰지 않는다 (사용자 설정 보호).
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
}

function hooksInstalled(target) {
  try {
    const settings = readHookFile(HOOK_TARGETS[target].file)
    return Array.isArray(settings.hooks?.Stop) && settings.hooks.Stop.some(isPetHook)
  } catch {
    return false
  }
}

function setHooks(target, install) {
  const t = HOOK_TARGETS[target]
  const settings = readHookFile(t.file)
  if (install) {
    const source = hookSourcePath()
    if (!source) throw new Error('hooks/pet-status.js 파일을 찾지 못했어요. 배포본 폴더 구성을 확인해 주세요.')
    // 앱 폴더를 옮겨도 연결이 끊기지 않도록 설정 폴더에 복사해 두고 그 경로를 등록한다.
    fs.mkdirSync(path.dirname(INSTALLED_HOOK), { recursive: true })
    fs.copyFileSync(source, INSTALLED_HOOK)
  }
  const command = `node "${INSTALLED_HOOK.replace(/\\/g, '/')}"${t.args}`
  settings.hooks = settings.hooks || {}
  for (const event of new Set([...Object.keys(settings.hooks), ...t.events])) {
    const list = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : null
    if (!list && (!install || !t.events.includes(event))) continue
    const kept = (list || []).filter(entry => !isPetHook(entry))
    if (install && t.events.includes(event)) {
      kept.push({ hooks: [{ type: 'command', command, timeout: t.timeouts[event] || 5, ...(t.asyncEvents.includes(event) ? { async: true } : {}) }] })
    }
    if (kept.length) settings.hooks[event] = kept
    else delete settings.hooks[event]
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks
  fs.mkdirSync(path.dirname(t.file), { recursive: true })
  if (fs.existsSync(t.file) && !fs.existsSync(t.file + '.pet-backup')) fs.copyFileSync(t.file, t.file + '.pet-backup')
  writeFileAtomic(t.file, JSON.stringify(settings, null, 2))
}

function nodeVersion() {
  return new Promise(resolve => execFile('node', ['-v'], { windowsHide: true, timeout: 4000 }, (error, stdout) => resolve(error ? null : String(stdout).trim())))
}

async function toggleHooks(target, install, parent = null) {
  const t = HOOK_TARGETS[target]
  const title = `${t.label} 작업 알림 연결`
  try {
    if (install && !(await nodeVersion())) {
      const { response } = await showBox(parent, {
        type: 'info',
        title,
        message: 'Node.js가 필요해요',
        detail: `${t.label}가 펫에게 작업 상태를 알리려면 Node.js가 설치되어 있어야 해요. 설치한 뒤 다시 켜 주세요.`,
        buttons: ['Node.js 내려받기', '닫기'],
        defaultId: 0,
        cancelId: 1,
      })
      if (response === 0) shell.openExternal('https://nodejs.org/ko/download')
      return
    }
    setHooks(target, install)
    showBox(parent, {
      type: 'info',
      title,
      message: install ? '연결했어요' : '연결을 해제했어요',
      detail: (install ? t.restartNote + '\n' : '') + `설정 파일: ${t.file}`,
    })
  } catch (error) {
    showBox(parent, {
      type: 'error',
      title,
      message: '설정을 바꾸지 못했어요',
      detail: `${error.message}\n\n${t.file} 파일이 올바른 JSON인지 확인해 주세요. 파일은 바꾸지 않았어요.`,
    })
  } finally {
    refreshNodeInfo()
    refreshTray()
  }
}

function showBox(parent, options) {
  return parent && !parent.isDestroyed() ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options)
}

// ---------- 데스크톱 채팅 앱 응답 감지 (Windows): Claude 앱 · ChatGPT 앱 ----------
// 두 앱 모두 외부 연결(hooks) 기능이 없어서 app-watch.ps1 이 Windows 접근성(UI Automation)으로 앱 창의 버튼을 읽는다.
//   중지 버튼이 보이면 작업 중, 허용·승인 버튼이 보이면 확인 대기, 중지 버튼이 사라지면 완료.
// ChatGPT 앱은 채팅과 그 안의 Codex 화면을 모두 이 방식으로 잡는다. 자세한 동작은 app-watch.ps1 머리말 참고.
// 버튼 이름은 config.json 의 stopPatterns.<앱>, approvePatterns.<앱> 으로 바꿀 수 있다 (정규식, 대소문자 무시).
const WATCHED_APPS = [
  {
    key: 'claude',
    label: 'Claude 앱',
    option: 'watchClaudeApp',
    procs: ['claude'],
    exclude: '\\\\\\.local\\\\bin\\\\|\\\\node_modules\\\\|\\\\npm\\\\', // Claude Code CLI(claude.exe)는 hooks로 따로 연결
    re: '^(stop|stop response|stop generating|stop responding|stop task|응답 중지|응답 중단|생성 중지|중지|정지|멈추기)$',
    approve: '^(허용|항상 허용|한 번 허용|이번만 허용|이번 한 번만 허용|승인|allow|allow once|always allow|approve)$',
    // 답이 끝나면 답 아래에 생기는 버튼. 중지 버튼이 사라질 때 이 버튼 수가 늘었으면 기다리지 않고 바로 완료로 본다.
    // 실제 이름 (로그 15:02): 복사 · 소리 내어 읽기 · 좋은 응답 · 나쁜 응답 · 재시도
    done: '^(복사|응답 복사|메시지 복사|copy|copy message|소리 내어 읽기|read aloud|다시 시도|재시도|retry|좋아요|싫어요|좋은 응답|나쁜 응답|give positive feedback|give negative feedback)$',
    doneAfterIdle: 2, // 중지 버튼이 이 횟수(초)만큼 이어서 안 보여야 완료 (위 버튼으로 확인되지 않을 때)
  },
  {
    key: 'chatgpt',
    label: 'ChatGPT 앱',
    option: 'watchChatGPTApp',
    procs: ['ChatGPT', 'Codex'],
    exclude: '',
    re: '^(stop|stop streaming|stop generating|stop response|stop task|stop run|스트리밍 중지|응답 중지|생성 중지|작업 중지|중지|정지|멈추기)$',
    approve: '^(승인|허용|항상 허용|한 번 승인|이번만 승인|approve|allow|always allow|approve once)$',
    // 실제 이름 (로그 15:02): 메시지 복사(보낸 메시지) · 복사 · 소리 내어 읽기 · 응답 다시 생성
    done: '^(복사|응답 복사|메시지 복사|copy|copy response|좋은 응답|나쁜 응답|good response|bad response|소리 내어 읽기|read aloud|응답 다시 생성|다시 생성|다시 시도|재생성|try again|regenerate)$',
    // ChatGPT 앱은 답변 도중(생각 → 답변 사이 등) 중지 버튼을 1~3초 숨길 때가 있어서 더 오래 기다린다 (로그 16:36:45~53).
    doneAfterIdle: 5,
  },
]
const APP_WATCH_SCRIPT = path.join(__dirname, 'app-watch.ps1')
const WATCH_LOG = path.join(APP_DIR, 'logs', 'app-watch.log')
// 승인 버튼은 설정 화면 등에도 있을 수 있어서, 최근 15분 안에 답변하던 앱일 때만 '확인 대기'로 본다.
const APPROVE_AFTER_BUSY_MS = 15 * 60 * 1000

const appStates = {} // key → { mood, detail, at }
const appExe = {} // key → 앱의 실행 파일 경로 (실행 중에 알게 된 값, config.appExe 에 기억)
const appInfo = {} // key → { fg: 앞에 떠 있는지, hidden: 트레이로 닫혀 있는지, window }
let appWatcher = null
let appWatcherRetry = null

function watchLog(line) {
  try {
    fs.mkdirSync(path.dirname(WATCH_LOG), { recursive: true })
    if (fs.existsSync(WATCH_LOG) && fs.statSync(WATCH_LOG).size > 256 * 1024) fs.renameSync(WATCH_LOG, WATCH_LOG + '.old')
    fs.appendFileSync(WATCH_LOG, `${new Date().toISOString()} ${line}\n`)
  } catch {}
}

function enabledWatchedApps() {
  return WATCHED_APPS.filter(a => config[a.option] !== false)
}

function customPattern(group, key, fallback) {
  const table = config[group] && typeof config[group] === 'object' ? config[group] : {}
  return typeof table[key] === 'string' && table[key] ? table[key] : fallback
}

function startAppWatch() {
  if (process.platform !== 'win32' || appWatcher) return
  const apps = enabledWatchedApps()
  if (!apps.length) return
  clearTimeout(appWatcherRetry)
  if (!fs.existsSync(APP_WATCH_SCRIPT)) {
    watchLog(`app-watch.ps1 not found: ${APP_WATCH_SCRIPT}`)
    return
  }
  const payload = apps.map(a => ({
    key: a.key,
    procs: a.procs,
    exclude: a.exclude,
    re: customPattern('stopPatterns', a.key, a.re),
    approve: customPattern('approvePatterns', a.key, a.approve),
    done: customPattern('donePatterns', a.key, a.done || ''),
  }))
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', APP_WATCH_SCRIPT], {
    windowsHide: true,
    env: { ...process.env, PET_APPS: JSON.stringify(payload) },
  })
  appWatcher = child
  watchLog(`start pid=${child.pid} apps=${JSON.stringify(payload)}`)
  const track = {} // key → { busySince, lastBusyAt, idleCount, lastKey, lines }
  let buffer = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    buffer += chunk
    let i
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim()
      buffer = buffer.slice(i + 1)
      let s
      try { s = JSON.parse(line) } catch { continue }
      handleAppReading(s, (track[s.key] ||= { busySince: 0, lastBusyAt: 0, idleCount: 0, lastKey: '', lines: 0 }))
    }
  })
  child.stderr.setEncoding('utf8')
  let stderrLines = 0
  child.stderr.on('data', chunk => {
    // 같은 오류가 매초 반복될 수 있어서 처음 20번과 그 뒤 100번에 한 번만 남긴다.
    if (++stderrLines <= 20 || stderrLines % 100 === 0) watchLog(`stderr#${stderrLines} ${String(chunk).trim().slice(0, 300)}`)
  })
  child.on('error', error => watchLog(`spawn error ${error.message}`))
  child.on('exit', code => {
    watchLog(`exit code=${code}`)
    if (appWatcher === child) {
      appWatcher = null
      for (const k of Object.keys(appStates)) delete appStates[k]
      if (!quitting && enabledWatchedApps().length) appWatcherRetry = setTimeout(startAppWatch, 15000)
    }
  })
}

// 중지 버튼이 사라졌고, 답 아래 버튼(복사·좋은 응답…)이 작업 시작 때보다 늘었으면 '진짜 끝'이다.
// 답하는 도중 중지 버튼이 잠깐 숨는 때에는 이 버튼이 생기지 않아서 헷갈리지 않는다.
function doneButtonsGrew(s, t) {
  const grew = Number.isFinite(s.doneCount) && s.doneCount >= 0 && t.doneAtStart >= 0 && s.doneCount > t.doneAtStart
  if (grew) watchLog(`[${s.key}] 답 아래 버튼이 ${t.doneAtStart} → ${s.doneCount}개로 늘어 바로 완료로 봐요`)
  return grew
}

// 감지 프로세스가 1초마다 보내는 앱별 결과 한 줄을 상태로 바꾼다.
function handleAppReading(s, t) {
  t.lines++
  const cands = Array.isArray(s.cands) ? s.cands : s.cands ? [s.cands] : []
  appInfo[s.key] = { app: !!s.app, fg: !!s.fg, hidden: !!s.hidden, window: !!s.window }
  // 답 아래 버튼 수(doneCount)는 대화를 스크롤하기만 해도 바뀌어서 기록 기준에서는 뺀다 (줄에는 함께 적는다).
  const key = `${s.app}|${s.window}|${s.hidden}|${s.busy}|${s.label}|${s.approve}`
  if (key !== t.lastKey) pushSettings()
  // 상태가 바뀔 때, 새 후보 버튼 이름이 보일 때, 그 밖에는 1분에 한 번만 기록한다.
  if (key !== t.lastKey || cands.length || t.lines % 60 === 1) {
    watchLog(`[${s.key}] app=${s.app} window=${s.window}${s.hidden ? ' (hidden)' : ''} fg=${s.fg} busy=${s.busy} label=${s.label || '-'} approve=${s.approve || '-'} done=${s.doneCount ?? '-'} cpu=${s.cpu} scanMs=${s.scanMs}${cands.length ? ` candidates=${JSON.stringify(cands)}` : ''}`)
  }
  t.lastKey = key
  if (s.exe && s.exe !== appExe[s.key]) {
    appExe[s.key] = s.exe
    // 다음 실행 때 앱 아이콘을 바로 보여 주고, 앱이 꺼져 있어도 알림·아이콘으로 열 수 있게 기억해 둔다.
    config.appExe = { ...(config.appExe || {}), [s.key]: s.exe }
    saveConfig()
    refreshLlmIcons()
  }
  const now = Date.now()
  if (s.busy) t.lastBusyAt = now
  // ChatGPT 앱: Codex 작업 기록이 같은 작업을 정확히 알려 주고 있으면 화면 감지는 물러난다.
  // 창이 다른 창에 가려지면 앱이 화면 정보를 갱신하지 않아 '중지' 버튼이 끝난 뒤에도 남아 보이기 때문이다 (로그 14:15:07 완료 → 14:15:27까지 중지).
  // 기록이 진행 중일 때 보인 '중지'는 그 작업의 것으로 보고, 화면에서 중지 버튼이 사라질 때까지 화면 쪽 상태는 쓰지 않는다.
  if (s.key === 'chatgpt' && codexWatch) {
    if (s.busy && codexWatch.info().active > 0) {
      if (!t.covered) watchLog('[chatgpt] 화면의 중지 버튼은 Codex 작업 기록이 대신 알려 줘요')
      t.covered = true
    }
    if (!s.busy) t.covered = false
    if (t.covered) {
      t.busySince = 0
      t.idleCount = 0
      appStates[s.key] = s.approve && now - t.lastBusyAt < APPROVE_AFTER_BUSY_MS
        ? { mood: 'waiting', detail: `"${s.approve}" 눌러 줘`, at: now }
        : { mood: 'idle', detail: '', at: 0 }
      return
    }
  }
  if (s.approve && now - t.lastBusyAt < APPROVE_AFTER_BUSY_MS) {
    // 작업 도중 권한을 묻는 중. 승인하면 다시 작업 중으로, 시간은 이어서 잰다.
    if (!t.busySince) t.busySince = now
    t.idleCount = 0
    appStates[s.key] = { mood: 'waiting', detail: `"${s.approve}" 눌러 줘`, at: now }
  } else if (s.busy) {
    t.idleCount = 0
    if (!t.busySince) { t.busySince = now; t.doneAtStart = Number.isFinite(s.doneCount) ? s.doneCount : -1 }
    appStates[s.key] = { mood: 'working', detail: '', at: now }
  } else if (t.busySince && (doneButtonsGrew(s, t) || ++t.idleCount >= (WATCHED_APPS.find(a => a.key === s.key)?.doneAfterIdle || 2))) {
    // 중지 버튼이 몇 초 이어서 사라졌을 때만 완료로 본다 (답변 중간에 잠깐 숨는 순간은 무시).
    appStates[s.key] = now - t.busySince >= 3000 ? { mood: 'done', detail: '', at: now } : { mood: 'idle', detail: '', at: 0 }
    t.busySince = 0
  }
}

function stopAppWatch() {
  clearTimeout(appWatcherRetry)
  const child = appWatcher
  appWatcher = null
  for (const k of Object.keys(appStates)) delete appStates[k]
  if (child) try { child.kill() } catch {}
}

// 감지할 앱 목록이 바뀌면 PowerShell을 새로 띄운다.
function restartAppWatch() {
  stopAppWatch()
  startAppWatch()
}

// ---------- LLM 아이콘 (작업 중일 때 캐릭터 주위를 도는 아이콘) ----------
// 1) pets/icons/claude.png · gpt.png 가 있으면 그 그림
// 2) 없으면 PC에 설치된 Claude 앱 · ChatGPT 앱 실행 파일의 아이콘
// 3) 그것도 없으면 화면에서 글자 배지로 대신한다.
const ICONS_DIR = path.join(PETS_DIR, 'icons')
const LLM_ORDER = llmStatus.PROVIDERS.map(p => p.id)
const llmIconImages = {} // 알림 풍선에 쓰는 같은 아이콘 (NativeImage)
const LLM_APP_KEY = { claude: 'claude', gpt: 'chatgpt' }
let llmIcons = { claude: null, gpt: null }
let llmIconKey = ''

function llmExeCandidates(llm) {
  const local = process.env.LOCALAPPDATA || ''
  const known = llm === 'claude'
    ? [path.join(local, 'AnthropicClaude', 'claude.exe'), path.join(local, 'Programs', 'Claude', 'Claude.exe')]
    : [path.join(local, 'Programs', 'ChatGPT', 'ChatGPT.exe'), path.join(local, 'Programs', 'Codex', 'Codex.exe')]
  const remembered = config.appExe && typeof config.appExe[LLM_APP_KEY[llm]] === 'string' ? config.appExe[LLM_APP_KEY[llm]] : ''
  return [...new Set([appExe[LLM_APP_KEY[llm]], remembered, ...known])].filter(p => p && fs.existsSync(p))
}

function customIconPath(llm) {
  const file = path.join(ICONS_DIR, `${llm}.png`)
  return fs.existsSync(file) ? file : null
}

// Microsoft Store(MSIX) 앱은 실행 파일에 앱 아이콘이 없고, 패키지의 AppxManifest.xml 이 가리키는 로고 PNG를 쓴다.
// 로고 파일은 크기·배율별로 여러 장(예: AppList.targetsize-48.png, .scale-200.png)이라 64px에 가까운 것을 고른다.
function msixLogo(exe) {
  const match = /^(.*\\WindowsApps\\[^\\]+)\\/i.exec(exe)
  if (!match) return null
  const root = match[1]
  let manifest
  try { manifest = fs.readFileSync(path.join(root, 'AppxManifest.xml'), 'utf8') } catch { return null }
  const relatives = []
  for (const attr of ['Square44x44Logo', 'Square150x150Logo']) {
    const found = new RegExp(`${attr}="([^"]+)"`).exec(manifest)
    if (found) relatives.push(found[1])
  }
  const logo = /<Logo>([^<]+)<\/Logo>/.exec(manifest)
  if (logo) relatives.push(logo[1])
  const score = name => {
    const lower = name.toLowerCase()
    if (lower.includes('contrast')) return -1000 // 고대비 테마용은 제외
    let value = 0
    const target = /targetsize-(\d+)/.exec(lower)
    if (target) value += 100 - Math.abs(Number(target[1]) - 64)
    const scale = /scale-(\d+)/.exec(lower)
    if (scale) value += 50 - Math.abs(Number(scale[1]) - 200) / 10
    if (lower.includes('altform-unplated')) value += 30 // 배경판 없는 버전이 트레이·펫에 잘 어울린다
    if (lower.includes('lightunplated')) value -= 20
    return value
  }
  for (const relative of relatives) {
    const full = path.join(root, relative.replace(/\//g, '\\'))
    const dir = path.dirname(full)
    const ext = path.extname(full).toLowerCase()
    const base = path.basename(full, path.extname(full)).toLowerCase()
    let files = []
    try { files = fs.readdirSync(dir) } catch { continue }
    const candidates = files.filter(f => f.toLowerCase().startsWith(base + '.') || f.toLowerCase() === base + ext).filter(f => f.toLowerCase().endsWith(ext))
    if (!candidates.length) continue
    const best = candidates.sort((x, y) => score(y) - score(x))[0]
    if (score(best) > -1000) return path.join(dir, best)
  }
  return null
}

// 흰색 위주 로고(어두운 작업 표시줄용)는 흰 원 위에서 안 보이므로 어두운 원 위에 그린다.
function isLightIcon(image) {
  try {
    const bmp = image.toBitmap() // BGRA
    let sum = 0, count = 0
    for (let i = 0; i < bmp.length; i += 4) {
      if (bmp[i + 3] < 128) continue
      sum += 0.114 * bmp[i] + 0.587 * bmp[i + 1] + 0.299 * bmp[i + 2]
      count++
    }
    return count > 0 && sum / count > 200
  } catch {
    return false
  }
}

async function resolveLlmIcon(llm) {
  const done = (image, source) => {
    llmIconImages[llm] = image.resize({ width: 64, height: 64, quality: 'best' })
    // 어떤 아이콘을 어디서 가져왔는지 남긴다 (아이콘이 이상할 때 원인 확인용).
    watchLog(`icon ${llm}: ${source}`)
    try {
      fs.mkdirSync(path.dirname(WATCH_LOG), { recursive: true })
      fs.writeFileSync(path.join(path.dirname(WATCH_LOG), `icon-${llm}.png`), image.toPNG())
    } catch {}
    return { url: image.toDataURL(), dark: isLightIcon(image) }
  }
  const custom = customIconPath(llm)
  if (custom) {
    const image = nativeImage.createFromPath(custom)
    if (!image.isEmpty()) return done(image.resize({ height: 64, quality: 'best' }), `custom ${custom}`)
  }
  if (process.platform !== 'win32' && process.platform !== 'darwin') return null
  for (const exe of llmExeCandidates(llm)) {
    const logo = process.platform === 'win32' ? msixLogo(exe) : null
    if (logo) {
      const image = nativeImage.createFromPath(logo)
      if (!image.isEmpty()) return done(image.resize({ height: 64, quality: 'best' }), `store-logo ${logo} (exe ${exe})`)
    }
    try {
      const image = await app.getFileIcon(exe, { size: 'large' })
      if (image && !image.isEmpty()) return done(image, `exe-icon ${exe}`)
    } catch {}
  }
  if (appExe[LLM_APP_KEY[llm]]) watchLog(`icon ${llm}: none (exe ${appExe[LLM_APP_KEY[llm]]})`)
  delete llmIconImages[llm]
  return null
}

function llmIconsKey() {
  return LLM_ORDER.map(llm => {
    const custom = customIconPath(llm)
    let mtime = 0
    try { if (custom) mtime = fs.statSync(custom).mtimeMs } catch {}
    return `${custom || ''}:${mtime}:${llmExeCandidates(llm)[0] || ''}`
  }).join('|')
}

let iconRefresh = null
function refreshLlmIcons(force = false) {
  const key = llmIconsKey()
  if (!force && key === llmIconKey) return iconRefresh
  llmIconKey = key
  iconRefresh = (async () => {
    const next = {}
    for (const llm of LLM_ORDER) next[llm] = await resolveLlmIcon(llm)
    if (JSON.stringify(next) !== JSON.stringify(llmIcons)) {
      llmIcons = next
      pushConfig()
    }
  })()
  return iconRefresh
}

// ---------- 트레이 ----------

function dotIcon() {
  // 16x16 투명 배경에 둥근 점 하나 (시트를 못 읽을 때 쓰는 최소한의 아이콘)
  const size = 16
  const buf = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - 7.5
      const dy = y - 7.5
      const inside = dx * dx + dy * dy <= 36
      const i = (y * size + x) * 4
      buf[i] = 87
      buf[i + 1] = 119
      buf[i + 2] = 217
      buf[i + 3] = inside ? 255 : 0
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size })
}

// 쉬기 첫 그림을 정사각형으로 맞춰 트레이 아이콘으로 쓴다.
let trayIconKey = ''
let trayIconImage = null
function trayIcon() {
  const sprite = activeSprite()
  const key = sprite ? sprite.key : 'dot'
  if (key === trayIconKey && trayIconImage) return trayIconImage
  let icon = null
  if (sprite) {
    try {
      const anim = sprite.animations.idle || Object.values(sprite.animations)[0]
      const f = anim.frames[0]
      const frame = nativeImage.createFromPath(sprite.imagePath).crop({ x: f.x, y: f.y, width: f.w, height: f.h })
      const { width: w, height: h } = frame.getSize()
      const side = Math.max(w, h)
      const src = frame.toBitmap()
      const buf = Buffer.alloc(side * side * 4)
      const ox = Math.floor((side - w) / 2), oy = Math.floor((side - h) / 2)
      for (let y = 0; y < h; y++) src.copy(buf, ((y + oy) * side + ox) * 4, y * w * 4, (y + 1) * w * 4)
      const square = nativeImage.createFromBitmap(buf, { width: side, height: side })
      icon = nativeImage.createEmpty()
      for (const scaleFactor of [1, 1.5, 2]) {
        const px = Math.round(16 * scaleFactor)
        icon.addRepresentation({ scaleFactor, buffer: square.resize({ width: px, height: px, quality: 'best' }).toPNG() })
      }
      if (icon.isEmpty()) icon = null
    } catch {
      icon = null
    }
  }
  trayIconKey = key
  trayIconImage = icon || dotIcon()
  return trayIconImage
}

function updateTrayTooltip() {
  if (!tray || tray.isDestroyed()) return
  // 한 줄에 AI 하나씩: "Claude 앱 · 작업 중 2분". Windows 툴팁은 127자까지라 잘라 둔다.
  const { mood, providers = [] } = currentStatus
  const now = Date.now()
  const lines = providers.map(p => `${p.source || p.label} · ${MOOD_LABEL[p.state] || p.state}${p.state === 'working' || p.state === 'waiting' ? ` ${llmStatus.formatDuration(now - (p.jobStart || p.since))}` : ''}`)
  const head = `${config.name} — ${MOOD_LABEL[mood] || mood}`
  tray.setToolTip([head, ...lines].join('\n').slice(0, 127))
}

function refreshTray() {
  if (!tray || tray.isDestroyed()) return
  tray.setImage(trayIcon())
  tray.setContextMenu(buildMenu())
  updateTrayTooltip()
  pushSettings()
}

function setOption(key, value, after) {
  config[key] = value
  saveConfig()
  if (after) after()
  pushConfig()
  refreshTray()
}

// 우클릭·트레이 메뉴는 자주 쓰는 것만 둔다. 나머지 설정은 설정 창(컨트롤센터)에 있다.
function buildMenu() {
  const effectiveSize = petHeight()
  return Menu.buildFromTemplate([
    { label: '설정 열기…', click: () => openSettings() },
    ...(playOn('snack') ? [{ label: '간식 주기', click: () => playNow('snack') }] : []),
    { type: 'separator' },
    {
      label: win && win.isVisible() ? '펫 숨기기' : '펫 보이기',
      click: () => setPetVisible(!(win && win.isVisible())),
    },
    {
      label: '자동 산책',
      type: 'checkbox',
      checked: config.wander,
      click: item => setOption('wander', item.checked, scheduleWalk),
    },
    {
      label: '혼잣말',
      type: 'checkbox',
      checked: config.chatter === true,
      click: item => setOption('chatter', item.checked),
    },
    {
      label: '크기',
      submenu: SIZES.map(size => ({
        label: size.label,
        type: 'radio',
        checked: effectiveSize === size.value,
        click: () => setOption('size', size.value, () => { applyWindowHeight(); pushViewport() }),
      })),
    },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ])
}

// 설정 창의 '지금 해 보기'와 메뉴의 '간식 주기'
function playNow(id) {
  if (!PLAY_IDS.includes(id) || !win || win.isDestroyed()) return false
  if (!win.isVisible()) setPetVisible(true)
  win.webContents.send('pet:play', id)
  if (id === 'flee') {
    lastFleeAt = Date.now()
    napping = false
    dash(Math.random() < 0.5 ? -1 : 1, Math.random() - 0.5)
  }
  return true
}

function setPetVisible(visible) {
  if (!win || win.isDestroyed()) return
  visible ? win.showInactive() : win.hide()
  refreshTray()
}

// ---------- 설정 창 (컨트롤센터) ----------
// renderer/settings.html. 펫 창과는 따로 settings-preload.js 로 필요한 기능만 연다.
// 상태는 main 이 한 덩어리(settingsState)로 만들어 보내고, 바뀐 게 있을 때마다 다시 보낸다.
let settingsWin = null
let settingsPushTimer = null
let nodeInfo // undefined: 아직 모름, null: 없음, 'v20.x': 있음

// 설정 값 이름 → 바꾼 뒤 할 일. 여기 없는 이름은 설정 창에서 바꿀 수 없다.
const SETTABLE = {
  wander: () => scheduleWalk(),
  walk2d: null,
  chatter: null,
  orbit: null,
  notify: null,
  meaningBasic: null,
  meaningAI: null,
  size: () => { applyWindowHeight(); pushViewport() },
  useSprite: () => { applyWindowHeight(); pushViewport() },
  species: null,
  playAll: null,
  watchClaudeApp: () => restartAppWatch(),
  watchChatGPTApp: () => restartAppWatch(),
  watchCodexSessions: () => startCodexWatch(),
}

function markHookSeen(target) {
  if (config.hookSeen && config.hookSeen[target]) return
  config.hookSeen = { ...(config.hookSeen || {}), [target]: Date.now() }
  saveConfig()
  pushSettings()
}

function refreshNodeInfo() {
  return nodeVersion().then(version => {
    if (version === nodeInfo) return
    nodeInfo = version
    pushSettings()
  })
}

const homeShort = file => {
  const home = os.homedir()
  return file.toLowerCase().startsWith(home.toLowerCase()) ? '~' + file.slice(home.length) : file
}

function readmePath() {
  return [path.join(APP_DIR, 'README.md'), path.join(__dirname, 'README.md')].find(p => fs.existsSync(p)) || null
}

function settingsState() {
  const sprite = loadSprite()
  const now = Date.now()
  const loginSupported = app.isPackaged && (process.platform === 'win32' || process.platform === 'darwin')
  return {
    now,
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
    name: config.name,
    config: {
      wander: !!config.wander,
      walk2d: config.walk2d !== false,
      chatter: config.chatter === true,
      orbit: config.orbit !== false,
      notify: config.notify !== false,
      meaningBasic: config.meaningBasic === true,
      meaningAI: config.meaningAI !== false,
      size: petHeight(),
      useSprite: config.useSprite !== false,
      species: config.species,
      playAll: config.playAll !== false,
    },
    play: Object.fromEntries(PLAY_IDS.map(id => [id, !(config.play && config.play[id] === false)])),
    sizes: SIZES,
    species: SPECIES.map(id => ({ id, label: SPECIES_LABEL[id] })),
    petVisible: !!(win && !win.isDestroyed() && win.isVisible()),
    login: { supported: loginSupported, on: loginSupported ? app.getLoginItemSettings().openAtLogin : false },
    status: currentStatus,
    apps: WATCHED_APPS.map(a => ({
      key: a.key,
      label: a.label,
      on: config[a.option] !== false,
      supported: process.platform === 'win32',
      watching: !!appWatcher,
      info: appInfo[a.key] || null,
      doneAfterIdle: a.doneAfterIdle,
    })),
    hooks: Object.entries(HOOK_TARGETS).map(([id, t]) => ({
      id,
      label: t.label,
      file: homeShort(t.file),
      installed: hooksInstalled(id),
      seen: (config.hookSeen && config.hookSeen[id]) || 0,
    })),
    node: nodeInfo,
    codexSessions: (() => {
      const info = codexWatch ? codexWatch.info() : null
      return { on: config.watchCodexSessions !== false, rootFound: !!(info && info.rootFound), files: info ? info.files : 0, active: info ? info.active : 0, lastEventAt: info ? info.lastEventAt : 0, root: homeShort(require('./codex-sessions').defaultRoot()) }
    })(),
    codexTrustDismissed: !!config.codexTrustDismissed,
    icons: llmIcons,
    sprite: sprite ? { key: sprite.key, source: sprite.source, rows: sprite.rows, file: homeShort(sprite.imagePath), animations: Object.keys(sprite.animations) } : null,
    spriteKey: config.useSprite === false || !sprite ? '' : sprite.key,
    paths: { pets: homeShort(PETS_DIR), data: homeShort(DATA_DIR), logs: homeShort(path.dirname(WATCH_LOG)) },
    readme: !!readmePath(),
  }
}

// 그림 시트는 크니까 상태와 따로, 바뀔 때만 보낸다.
function settingsSprite() {
  const sprite = activeSprite() || loadSprite()
  if (!sprite) return null
  const animations = {}
  for (const [mood, a] of Object.entries(sprite.animations)) animations[mood] = { frames: a.frames, fps: a.fps }
  return { key: sprite.key, url: sprite.url, animations, refHeight: sprite.refHeight }
}

function pushSettings() {
  if (!settingsWin || settingsWin.isDestroyed() || settingsPushTimer) return
  settingsPushTimer = setTimeout(() => {
    settingsPushTimer = null
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('settings:state', settingsState())
  }, 80)
}

// 작업 표시줄·Alt+Tab 에 보일 큰 아이콘 (쉬기 첫 그림)
function petIconImage(px) {
  const sprite = loadSprite()
  if (!sprite) return null
  try {
    const anim = sprite.animations.idle || Object.values(sprite.animations)[0]
    const f = anim.frames[0]
    const frame = nativeImage.createFromPath(sprite.imagePath).crop({ x: f.x, y: f.y, width: f.w, height: f.h })
    const side = Math.max(f.w, f.h)
    const src = frame.toBitmap()
    const buf = Buffer.alloc(side * side * 4)
    const ox = Math.floor((side - f.w) / 2), oy = Math.floor((side - f.h) / 2)
    for (let y = 0; y < f.h; y++) src.copy(buf, ((y + oy) * side + ox) * 4, y * f.w * 4, (y + 1) * f.w * 4)
    return nativeImage.createFromBitmap(buf, { width: side, height: side }).resize({ width: px, height: px, quality: 'best' })
  } catch {
    return null
  }
}

function openSettings(page) {
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (page) settingsWin.webContents.send('settings:navigate', page)
    if (settingsWin.isMinimized()) settingsWin.restore()
    settingsWin.show()
    settingsWin.focus()
    return
  }
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const width = Math.min(1120, workArea.width - 48)
  const height = Math.min(820, workArea.height - 48)
  const icon = petIconImage(64)
  settingsWin = new BrowserWindow({
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    minWidth: Math.min(720, width),
    minHeight: Math.min(540, height),
    show: false,
    title: `${config.name} 펫 설정`,
    backgroundColor: '#FFF9ED',
    autoHideMenuBar: true,
    ...(icon ? { icon } : {}),
    webPreferences: { preload: path.join(__dirname, 'settings-preload.js'), contextIsolation: true, sandbox: true },
  })
  settingsWin.setMenu(null)
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'), { hash: page || 'home' })
  settingsWin.once('ready-to-show', () => settingsWin && settingsWin.show())
  settingsWin.on('closed', () => { settingsWin = null })
  settingsWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  settingsWin.webContents.on('will-navigate', e => e.preventDefault())
  refreshNodeInfo()
}

function openPath(target) {
  const dirs = { pets: PETS_DIR, data: DATA_DIR, logs: path.dirname(WATCH_LOG) }
  if (dirs[target]) {
    try { fs.mkdirSync(dirs[target], { recursive: true }) } catch {}
    return shell.openPath(dirs[target])
  }
  if (target === 'log') return shell.openPath(fs.existsSync(WATCH_LOG) ? WATCH_LOG : path.dirname(WATCH_LOG))
  if (target === 'readme') {
    const file = readmePath()
    return file ? shell.openPath(file) : Promise.resolve('')
  }
  return Promise.resolve('')
}

// 알림이 어떻게 보이는지 직접 확인하는 버튼. 앞에 떠 있는 앱이어도 보낸다.
function testNotify(kind) {
  const samples = {
    done: ['claude', 'Claude 앱 작업 완료', '3분 12초 걸렸어요. 눌러서 열기'],
    waiting: ['gpt', 'ChatGPT 앱이 확인을 기다려요', '"승인" 눌러 줘'],
    error: ['claude', 'Claude 앱 오류', '응답이 중단됐어요'],
  }
  const [provider, title, content] = samples[kind] || samples.done
  if (config.notify === false) return 'off'
  notify(provider, `[시험] ${title}`, content)
  return 'sent'
}

const SETTINGS_ACTIONS = {
  set: ([key, value]) => {
    if (typeof key === 'string' && key.startsWith('play.')) {
      const id = key.slice(5)
      if (!PLAY_IDS.includes(id) || typeof value !== 'boolean') return false
      setOption('play', { ...(config.play || {}), [id]: value })
      return true
    }
    if (!(key in SETTABLE)) return false
    if (key === 'size' && !SIZES.some(s => s.value === value)) return false
    if (key === 'species' && !SPECIES.includes(value)) return false
    if (key !== 'size' && key !== 'species' && typeof value !== 'boolean') return false
    setOption(key, value, SETTABLE[key])
    return true
  },
  login: ([on]) => {
    app.setLoginItemSettings({ openAtLogin: !!on })
    refreshTray()
    return true
  },
  petVisible: ([visible]) => { setPetVisible(!!visible); return true },
  hooks: ([target, install]) => {
    if (!HOOK_TARGETS[target]) return false
    toggleHooks(target, !!install, settingsWin)
    return true
  },
  focus: ([provider]) => (llmStatus.PROVIDERS.some(p => p.id === provider) ? focusProvider(provider) : false),
  open: ([target]) => { openPath(target); return true },
  nodeDownload: () => { shell.openExternal('https://nodejs.org/ko/download'); return true },
  testNotify: ([kind]) => testNotify(kind),
  playNow: ([id]) => playNow(id),
  codexTrust: ([dismissed]) => { config.codexTrustDismissed = !!dismissed; saveConfig(); pushSettings(); return true },
  quit: () => { app.quit(); return true },
}

// ---------- IPC ----------

ipcMain.on('pet:move-by', (_, dx, dy) => {
  if (!win) return
  const [x, y] = win.getPosition()
  const [nx, ny] = clampToScreen(x + Math.round(dx), y + Math.round(dy))
  moveWindow(nx, ny)
})
ipcMain.on('pet:drag-start', () => {
  if (!win || win.isDestroyed()) return
  const cursor = screen.getCursorScreenPoint()
  const [x, y] = win.getPosition()
  dragAnchor = { x: cursor.x - x, y: cursor.y - y }
  win.setIgnoreMouseEvents(false)
})
// 드래그 중에는 화면 이벤트마다 바로 따라가서 끊김 없이 움직인다 (40ms 주기만 쓰면 25fps로 끊겨 보임).
ipcMain.on('pet:drag-move', followDrag)
// 화면(펫·설정 창)에서 난 오류를 감지 기록에 남긴다. 같은 오류는 1분에 한 번만.
const rendererErrors = new Map()
ipcMain.on('pet:error', (event, where, message) => {
  const text = `${String(where).slice(0, 20)} ${String(message).slice(0, 300)}`
  const now = Date.now()
  if (now - (rendererErrors.get(text) || 0) < 60000) return
  rendererErrors.set(text, now)
  if (rendererErrors.size > 50) rendererErrors.delete(rendererErrors.keys().next().value)
  watchLog(`renderer error ${text}`)
})
// 낮잠·상호작용이 시작되면 걷던 걸음을 멈추고, 끝나면 산책 일정을 다시 잡는다 (도망가는 중에는 건드리지 않는다).
function setPetBusy(kind, value) {
  const before = napping || playing
  if (kind === 'nap') napping = value
  else playing = value
  const now = napping || playing
  if (now && !before && !dashing) {
    walkGeneration++
    clearTimeout(walkTimer)
    if (win && !win.isDestroyed()) win.webContents.send('pet:walk', 0)
  } else if (!now && before && !dashing) scheduleWalk()
}
ipcMain.on('pet:napping', (_, value) => setPetBusy('nap', value === true))
ipcMain.on('pet:playing', (_, value) => setPetBusy('play', value === true))
ipcMain.on('pet:interactive', (_, hit) => {
  if (!win || win.isDestroyed() || dragAnchor) return
  win.setIgnoreMouseEvents(hit !== true, { forward: true })
})
ipcMain.on('pet:drag-end', () => {
  followDrag()
  dragAnchor = null
})
ipcMain.handle('pet:focus-provider', (_, provider) => (llmStatus.PROVIDERS.some(p => p.id === provider) ? focusProvider(provider) : false))
ipcMain.on('pet:menu', () => {
  if (win) buildMenu().popup({ window: win })
})
ipcMain.handle('pet:get-config', () => configForRenderer())
ipcMain.handle('settings:get-state', () => settingsState())
ipcMain.handle('settings:get-sprite', () => settingsSprite())
ipcMain.handle('settings:action', (event, name, args) => {
  if (!settingsWin || event.sender !== settingsWin.webContents) return false
  const action = SETTINGS_ACTIONS[name]
  return action ? action(Array.isArray(args) ? args : []) : false
})
ipcMain.on('pet:rename', (_, name) => {
  config.name = String(name).slice(0, 12) || config.name
  saveConfig()
  pushConfig()
  refreshTray()
})

// ---------- 시작 ----------

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // 펫이 이미 켜져 있을 때 UsagiPet.exe 를 다시 실행하면 설정 창을 연다.
  app.on('second-instance', (_, argv = []) => {
    // 알림 센터에서 알림을 누르면 Windows가 앱을 한 번 더 실행할 수 있다. 그때는 설정 창을 열지 않는다.
    if (argv.some(arg => /^-(ToastActivated|Embedding)$/i.test(arg))) { watchLog(`second-instance from toast ${JSON.stringify(argv.slice(1))}`); return }
    if (win && !win.isVisible()) setPetVisible(true)
    openSettings()
  })
  app.whenReady().then(() => {
    loadConfig()
    ensureAppIdentity()
    createWindow()
    tray = new Tray(trayIcon())
    refreshTray()
    // 알림이 실제로 떴는지·눌렸는지 기록한다 (알림을 눌러도 반응이 없을 때 원인 확인용).
    tray.on('balloon-show', () => watchLog(`balloon shown [${balloonProvider || '-'}]`))
    tray.on('balloon-closed', () => watchLog('balloon closed'))
    tray.on('balloon-click', () => {
      watchLog(`balloon clicked [${balloonProvider || '-'}]`)
      if (balloonProvider) focusProvider(balloonProvider)
    })
    tray.on('click', () => setPetVisible(!(win && win.isVisible())))
    tray.on('double-click', () => openSettings())
    if (process.platform === 'darwin' && app.dock) app.dock.hide()
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
      screen.on(event, () => setTimeout(keepOnScreen, 300))
    }
    startAppWatch()
    startCodexWatch()
    setTimeout(() => loadStartApps(), 4000) // 알림·아이콘 클릭으로 앱을 열 때 바로 쓰도록 미리
    refreshLlmIcons(true)
    watchStatus()
    watchCursor()
    watchUserIdle()
    watchSpriteFolder()
    scheduleWalk()
  })
  app.on('before-quit', () => { quitting = true; stopAppWatch() })
  // 설정 창만 닫았을 때는 끄지 않는다 (펫 창이 남아 있으면 계속 실행).
  app.on('window-all-closed', () => { if (!win || win.isDestroyed()) app.quit() })
}
