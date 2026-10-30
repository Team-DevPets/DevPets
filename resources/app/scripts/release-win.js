#!/usr/bin/env node
// GitHub Releases 에 배포본 올리기 — main 에 머지되고 태그(v<버전>)가 붙은 버전만 올린다.
//   npm run release:win                 확인 → 배포본·ZIP 만들기(package-win.js) → v<버전> 릴리스에 ZIP 올리기
//   npm run release:win -- --dry-run    확인만 하고, 무엇을 어떤 제목·본문으로 올릴지 보여 준다 (만들지도 올리지도 않는다)
//   npm run release:win -- --force      릴리스가 이미 있으면 ZIP 만 새로 바꿔 올린다
// 릴리스 본문은 패치노트.md 의 그 버전 항목을 그대로 쓴다. gh CLI 가 필요하다 (gh auth login 또는 GH_TOKEN).
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')

const APP_DIR = path.resolve(__dirname, '..') // resources/app
const ROOT = path.resolve(APP_DIR, '..', '..') // 레포 루트
const pkg = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8'))
const VERSION = pkg.version
const TAG = `v${VERSION}`
const ZIP = path.join(ROOT, 'release', `UsagiPet-${VERSION}-win32-x64.zip`)
const dryRun = process.argv.includes('--dry-run')
const force = process.argv.includes('--force')

// 태그 뒤에 이 파일들이 바뀌었으면 ZIP 이 그 버전이 아니게 된다. 문서·테스트·이 도구 자체는 바뀌어도 괜찮다.
const APP_FILES = ['resources/app', 'pets', 'hooks',
  ':(exclude)resources/app/README.md', ':(exclude)resources/app/패치노트.md',
  ':(exclude)resources/app/scripts', ':(exclude)resources/app/test']

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
const succeeds = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' }).status === 0
function stop(message) {
  console.error(message)
  process.exit(1)
}

function findGh() {
  const candidates = ['gh', path.join(process.env.ProgramFiles || 'C:\\Program Files', 'GitHub CLI', 'gh.exe')]
  return candidates.find(c => spawnSync(c, ['--version'], { encoding: 'utf8' }).status === 0) || null
}

// 패치노트.md 에서 "## 0.4.22 — 제목" 부터 다음 "## " 앞까지
function releaseNotes() {
  const text = fs.readFileSync(path.join(ROOT, '패치노트.md'), 'utf8').replace(/\r\n/g, '\n')
  const start = text.indexOf(`\n## ${VERSION} `)
  if (start < 0) return null
  const next = text.indexOf('\n## ', start + 1)
  const section = text.slice(start + 1, next < 0 ? undefined : next).trim().split('\n')
  return {
    title: `UsagiPet ${section[0].replace(/^##\s*/, '')}`,
    body: section.slice(1).join('\n').trim() + '\n\n---\n' +
      `**받는 법**: 아래 \`UsagiPet-${VERSION}-win32-x64.zip\` 을 받아 **폴더째 압축을 풀고** 그 안의 \`UsagiPet.exe\` 를 실행하세요. ` +
      '실행 파일만 따로 옮기면 실행되지 않습니다.\n\n' +
      '처음 실행할 때 Windows 가 "Windows의 PC 보호" 경고를 띄우면 **추가 정보 → 실행** 을 누르세요. 코드 서명을 하지 않아서 뜨는 경고입니다.\n',
  }
}

// 1) 올려도 되는 상태인지 — 문제를 모두 모아서 한 번에 알려 준다
const problems = []
if (process.platform !== 'win32') problems.push(`Windows 에서만 만들 수 있어요 (지금: ${process.platform}).`)
if (git('status', '--porcelain')) problems.push('커밋하지 않은 변경이 있어요. 배포본은 깃에 있는 그대로만 올립니다.')
try { git('fetch', '--tags', '--quiet') } catch { problems.push('원격 태그를 받아 오지 못했어요 (git fetch --tags).') }
if (!git('ls-remote', '--tags', 'origin', `refs/tags/${TAG}`)) {
  problems.push(`원격에 ${TAG} 태그가 없어요. main 에 머지하고 태그를 붙인 다음 올리세요 (깃-규칙.md 4번).`)
} else if (!succeeds('git', ['merge-base', '--is-ancestor', TAG, 'HEAD'])) {
  problems.push(`지금 코드에 ${TAG} 가 들어 있지 않아요. git switch main && git pull 후 다시 하세요.`)
} else {
  const changed = git('diff', '--name-only', TAG, 'HEAD', '--', ...APP_FILES)
  if (changed) problems.push(`${TAG} 뒤에 앱에 들어가는 파일이 바뀌었어요 — 버전을 올려 새로 태그를 붙이세요:\n    ${changed.split('\n').join('\n    ')}`)
}
const notes = releaseNotes()
if (!notes) problems.push(`패치노트.md 에 "## ${VERSION} — 제목" 항목이 없어요.`)
const gh = findGh()
if (!gh) problems.push('gh CLI 가 없어요. winget install GitHub.cli 로 설치하세요.')
else if (!succeeds(gh, ['api', 'user', '--jq', '.login'])) problems.push('gh 로그인이 필요해요: gh auth login (또는 GH_TOKEN 환경 변수)')

const repo = git('remote', 'get-url', 'origin').replace(/^.*github\.com[/:]/, '').replace(/\.git$/, '')
const exists = gh ? succeeds(gh, ['release', 'view', TAG, '--repo', repo]) : false
if (exists && !force) problems.push(`릴리스 ${TAG} 가 이미 있어요. ZIP 만 바꿔 올리려면 --force 를 붙이세요.`)

// 2) 무엇을 올릴지
console.log(`레포    ${repo}`)
console.log(`태그    ${TAG}  (${exists ? '릴리스 있음 → ZIP 만 교체' : '새 릴리스'})`)
console.log(`파일    ${path.relative(ROOT, ZIP)}`)
if (notes) console.log(`제목    ${notes.title}\n--- 본문 ---\n${notes.body}------------`)
if (problems.length) {
  console.log(`\n올리기 전에 해결할 것:\n${problems.map(p => `  - ${p}`).join('\n')}`)
  if (!dryRun) process.exit(1)
}
if (dryRun) {
  console.log('\n--dry-run: 배포본을 만들지도 올리지도 않았어요.')
  process.exit(0)
}

// 3) 배포본·ZIP 만들기
const built = spawnSync(process.execPath, [path.join(__dirname, 'package-win.js'), '--force'], { stdio: 'inherit' })
if (built.status !== 0 || !fs.existsSync(ZIP)) stop('배포본 만들기에 실패했어요.')

// 4) 올리기
const notesFile = path.join(os.tmpdir(), `usagipet-${TAG}-notes.md`)
fs.writeFileSync(notesFile, notes.body)
const args = exists
  ? ['release', 'upload', TAG, ZIP, '--clobber', '--repo', repo]
  : ['release', 'create', TAG, ZIP, '--repo', repo, '--verify-tag', '--title', notes.title, '--notes-file', notesFile]
const uploaded = spawnSync(gh, args, { stdio: 'inherit' })
fs.rmSync(notesFile, { force: true })
if (uploaded.status !== 0) stop('GitHub 에 올리지 못했어요.')
console.log(`\n올렸어요: https://github.com/${repo}/releases/tag/${TAG}`)
