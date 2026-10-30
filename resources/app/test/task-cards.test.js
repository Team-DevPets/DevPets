const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

// 실제 설정 렌더러를 로드하되 초기 연결은 보류하고, 작업 카드의 HTML을 확인한다.
function renderer() {
  const context = vm.createContext({
    window: { matchMedia: () => ({ matches: false }), settings: { getState: () => new Promise(() => {}), onState() {}, onNavigate() {} }, addEventListener() {} },
    document: { addEventListener() {} }, location: { hash: '' },
  })
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../renderer/settings.js'), 'utf8'), context)
  vm.runInContext(`state = { status: { providers: [{ id: 'gpt', counts: { working: 2, waiting: 1 }, tasks: [
    { id: 'codex:test1234', source: 'Codex', state: 'waiting', detail: '<script>안전 확인</script>', since: 1000, surface: 'cli' },
    { id: 'app:ChatGPT 앱', source: 'ChatGPT 앱', state: 'working', detail: '', since: 1000, surface: 'app' }
  ] }] } }`, context)
  return context
}

test('작업 목록은 개수를 요약하고 펼침 상태를 다음 갱신에도 유지한다', () => {
  const context = renderer()
  let html = vm.runInContext("taskList('gpt', 61000)", context)
  assert.match(html, /확인 대기 1개 · 작업 중 2개/)
  assert.match(html, /aria-expanded="false"/)
  assert.match(html, /class="task-list" hidden/)
  html = vm.runInContext("ui.tasksGpt = 'true'; taskList('gpt', 62000)", context)
  assert.match(html, /aria-expanded="true"/)
  assert.doesNotMatch(html, /class="task-list" hidden/)
  assert.match(vm.runInContext("taskList('gpt', 63000)", context), /aria-expanded="true"/)
  assert.match(html, /세션 test1234/)
  assert.match(html, /앱 감지/)
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&lt;script&gt;/)
  assert.equal(vm.runInContext("taskList('claude', 63000)", context), '')
})
