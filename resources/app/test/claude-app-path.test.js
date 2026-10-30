const { test } = require('node:test')
const assert = require('node:assert/strict')
const { CLAUDE_CLI_PATH, isClaudeCli } = require('../claude-app-path')

test('exclude bundled Claude Code and other CLI installations', () => {
  for (const exe of [
    'C:/Users/test/AppData/Local/Claude-Data/claude_id/claude-code/2.1.308/hash/claude.exe',
    String.raw`C:\Users\test\AppData\Local\Claude-Data\claude_id\CLAUDE-CODE\2.1.308\hash\claude.exe`,
    String.raw`C:\Users\test\.local\bin\claude.exe`,
    String.raw`C:\Users\test\node_modules\claude\claude.exe`,
    String.raw`C:\Users\test\AppData\Roaming\npm\claude.exe`,
  ]) {
    assert.equal(isClaudeCli(exe), true, exe)
    assert.equal(new RegExp(CLAUDE_CLI_PATH.source, 'i').test(exe), true)
  }
})

test('keep desktop apps and unrelated paths eligible', () => {
  for (const exe of [
    String.raw`C:\Program Files\WindowsApps\Claude_3.6556.2.0_x64__id\app\claude.exe`,
    String.raw`C:\Users\test\AppData\Local\AnthropicClaude\claude.exe`,
    'C:/Users/test/AppData/Local/Programs/Claude/Claude.exe',
    'C:/Users/claude-code-project/Claude.exe',
    '', null,
  ]) assert.equal(isClaudeCli(exe), false, String(exe))
})
