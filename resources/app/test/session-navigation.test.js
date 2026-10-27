const test = require('node:test')
const assert = require('node:assert/strict')
const { sessionUrl, openTarget } = require('../session-navigation')

const task = { provider: 'gpt', source: 'Codex 앱', sessionId: '01a167f6-4103-7030-9d35-886d1787f34b' }

test('Codex 앱 세션은 정확한 채팅 링크를 열고 앱 재실행을 하지 않는다', async () => {
  const opened = []
  const result = await openTarget(task, {
    openExternal: async url => opened.push(url),
    openProvider: async () => assert.fail('앱 재실행 불필요'),
  })
  assert.equal(result, 'session')
  assert.deepEqual(opened, [`codex://threads/${task.sessionId}`])
})

test('화면 감지·CLI hooks의 ID를 Codex 앱 채팅으로 오인하지 않는다', () => {
  for (const source of ['ChatGPT 앱', 'Claude 앱', 'Claude Code', 'Codex', '']) {
    assert.equal(sessionUrl({ ...task, source }), null)
  }
  assert.equal(sessionUrl({ ...task, provider: 'claude' }), null)
})

test('잘못된 ID로 URL·쿼리·명령을 주입할 수 없다', () => {
  for (const sessionId of ['', '../new', 'https://example.com', `${task.sessionId}?prompt=hello`, `${task.sessionId}\n`, null]) {
    assert.equal(sessionUrl({ ...task, sessionId }), null)
  }
})

test('프로토콜 실행 실패 시 앱을 열고 정확한 세션 이동 성공으로 보고하지 않는다', async () => {
  const providers = []
  const result = await openTarget(task, {
    openExternal: async () => { throw new Error('handler unavailable') },
    openProvider: async provider => { providers.push(provider); return true },
  })
  assert.equal(result, 'app')
  assert.deepEqual(providers, ['gpt'])
})

test('세션 정보가 없으면 앱만 열며 앱도 없으면 실패를 반환한다', async () => {
  const result = await openTarget({ provider: 'claude' }, {
    openExternal: async () => assert.fail('링크 없음'),
    openProvider: async provider => { assert.equal(provider, 'claude'); return false },
  })
  assert.equal(result, false)
})

test('지원하지 않는 작업은 아무 앱도 열지 않는다', async () => {
  assert.equal(await openTarget({ provider: 'other' }, {
    openExternal: async () => assert.fail('열면 안 됨'),
    openProvider: async () => assert.fail('열면 안 됨'),
  }), false)
})
const { cliSpec, navigationMode, resumeScript, claudeChatTarget } = require('../session-navigation')
test('Claude 링크만 채팅으로 열고 다른 도메인·쿼리·CLI ID를 섞지 않는다', async () => {
  const target = claudeChatTarget(`https://claude.ai/chat/${task.sessionId}`)
  assert.equal(sessionUrl(target), `claude://claude.ai/chat/${task.sessionId}`)
  for (const url of [`https://evil.test/chat/${task.sessionId}`, `https://claude.ai/chat/${task.sessionId}?q=hi`, 'javascript:alert(1)']) assert.equal(claudeChatTarget(url), null)
  assert.equal(sessionUrl({ ...target, source: 'Claude Code' }), null)
})
test('두 CLI는 프로젝트와 세션을 넘기고 앱으로 잘못 이동하지 않는다', async () => {
  for (const [provider, source, command, flag] of [['claude', 'Claude Code', 'claude', '--resume'], ['gpt', 'Codex', 'codex', 'resume']]) {
    const target = { ...task, provider, source, cwd: 'C:\\my project' }
    assert.equal(navigationMode(target), 'resume')
    assert.equal(await openTarget(target, { openTerminal: async spec => {
      assert.deepEqual(spec, { command, args: [flag, task.sessionId], cwd: target.cwd }); return true
    }, openProvider: () => assert.fail('CLI를 앱으로 열면 안 됨') }), 'resume')
    assert.equal(await openTarget(target, { openTerminal: async () => { throw new Error('missing') } }), false)
  }
})
test('CLI 경로·ID 검증과 PowerShell 리터럴 이스케이프', () => {
  const target = { ...task, source: 'Codex', cwd: "C:\\a'b $(bad); & test" }
  const spec = cliSpec(target)
  assert.match(resumeScript(spec), /a''b \$\(bad\); & test'/)
  for (const cwd of ['', 'relative', '\\\\server\\share', 'C:\\bad\npath', '/tmp']) assert.equal(cliSpec({ ...target, cwd }), null)
  assert.equal(cliSpec({ ...target, sessionId: task.sessionId + '; evil' }), null)
  assert.equal(cliSpec({ ...target, provider: 'claude' }), null)
})
