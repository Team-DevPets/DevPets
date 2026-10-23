#!/usr/bin/env node
// Claude Code(~/.claude/settings.json) 또는 Codex(~/.codex/hooks.json)에 펫 상태 hooks를 넣거나 뺀다.
//   node hooks/install.js              Claude Code 연결
//   node hooks/install.js --codex      Codex 연결
//   ... --uninstall                    연결 해제
// 기존 설정은 그대로 두고 펫 항목만 추가/제거한다. 펫 앱 우클릭 메뉴의 "… 작업 알림 연결"과 같은 일을 한다.
const fs = require('fs')
const os = require('os')
const path = require('path')

const CODEX = process.argv.includes('--codex')
const SETTINGS = CODEX ? path.join(os.homedir(), '.codex', 'hooks.json') : path.join(os.homedir(), '.claude', 'settings.json')
const SOURCE = path.join(__dirname, 'pet-status.js')
// 앱 폴더를 옮겨도 연결이 끊기지 않도록 설정 폴더에 복사해 두고 그 경로를 등록한다.
const INSTALLED = path.join(os.homedir(), '.claude-desk-pet', 'hooks', 'pet-status.js')
const EVENTS = CODEX
  ? ['UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop', 'Interrupt', 'SessionEnd']
  : ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'Notification', 'Stop', 'StopFailure', 'SessionEnd']
const ASYNC_EVENTS = CODEX ? [] : ['PreToolUse', 'PostToolUse', 'PostToolUseFailure']
const TIMEOUTS = CODEX ? { Interrupt: 3, SessionEnd: 3 } : {} // Codex는 이 두 이벤트를 최대 3초로 제한한다

const uninstall = process.argv.includes('--uninstall')
const command = `node "${INSTALLED.replace(/\\/g, '/')}"${CODEX ? ' --source codex' : ''}`
const isOurs = entry => Array.isArray(entry && entry.hooks) && entry.hooks.some(h => typeof h.command === 'string' && h.command.includes('pet-status.js'))

let settings = {}
if (fs.existsSync(SETTINGS)) {
  try {
    settings = JSON.parse(fs.readFileSync(SETTINGS, 'utf8').replace(/^\uFEFF/, ''))
  } catch (error) {
    // 읽을 수 없는 설정 파일을 덮어쓰면 기존 설정이 모두 사라지므로 멈춘다.
    console.error(`설정 파일을 읽지 못해 바꾸지 않았어요: ${SETTINGS}\n${error.message}`)
    process.exit(1)
  }
}

if (!uninstall) {
  fs.mkdirSync(path.dirname(INSTALLED), { recursive: true })
  fs.copyFileSync(SOURCE, INSTALLED)
}

settings.hooks = settings.hooks || {}
for (const event of new Set([...Object.keys(settings.hooks), ...EVENTS])) {
  const list = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : null
  if (!list && (uninstall || !EVENTS.includes(event))) continue
  const kept = (list || []).filter(entry => !isOurs(entry))
  if (!uninstall && EVENTS.includes(event)) {
    kept.push({ hooks: [{ type: 'command', command, timeout: TIMEOUTS[event] || 5, ...(ASYNC_EVENTS.includes(event) ? { async: true } : {}) }] })
  }
  if (kept.length) settings.hooks[event] = kept
  else delete settings.hooks[event]
}
if (Object.keys(settings.hooks).length === 0) delete settings.hooks

fs.mkdirSync(path.dirname(SETTINGS), { recursive: true })
if (fs.existsSync(SETTINGS) && !fs.existsSync(SETTINGS + '.pet-backup')) fs.copyFileSync(SETTINGS, SETTINGS + '.pet-backup')
fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2))
const name = CODEX ? 'Codex' : 'Claude Code'
console.log(uninstall
  ? `${name} 펫 hooks를 제거했어요: ${SETTINGS}`
  : `${name} 펫 hooks를 설치했어요: ${SETTINGS}\n(실행 중인 ${name}는 다시 시작해야 적용돼요${CODEX ? '. 처음 한 번은 Codex CLI에서 /hooks 로 검토 후 신뢰해 주세요' : ''})`)
