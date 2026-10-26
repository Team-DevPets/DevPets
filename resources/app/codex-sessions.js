// Codex 작업 기록 읽기 — ChatGPT(Codex) 데스크톱 앱이 직접 남기는 상태
//
// Codex(CLI·데스크톱 앱)는 대화(스레드)마다 ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl 에 한 줄씩 실시간으로 기록한다.
// 화면 버튼을 읽는 대신 이 기록에서 작업 시작·진행·완료를 바로 읽는다 (창이 숨어 있어도 정확하다).
//   첫 줄            {"type":"session_meta","payload":{ originator, source, thread_source, ... }}
//   작업 시작        {"type":"event_msg","payload":{"type":"task_started","turn_id", "started_at": 초}}
//   단계 하나 끝남   {"type":"event_msg","payload":{"type":"item_completed","turn_id","item":{"type":"CommandExecution"|"FileChange"|...}}}
//   작업 완료        {"type":"event_msg","payload":{"type":"task_complete","turn_id","completed_at": 초,"duration_ms"}}
//   중단             {"type":"event_msg","payload":{"type":"turn_aborted","turn_id","reason"}}
// 승인(확인 대기)은 기록되지 않아서 화면 감지(app-watch.ps1)가 맡는다.
// 하위 에이전트(자동 검토 guardian 등) 스레드는 본 작업과 겹치므로 무시한다.
// 대화 내용(메시지·명령 출력)은 읽어도 쓰지 않는다. 필요한 건 이벤트 종류와 시각뿐이다.

const fs = require('fs')
const path = require('path')

const STEP_LABEL = {
  CommandExecution: '명령 실행',
  FileChange: '파일 고치기',
  McpToolCall: '도구 쓰기',
  WebSearch: '웹 검색',
  ImageView: '이미지 보기',
  SubAgentActivity: '도우미에게 맡기기',
  Reasoning: '생각하는 중',
  AgentMessage: '답 쓰는 중',
  ContextCompaction: '대화 정리',
}
const RECENT_FILE_MS = 48 * 60 * 60 * 1000 // 이보다 오래 안 바뀐 기록 파일은 보지 않는다
const FIRST_TAIL_BYTES = 512 * 1024 // 처음 볼 때는 끝부분만 읽어 지금 상태를 잡는다
const MAX_READ_BYTES = 8 * 1024 * 1024 // 한 번에 너무 많이 쌓였으면 끝부분만 읽는다
const OPEN_TURN_MAX_MS = 30 * 60 * 1000 // 파일이 30분 넘게 안 바뀐 '진행 중' 작업은 앱이 꺼진 것으로 본다
const DONE_KEEP_MS = 5 * 60 * 1000

function defaultRoot() {
  const home = process.env.CODEX_HOME || path.join(require('os').homedir(), '.codex')
  return path.join(home, 'sessions')
}

// 작업 목록에는 프로젝트 이름만 보여 준다. 전체 경로와 대화 내용은 노출하지 않는다.
function projectName(cwd) {
  const value = typeof cwd === 'string' ? cwd.replace(/[\\/]+$/, '') : ''
  return value ? value.split(/[\\/]/).pop().slice(0, 80) : ''
}

