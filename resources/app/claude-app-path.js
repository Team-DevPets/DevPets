// Shared with the PowerShell watcher via RegExp.source (no double escaping).
const CLAUDE_CLI_PATH = /[\\/](?:claude-code|node_modules|npm)[\\/]|[\\/]\.local[\\/]bin[\\/]/i

function isClaudeCli(exe) {
  return typeof exe === 'string' && CLAUDE_CLI_PATH.test(exe)
}

module.exports = { CLAUDE_CLI_PATH, isClaudeCli }
