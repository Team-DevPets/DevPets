#!/usr/bin/env node
// Claude Code · Codex hook → 펫 상태 파일 기록
// 이벤트마다 stdin으로 JSON을 넘겨받아, 세션별로 ~/.claude-desk-pet/sessions/<출처>-<세션>.json 에 적는다.
// 두 도구의 hook 형식이 거의 같아서 한 스크립트로 처리한다. Codex에서는 `--source codex`로 부른다.
// 펫 앱이 이 폴더를 지켜보다가 여러 세션의 상태를 합쳐 표정을 바꾼다.
// 항상 종료코드 0으로 끝나서 Claude Code 동작을 막지 않는다.
const fs = require('fs')
const os = require('os')
const path = require('path')

const DIR = path.join(os.homedir(), '.claude-desk-pet', 'sessions')
const SOURCE = process.argv.includes('--source') ? String(process.argv[process.argv.indexOf('--source') + 1] || '').replace(/[^\w-]/g, '') : 'claude'
const startedAt = Date.now() // 비동기 hook은 끝나는 순서가 뒤바뀔 수 있어서, 시작 시각으로 순서를 정한다.

function fileFor(sessionId) {
  const safe = String(sessionId || 'default').replace(/[^\w.-]/g, '_').slice(0, 80) || 'default'
  return path.join(DIR, (SOURCE === 'claude' ? '' : SOURCE + '-') + safe + '.json')
}

function projectName(cwd) {
  const value = typeof cwd === 'string' ? cwd.replace(/[\\/]+$/, '') : ''
  return value ? value.split(/[\\/]/).pop().slice(0, 80) : ''
}

function write(file, mood, detail, event) {
  try {
    // 더 나중에 시작한 hook이 이미 기록했다면 덮어쓰지 않는다.
    try {
      const prev = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (Number(prev.at) > startedAt) return
    } catch {}
    fs.mkdirSync(DIR, { recursive: true })
    // 전체 경로나 입력 내용을 저장하지 않고, 목록에서 구분할 최소 정보만 남긴다.
    const text = JSON.stringify({ mood, detail: detail || '', at: startedAt, sessionId: String(event.session_id || '').slice(0, 80), project: projectName(event.cwd) })
    const tmp = `${file}.${process.pid}.tmp`
    try {
      fs.writeFileSync(tmp, text)
      fs.renameSync(tmp, file)
    } catch {
      try { fs.unlinkSync(tmp) } catch {}
      fs.writeFileSync(file, text)
    }
  } catch {}
}

const STOP_FAILURE_LABEL = {
  rate_limit: '사용량 한도에 걸렸어',
  overloaded: '서버가 붐벼',
  authentication_failed: '로그인이 필요해',
  billing_error: '결제 확인이 필요해',
  server_error: '서버 오류',
  max_output_tokens: '답변이 너무 길어',
}

function decide(e) {
  const tool = e.tool_name || ''
  switch (e.hook_event_name) {
    case 'UserPromptSubmit':
      return ['working', '']
    case 'PreToolUse':
      if (tool === 'AskUserQuestion' || tool === 'ExitPlanMode') return ['waiting', '질문에 답해줘']
      return ['working', tool]
    case 'PostToolUse':
    case 'PostToolUseFailure': // 도구 하나가 실패하는 건 흔한 일이라 작업 중으로 둔다
      return ['working', tool]
    case 'PermissionRequest':
      return ['waiting', `${tool} 허용할까?`]
    case 'Notification':
      if (e.notification_type === 'permission_prompt') return ['waiting', '권한 승인 대기']
      if (e.notification_type === 'elicitation_dialog' || e.notification_type === 'agent_needs_input') return ['waiting', '입력이 필요해']
      // idle_prompt(답변 후 입력 대기)는 이미 '완료'로 알렸으니 노란 점을 다시 켜지 않는다.
      return null
    case 'Stop':
      return ['done', '']
    case 'StopFailure': {
      const type = e.error_type || (e.error && e.error.type) || (typeof e.error === 'string' ? e.error : '') || ''
      return ['error', STOP_FAILURE_LABEL[type] || 'API 오류']
    }
    case 'Interrupt': // Codex: 사용자가 작업을 멈춤
      return ['idle', '']
    case 'SessionEnd':
      return ['end', '']
    default:
      return null
  }
}

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => (raw += chunk))
process.stdin.on('end', () => {
  try {
    const event = JSON.parse(raw || '{}')
    const verdict = decide(event)
    const file = fileFor(event.session_id)
    if (verdict && verdict[0] === 'end') {
      try { fs.unlinkSync(file) } catch {}
    } else if (verdict) {
      write(file, verdict[0], verdict[1], event)
    }
  } catch {}
  process.exit(0)
})
setTimeout(() => process.exit(0), 2000).unref()
