#!/usr/bin/env node
// Windows 배포본 만들기 — Electron 런타임에 이 앱을 올려 <앱 폴더>\release\UsagiPet-<버전>-win32-x64 를 만든다.
//   npm run package:win              새로 만든다 (출력 폴더가 이미 있으면 멈춘다)
//   npm run package:win -- --force   기존 출력 폴더를 지우고 다시 만든다
// 만들어진 폴더는 그대로 압축해서 나눠 주면 된다. 아이콘은 Electron 기본 아이콘을 쓴다 (rcedit 없이 바꿀 수 없다).
const fs = require('fs')
const path = require('path')

const APP_DIR = path.resolve(__dirname, '..') // resources/app
const ROOT = path.resolve(APP_DIR, '..', '..') // UsagiPet.exe 가 놓이는 앱 폴더
const pkg = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8'))
const OUT = path.join(ROOT, 'release', `UsagiPet-${pkg.version}-win32-x64`)
const force = process.argv.includes('--force')

// 앱 폴더에서 같이 가져갈 것들 — 없으면 알려 주고 넘어간다.
const ROOT_ITEMS = ['pets', 'hooks', 'README.md', '패치노트.md', '시작하기.txt', '업데이트-방법.txt']
// 앱 소스에서 뺄 것들 — 의존성, 출력 폴더, 개발 중 넣어 둔 시트 폴더(배포본은 앱 폴더의 pets 를 읽는다)
const APP_SKIP = new Set(['node_modules', 'release', 'pets'])

function stop(message) {
  console.error(message)
  process.exit(1)
}

function human(bytes) {
  return bytes >= 1024 * 1024 * 1024
    ? `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`
    : `${Math.round(bytes / 1024 / 1024)}MB`
}

function measure(dir) {
  let files = 0
  let bytes = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const sub = measure(full)
      files += sub.files
      bytes += sub.bytes
    } else {
      files += 1
      bytes += fs.statSync(full).size
    }
  }
  return { files, bytes }
}

if (process.platform !== 'win32') stop(`Windows 배포본은 Windows 에서만 만들 수 있어요 (지금: ${process.platform}).`)

let electronDist
try {
  electronDist = path.dirname(require('electron'))
} catch {
  stop('Electron 을 찾지 못했어요. resources/app 에서 npm install 을 먼저 실행하세요.')
}
const srcExe = path.join(electronDist, 'electron.exe')
if (!fs.existsSync(srcExe)) stop(`Electron 실행 파일이 없어요: ${srcExe}\nnpm install 을 다시 실행하세요.`)

if (fs.existsSync(OUT)) {
  if (!force) stop(`출력 폴더가 이미 있어요: ${OUT}\n다른 곳으로 옮기거나, 지우고 다시 만들려면 npm run package:win -- --force 를 쓰세요.`)
  console.log(`기존 출력 폴더를 지웁니다: ${OUT}`)
  fs.rmSync(OUT, { recursive: true, force: true })
}

// 1) Electron 런타임을 복사한다. 기본 앱(default_app.asar)은 우리 앱으로 대체하므로 가져가지 않는다.
console.log(`Electron 런타임 복사: ${electronDist}`)
fs.cpSync(electronDist, OUT, {
  recursive: true,
  filter: src => path.basename(src) !== 'default_app.asar',
})

// 2) 실행 파일 이름을 바꾼다.
fs.renameSync(path.join(OUT, 'electron.exe'), path.join(OUT, 'UsagiPet.exe'))

// 3) 앱 소스를 resources/app 에 넣는다.
console.log('앱 소스 복사: resources/app')
fs.cpSync(APP_DIR, path.join(OUT, 'resources', 'app'), {
  recursive: true,
  filter: src => !APP_SKIP.has(path.relative(APP_DIR, src).split(path.sep)[0]),
})

// 4) 펫 시트·hooks·설명 파일을 앱 폴더에 넣는다. 시트 백업(sprite-before-*.png)은 빼고 가져간다.
for (const item of ROOT_ITEMS) {
  const from = path.join(ROOT, item)
  if (!fs.existsSync(from)) {
    console.log(`  건너뜀 (없음): ${item}`)
    continue
  }
  fs.cpSync(from, path.join(OUT, item), {
    recursive: true,
    filter: src => !path.basename(src).startsWith('sprite-before-'),
  })
  console.log(`  담음: ${item}`)
}

const { files, bytes } = measure(OUT)
console.log(`\n배포본을 만들었어요: ${OUT}`)
console.log(`파일 ${files}개, ${human(bytes)}`)
console.log('폴더 전체를 ZIP 으로 묶어 나눠 주세요. 실행 파일만 따로 옮기면 실행되지 않아요.')
