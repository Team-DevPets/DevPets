const path = require('path')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function claudeChatTarget(value) {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^https:\/\/claude\.ai\/chat\/([0-9a-f-]{36})$/i)
  return match && UUID.test(match[1]) ? { provider: 'claude', source: 'Claude 앱', sessionId: match[1] } : null
}
function sessionUrl(target) {
  if (!target || typeof target.sessionId !== 'string' || !UUID.test(target.sessionId)) return null
  if (target.provider === 'gpt' && target.source === 'Codex 앱') return `codex://threads/${target.sessionId}`
  if (target.provider === 'claude' && target.source === 'Claude 앱') return `claude://claude.ai/chat/${target.sessionId}`
  return null
}
function cliSpec(target) {
  if (!target || typeof target.sessionId !== 'string' || !UUID.test(target.sessionId)) return null
  const command = target.provider === 'claude' && target.source === 'Claude Code' ? 'claude'
    : target.provider === 'gpt' && target.source === 'Codex' ? 'codex' : null
  const cwd = target.cwd
  // Only local absolute Windows directories; never execute a network location or shell text.
  if (!command || typeof cwd !== 'string' || !/^[a-z]:[\\/]/i.test(cwd) || /[\x00-\x1f]/.test(cwd)) return null
  return { command, args: [command === 'claude' ? '--resume' : 'resume', target.sessionId], cwd: path.win32.normalize(cwd) }
}
function navigationMode(target) {
  return sessionUrl(target) ? 'session' : cliSpec(target) ? 'resume' : ['gpt', 'claude'].includes(target.provider) ? 'app' : 'unsupported'
}
function resumeScript(spec) {
  const quote = s => "'" + s.replace(/'/g, "''") + "'"
  return `$ErrorActionPreference = 'Stop'; Set-Location -LiteralPath ${quote(spec.cwd)}; & ${quote(spec.command)} ${spec.args.map(quote).join(' ')}`
}
async function openTarget(target, { openExternal, openProvider, openTerminal, log = () => {} }) {
  if (!target || !['gpt', 'claude'].includes(target.provider)) return false
  const spec = cliSpec(target)
  if (spec) {
    try { return await openTerminal(spec) ? 'resume' : false }
    catch (error) { log(`terminal launch failed: ${error.message}`); return false }
  }
  const url = sessionUrl(target)
  if (url) {
    try { await openExternal(url); return 'session' }
    catch (error) { log(`session link failed: ${error.message}`) }
  }
  return await openProvider(target.provider) ? 'app' : false
}
module.exports = { sessionUrl, openTarget, cliSpec, navigationMode, resumeScript, claudeChatTarget }