function createCodexSessionWatcher({ root = defaultRoot(), log = () => {}, now = Date.now } = {}) {
  const files = new Map() // 파일 경로 → 상태
  let lastEventAt = 0
  let rootFound = false

  function readFirstLine(file) {
    let fd
    try {
      fd = fs.openSync(file, 'r')
      const chunks = []
      const buf = Buffer.alloc(64 * 1024)
      let pos = 0
      for (let i = 0; i < 64; i++) { // 첫 줄(설정)은 수십 KB일 수 있다. 최대 4MB까지
        const n = fs.readSync(fd, buf, 0, buf.length, pos)
        if (!n) break
        const nl = buf.subarray(0, n).indexOf(10)
        if (nl >= 0) { chunks.push(Buffer.from(buf.subarray(0, nl))); break }
        chunks.push(Buffer.from(buf.subarray(0, n)))
        pos += n
      }
      return Buffer.concat(chunks).toString('utf8')
    } catch {
      return ''
    } finally {
      if (fd !== undefined) try { fs.closeSync(fd) } catch {}
    }
  }

  function isSubagent(meta) {
    const source = meta && meta.source
    return !!(source && typeof source === 'object' && source.subagent) || /guardian/i.test(String(meta && meta.thread_source || ''))
  }

  function track(file, size, mtimeMs, isNew) {
    let meta = null
    try { meta = JSON.parse(readFirstLine(file)).payload || null } catch {}
    const f = {
      file,
      offset: isNew ? 0 : Math.max(0, size - FIRST_TAIL_BYTES),
      rest: '',
      skipPartial: !isNew && size > FIRST_TAIL_BYTES,
      ignore: isSubagent(meta),
      originator: meta && meta.originator ? String(meta.originator) : '',
      sessionId: String((meta && (meta.id || meta.thread_id)) || path.basename(file).replace(/^rollout-/, '').replace(/\.jsonl$/i, '')).slice(0, 80),
      project: projectName(meta && (meta.cwd || meta.project_path)),
      turn: null, // { id, startedAt, detail, lastAt }
      done: null, // { at, duration }
      mtimeMs,
    }
    files.set(file, f)
    if (!f.ignore) readNew(f, size)
    return f
  }

  function handle(f, o) {
    const p = o.payload || {}
    const at = Date.parse(o.timestamp) || now()
    if (p.type === 'task_started') {
      f.turn = { id: p.turn_id, startedAt: Number(p.started_at) ? Number(p.started_at) * 1000 : at, detail: '', lastAt: at }
      f.done = null
    } else if (p.type === 'item_completed') {
      if (!f.turn) return
      const kind = p.item && p.item.type
      if (STEP_LABEL[kind]) f.turn.detail = STEP_LABEL[kind]
      f.turn.lastAt = at
    } else if (p.type === 'task_complete') {
      const started = f.turn ? f.turn.startedAt : (Number(p.started_at) ? Number(p.started_at) * 1000 : at)
      f.turn = null
      f.done = { at: Number(p.completed_at) ? Number(p.completed_at) * 1000 : at, duration: Number(p.duration_ms) || at - started }
    } else if (p.type === 'turn_aborted') {
      f.turn = null
      f.done = null
    } else return
    lastEventAt = Math.max(lastEventAt, at)
  }

  function readNew(f, size) {
    if (size < f.offset) { f.offset = 0; f.rest = ''; f.skipPartial = false } // 파일이 새로 쓰였다
    if (size === f.offset) return
    if (size - f.offset > MAX_READ_BYTES) { f.offset = size - FIRST_TAIL_BYTES; f.rest = ''; f.skipPartial = true }
    let fd
    let text = ''
    try {
      fd = fs.openSync(f.file, 'r')
      const buf = Buffer.alloc(size - f.offset)
      const n = fs.readSync(fd, buf, 0, buf.length, f.offset)
      f.offset += n
      text = buf.subarray(0, n).toString('utf8')
    } catch {
      return
    } finally {
      if (fd !== undefined) try { fs.closeSync(fd) } catch {}
    }
    const lines = (f.rest + text).split('\n')
    f.rest = lines.pop() // 아직 다 안 쓰인 마지막 줄은 다음에
    if (f.skipPartial) { lines.shift(); f.skipPartial = false } // 중간부터 읽었으면 첫 조각은 버린다
    for (const line of lines) {
      // 필요한 이벤트 줄만 해석한다 (명령 출력 같은 큰 줄은 건너뛴다)
      if (line.indexOf('"event_msg"') < 0) continue
      if (!/"type":\s*"(task_started|task_complete|turn_aborted|item_completed)"/.test(line)) continue
      try { handle(f, JSON.parse(line)) } catch {}
    }
  }

  // 기록 폴더를 훑어 최근에 바뀐 파일을 찾는다 (YYYY/MM/DD/*.jsonl). 몇십 개라 가볍다.
  function scan() {
    const found = []
    const walk = (dir, depth) => {
      let names = []
      try { names = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const d of names) {
        const full = path.join(dir, d.name)
        if (d.isDirectory() && depth < 3) walk(full, depth + 1)
        else if (d.isFile() && d.name.endsWith('.jsonl')) found.push(full)
      }
    }
    rootFound = fs.existsSync(root)
    if (!rootFound) return
    walk(root, 0)
    const t = now()
    for (const file of found) {
      if (files.has(file)) continue
      let st
      try { st = fs.statSync(file) } catch { continue }
      if (t - st.mtimeMs > RECENT_FILE_MS) continue
      // 방금 생긴 파일은 처음부터, 원래 있던 파일은 끝부분만 읽는다
      track(file, st.size, st.mtimeMs, files.size > 0 && t - st.birthtimeMs < 60 * 1000)
    }
  }

  // 아는 파일들에 새로 쓰인 줄을 읽는다
  function poll() {
    for (const f of files.values()) {
      if (f.ignore) continue
      let st
      try { st = fs.statSync(f.file) } catch { files.delete(f.file); continue }
      f.mtimeMs = st.mtimeMs
      if (st.size !== f.offset) readNew(f, st.size)
    }
  }

  // llm-status 형식의 상태 목록 (source: 'Codex 앱')
  function entries() {
    const t = now()
    const list = []
    for (const f of files.values()) {
      if (f.ignore) continue
      if (f.turn) {
        if (t - Math.max(f.mtimeMs, f.turn.lastAt) > OPEN_TURN_MAX_MS) continue
        // 진행 중인 동안은 '지금' 소식으로 둔다 (생각만 오래 해도 쉬는 중으로 바뀌지 않게)
        list.push({ mood: 'working', detail: f.turn.detail, at: t, eventAt: f.turn.lastAt, since: f.turn.startedAt, source: 'Codex 앱', sessionId: f.sessionId, project: f.project })
      } else if (f.done && t - f.done.at <= DONE_KEEP_MS) {
        list.push({ mood: 'done', detail: '', at: f.done.at, eventAt: f.done.at, duration: f.done.duration, source: 'Codex 앱', sessionId: f.sessionId, project: f.project })
      }
    }
    return list
  }

  function info() {
    const watched = [...files.values()].filter(f => !f.ignore)
    return { root, rootFound, files: watched.length, active: watched.filter(f => f.turn).length, lastEventAt }
  }

  return { scan, poll, entries, info, root }
}

module.exports = { createCodexSessionWatcher, STEP_LABEL, defaultRoot, projectName }
