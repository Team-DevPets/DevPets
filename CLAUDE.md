# 우사기 펫 (UsagiPet) — Claude Code 작업 안내

Windows 바탕화면 위에 떠 있는 우사기(치이카와) 펫. Claude 앱 · ChatGPT 앱 · Claude Code · Codex의 작업 상태를 보여 주고, 클릭·간식·춤 같은 상호작용을 한다.
Electron 33.2.1 앱이며, **이 폴더가 곧 설치본이자 소스**다 (asar로 묶지 않음). 소스를 고치면 바로 실행본이 바뀐다.

## 지금 상태 (2026-10-26)

새 대화를 여기서 시작했다면 이 항목부터 읽으면 된다. 버전을 올릴 때 같이 갱신한다.

- **버전 0.4.21.** 깃은 [Team-DevPets/DevPets](https://github.com/Team-DevPets/DevPets) `main`, 태그 `v0.4.16` ~ `v0.4.21`. (아직 안 올린 변경이 있는지는 `git log origin/main..` 과 `git status` 로 본다 — 이 항목에 "안 올렸다"고 적어 두면 올린 뒤 바로 거짓말이 된다.)
- 0.4.21에서 확인 대기(`waiting`, 6줄) 그림을 새 그림으로 바꾸고(`add_rows.py --replace`), 숨쉬기를 쉬기와 같은 속도로 늦추고, 오른쪽 아래 **상태 점을 없앴다**. AI 상태는 AI 링과 상태 카드만으로 보여 준다.
- 0.4.20에서 산책을 손봤다 — 열에 일곱은 잰걸음, 한 번에 300~600px. Electron 은 45로 올라갔고(uzinkkk, #8) 설치본도 45로 다시 만들어 뒀다.
- 0.4.18에서 **귀 팔랑(`ear`)** 동작을 더했다 — 시트 22·23·24줄, 설정 창 상호작용에 카드가 있다. `add_rows.py`에 `--fit` · `--area` · `--scale` 옵션도 함께 들어갔다.
- 0.4.19에서 귀 팔랑을 49프레임(4.9초)으로 늘리고 대사를 "푸루 푸루~" · "푸루루루루루~!"로 바꿨다.
- 0.4.17에서 고친 것은 **개발용 명령 두 개뿐**이다 — `npm run package:win`(`scripts\package-win.js`를 새로 작성)과 `npm run hooks`(경로를 `..\..\hooks\install.js`로).
- **배포본 ZIP을 만들어 뒀다**: `release\UsagiPet-0.4.17-win32-x64.zip` (118MB). GitHub Releases 업로드는 민준이 직접 할 예정이라 **아직 안 올라갔다.**
- 디스크에 `resources\app\node_modules`(276MB)와 `release`(397MB)가 있다. 둘 다 깃 바깥이라 지워도 되고, 지우면 다시 `npm install`해야 F5 실행·배포본 만들기가 된다.
- **main에는 직접 푸시하지 않는다.** 문서 한 줄도 브랜치 → PR → Squash merge 로 넣는다 ([깃-규칙.md](깃-규칙.md)). 깃이 막아 주지는 않는다 — Free 플랜 + 비공개 레포라 브랜치 보호를 쓸 수 없다.
- 멤버는 hodu42(admin) · uzinkkk(write) 둘이다. **PR 을 올리기 직전에 `main`을 pull 받아 작업 브랜치에 반영한다.**
- 안 한 일: Electron 33.2.1에 high 2건 취약점 경고가 뜨지만 올리지 않았다. 올리면 창·트레이·알림·토스트를 전부 다시 확인해야 한다.
- 남은 아이디어는 맨 아래 "남은 아이디어" 항목에 있다.

## 사용자와 일하는 방식

- 사용자는 **민준**. 대화는 **한국어**로, 짧고 바로 쓸 수 있게. "무엇을 했는지"와 함께 "왜"를 한 줄로.
- **깃에 올리는 건 민준이 "PR 해줘"라고 할 때만** 한다. 작업 중에 수정이 자주 생기므로, 그 전까지는 이 폴더에서 고치고 무엇을 바꿨는지만 말한다 (작업 브랜치에 커밋해 두는 것은 괜찮다). PR을 올릴 때 그동안 쌓인 변경을 한 버전으로 묶는다.
- **버전을 올릴 때마다 패치노트를 쓴다** (아래 "버전 올리기"). 이전 버전 항목은 지우지 않는다.
- 고친 뒤에는 "우사기 펫을 껐다 켜면 적용"인지, 실행 중에 바로 적용되는지(시트 그림 교체) 알려 준다.
- 바꾼 동작은 가능하면 직접 확인하고 확인한 내용을 말한다 (아래 "확인 방법").

## 폴더 구조

```text
UsagiPet-win32-x64\              ← Claude Code를 여기서 연다
  UsagiPet.exe                   실행 파일 (Electron)
  CLAUDE.md                      이 문서
  패치노트.md · README.md        사용자용 패치노트 · 사용 설명서 (resources\app 안에 같은 파일이 하나씩 더 있음 — 둘 다 같게 유지)
  pets\sprite.png                지금 쓰는 펫 시트 (1536×5200, 25줄). 실행 중에 바꿔도 바로 적용
  pets\sprite-before-*.png       시트를 바꿀 때마다 남긴 백업 (fight · dance · legs · ear · waiting)
  pets\sprite.json               (없음) 시트 줄 배정을 덮어쓰고 싶을 때만
  logs\app-watch.log             감지·상태·오류 기록 — 문제를 볼 때 가장 먼저 확인
  hooks\                         Claude Code·Codex hooks (install.js, pet-status.js) — npm run hooks 로 설치
  dev\sprite-tools\add_rows.py   새 동작 그림을 시트에 붙이는 도구 (Python)
  dev\sprite-sources\            지금 시트의 원본 그림 (춤 3장 · 귀 팔랑 2장 · 확인 대기 1장)
  resources\app\                 ★ 앱 소스
    package.json                 버전 (지금 0.4.17), npm test · npm run package:win
    main.js                      메인 프로세스: 창·시트 인식·드래그·산책·상태 감지·알림·트레이·설정 창
    llm-status.js                AI 상태 합치기 규칙 (우선순위: waiting > error > working > done)
    codex-sessions.js            ChatGPT(Codex) 앱 작업 기록 ~/.codex/sessions/**/rollout-*.jsonl 읽기
    app-watch.ps1                Claude 앱·ChatGPT 앱 화면(UI Automation) 감지. ★ UTF-8 BOM 유지 (없으면 한글 깨짐)
    preload.js                   펫 창 ↔ 메인 (contextIsolation)
    settings-preload.js          설정 창 ↔ 메인
    renderer\index.html          펫 화면: 그림 그리기·시선·말풍선·상호작용 엔진 (HTML+CSS+JS 한 파일)
    renderer\settings.html/.js   설정 창(컨트롤센터)
    renderer\fonts\              Jua · Noto Sans KR (오프라인용)
    scripts\package-win.js       Windows 배포본 만들기 (npm run package:win)
    test\                        node --test 자동 테스트 15개
    assets\default-pet.png       내장 기본 우사기 시트
```

사용자 설정·상태 파일: `%USERPROFILE%\.claude-desk-pet\` (config.json, status.json, hooks 세션 기록).

## 깃

- 커밋 메시지 · 브랜치 · PR · 태그 규칙은 [깃-규칙.md](깃-규칙.md)에 정리해 두었다. **작업은 `<타입>/<설명>` 브랜치에서 하고 PR(Squash and merge)로 합친다. main 에는 직접 푸시하지 않는다** (문서 한 줄이라도 PR 로). **PR 을 올리기 직전에 `git switch main && git pull` → 작업 브랜치에서 `git merge main`** 으로 최신으로 맞춘다. 버전을 올리는 커밋은 `release: 0.4.20 — 제목` 형식으로 적고, 머지된 뒤 `v0.4.20` 태그를 붙인다.
- 레포: [Team-DevPets/DevPets](https://github.com/Team-DevPets/DevPets) (main 브랜치). 이 폴더가 그대로 레포다.
- Electron 런타임(`UsagiPet.exe` · dll · locales), `logs\`, `.claude\`, `release\`는 `.gitignore`로 뺀다. GitHub는 파일 한 개를 100MB까지만 받으므로 180MB인 실행 파일은 올릴 수 없다.
- 클론한 사람은 `resources\app`에서 `npm install` → `npm start`. 시트는 `resources\app\pets`에서 찾으니 루트 `pets`를 복사하거나 junction으로 연결해야 춤·싸움이 나온다.

## 실행 · 재시작 · 확인 방법

- 실행: `UsagiPet.exe`. 이미 떠 있는데 한 번 더 실행하면 설정 창이 열린다 (단일 인스턴스).
- VS Code: 이 폴더를 열면 **F5 → 우사기 펫 (디버그)** 로 띄울 수 있다 (`.vscode\launch.json`). 떠 있는 펫과 단일 인스턴스가 겹치지 않게 `--user-data-dir`를 따로 준다. 먼저 `resources\app`에서 `npm install`이 필요하고, 소스로 실행하면 로그가 `resources\app\logs\`에 쌓인다. Claude Code 패널은 Ctrl+Esc.
- **main.js · renderer · preload를 고치면 앱을 완전히 종료(트레이 → 종료)하고 다시 실행**해야 적용된다. `pets\sprite.png`만 바꾸면 실행 중에 바로 다시 읽는다.
- 테스트: `cd resources\app` → `npm test` (Node.js 필요. 상태 합치기·Codex 기록 읽기 테스트).
- 문법 확인: `node --check main.js`.
- 화면 확인: 설정 창 **상호작용 → 지금 해 보기**로 각 행동을 바로 실행해 볼 수 있다. 렌더러 오류는 `logs\app-watch.log`에 `renderer error …`로 남는다.

## 버전 올리기 (매번)

1. `resources\app\package.json`의 `version`을 올린다 (0.4.17 → 0.4.18 …).
2. `패치노트.md` 맨 위(가장 최신 자리)에 `## 0.4.18 — 한 줄 제목` 항목 추가. **사용자용 쉬운 말**로, `**새 기능** / **개선** / **바뀐 점** / **버그 수정**` 중 맞는 것만.
3. `README.md`의 "버전별 변경 내역" 아래에 `## 0.4.18에서 바뀐 점` 추가 — 설정 키·파일 형식까지 담은 자세한 기록.
4. 루트와 `resources\app`의 `README.md` · `패치노트.md`를 같은 내용으로 맞춘다.
5. 맨 위 **"지금 상태"** 항목의 버전·날짜와 달라진 내용을 갱신한다.

## 펫 시트 (pets\sprite.png)

- 투명 PNG. 앱이 알파 덩어리로 프레임을 자동으로 자르고(`sliceSheet`), 세로로 겹치는 프레임끼리 한 줄로 묶는다. 2px 틈까지 한 덩어리, 겹치는 상자는 합친다.
- 모든 동작은 쉬기(0줄) 높이 기준 **같은 배율**로 그린다. 새 그림은 서 있는 키 약 153px, 칸 192×208, 바닥선 = 줄 위 + 196 에 맞춘다 (`add_rows.py`가 해 준다).
- 11줄 이상이고 9·10줄이 8칸씩이면 "v2 형식"으로 보고 `DEFAULT_SPRITE_OPTIONS`(main.js 맨 위)를 쓴다.

| 줄(0부터) | 동작 | 프레임 |
|---|---|---|
| 0 | idle 쉬기 | 6 |
| 1 · 2 | walk 오른쪽 · walkLeft 왼쪽 걷기 | 8 · 8 |
| 3 | dragging 잡고 이동 | 4 |
| 4 | done 완료 점프 | 5 |
| 5 · 6 · 7 | error · waiting · working | 8 · 6 · 6 |
| 8 | review 클릭(쓰다듬기) 반응 | 6 |
| 9 · 10 | 시선 16방향 (위부터 시계방향) | 8 · 8 |
| 11–14 | fight 싸움 (여러 번 찌르기) | 7×4 = 28 |
| 15 | 춤 ① 주먹질 (잠옷) | 8 |
| 16–20 | 춤 ② 웅크렸다 좌우로 흔들기 | 5×5 |
| 21 | 춤 ③ 서 있다가 다리 꼬기 | 8 |
| 22 · 23 · 24 | ear 귀 팔랑 (22·23 좌우로 팔랑 → 24 쫑긋 세우고 휙휙) | 7 × 3 = 21 (동작은 팔랑 두 번 · 쫑긋 세 번으로 49프레임) |

### 줄 배정 문법 (`DEFAULT_SPRITE_OPTIONS.rows` 또는 `pets\sprite.json`의 `rows`)

- `동작: 줄번호` / `동작: [줄, 줄, …]` (여러 줄을 이어 한 동작, 몸 중심 `cx` 기준으로 그려 흔들리지 않음)
- 줄 대신 `{ row, frames: [프레임 순서…], say }` — 그 줄의 프레임을 적은 순서대로 (반복·멈춤 가능).
  `say`는 그 프레임이 나올 때 말할 대사 키 (renderer `PLAY_LINES`). 문자열이면 첫 프레임, `{ 순서: 키 }`면 그 순서.
- 가리킨 줄이나 프레임이 하나라도 없으면 그 동작은 쓰지 않고, 상호작용은 "효과로 대신"한다.
- `fpsByMood`를 sprite.json에 적으면 기본값 전체가 바뀐다 (fight 10, dance 10 등 함께 적어야 함).
- 상호작용 전용 그림 이름: `eat`(간식) · `dance` · `ear`(귀 팔랑) · `acorn`(도토리) · `nap`(낮잠) · `greet`(반기기) · `dash`(잰걸음, 오른쪽 — 왼쪽은 뒤집어 그림). 지금은 **dance와 ear만** 시트에 있다.

### 지금 춤 (0.4.16, 10fps, 71프레임 ≈ 7.1초)

`main.js` 맨 위 `DANCE_FIST_ORDER`, `DANCE_LEGS_ORDER`, `DEFAULT_SPRITE_OPTIONS.rows.dance`:
1. 15줄 주먹질 — 한 줄에 주먹이 1·4·7번 프레임 3번뿐이라 `[0,1, 5,6,7, 2,3,4, …]` 순서로 **주먹 딱 8번** (23프레임). 대사 "우 우나나 우나~" (`danceFist`)
2. 16–20줄 흔들기 25프레임. 대사 "우나나 야하야하~~" (`danceSway`)
3. 21줄 다리 꼬기 — 0–4 서 있기 + 4번을 10번 더(1초 멈춤) → 5,6,7 다리 꼬기 + 7번을 5번 더(0.5초 멈춤). 5번 프레임이 처음 나올 때 "쁘릿!" (`danceCross`)
- 대사 말풍선은 다음 대사까지 떠 있고, 마지막 대사는 춤이 끝나도 최소 1.8초 남는다 (`doDance`, renderer/index.html).
- 시간 조절 = 위 배열에서 반복 횟수(10프레임 = 1초)만 바꾸면 된다.

### 새 동작 그림 붙이기

```powershell
pip install pillow numpy scipy
python dev\sprite-tools\add_rows.py 그림.png --name eat --dry-run   # 미리보기: dev\sprite-tools\preview-eat.png
python dev\sprite-tools\add_rows.py 그림.png --name eat              # 백업 후 시트에 붙이고 새 줄 번호 출력
```
- 격자 그림은 `--per-row 5`, 크기 기준이 될 서 있는 프레임은 `--stand 0,1,2`, 프레임이 붙어 잘리면 `--col-gap`을 줄인다.
- **크기 맞추기**: 기본은 서 있는 키 153px이지만, 머리가 큰 그림은 같은 키라도 훨씬 커 보인다. `--area 9500`(기존 쉬기 그림의 보이는 넓이)으로 맞추는 쪽이 어울린다. **한 동작을 그림 여러 장으로 나눠 붙일 때는 `--scale`로 모두 같은 배율**을 줘야 중간에 크기가 튀지 않는다 (귀 팔랑은 둘 다 `--scale 0.5603`).
- 귀를 위·옆으로 뻗어 192×208 칸을 넘으면 `--fit`을 준다 (칸 너비 = 시트너비÷프레임수, 칸 높이는 가장 큰 프레임에 맞춤). 프레임 사이가 10px 미만이면 멈춘다 — main.js가 6px 이내로 붙은 그림을 한 프레임으로 합치기 때문.
- **있는 줄을 바꿀 때는 `--replace N`** (0부터). 줄을 새로 붙이지 않고 그 줄만 바꾸므로 시트 높이·다른 줄 번호가 그대로고 main.js 도 고칠 게 없다. 한 줄짜리 그림만 받는다. 미리보기에 바로 위 줄이 같이 나와 크기를 견주어 볼 수 있다 (0.4.21의 waiting: `--replace 6 --per-row 6 --area 10800`).
- 붙인 뒤 `DEFAULT_SPRITE_OPTIONS.rows`에 연결하고, 필요하면 `fpsByMood`와 renderer `PLAY_LINES` 대사를 추가한다.
- 미리보기 그림을 꼭 열어 보고, 프레임 수·순서·크기가 맞는지 확인한다.

## 상호작용 (renderer\index.html "우사기 상호작용")

`pat` 쓰다듬기 · `poke` 2.5초 안에 세 번 찌르면 fight · `snack` 간식(우클릭 메뉴 / 가끔) · `dance` 갑자기 춤추기 · `ear` 귀 팔랑(가끔, 전용 그림이 있을 때만) · `acorn` 도토리 닦기 · `flee` 근처에서 마우스를 휘저으면 도망(메인이 감지·이동) · `nap` 3분 미사용 시 도라야키 낮잠 · `greet` 2분 넘게 비웠다 돌아오면 반기기.
- 켜고 끄기: `config.play.<id>`, 전체 `config.playAll`. 설정 창 **상호작용** 페이지 (`PLAYS`, `PLAY_ART` in settings.js).
- 엔진: `play`(지금 하는 행동), `later()` 타이머(끝나면 `endPlay`로 정리), `react(name)` 시트 동작 재생, `loopReact`, `sayPlay(key, extra, ms)`.
- 상호작용·낮잠 중에는 메인이 산책을 멈춘다 (`pet:playing`, `pet:napping` → `setPetBusy`). `calm()` = idle 또는 done 일 때만 혼자 시작.
- 대사: 평소 말 `LINES`, 상호작용 `PLAY_LINES`. 우사기는 외침으로만 말하고 뜻은 괄호 (설정 `meaningBasic` / `meaningAI`).

## 산책

- 8방향 자동 산책 (`walkRange`, `pickWalkDirection`: 가로 3 · 대각 2 · 세로 1 가중치, `moveAlong`). 설정 `walk2d`로 끄면 좌우만.
- 한 번에 **300~600px**(`WALK_MIN_PX` · `WALK_MAX_PX`). 거리를 먼저 뽑고 걸음 수를 계산해서, 빠르든 느리든 가는 거리는 같다.
- **열에 일곱(`FAST_WALK_CHANCE`)은 잰걸음** — 도망갈 때와 같은 `DASH_STEP`/`DASH_INTERVAL`(6px/22ms). 나머지는 `WALK_STEP`/`WALK_INTERVAL`(3px/40ms).
- `pet:walk` 로 보내는 값: **±1 보통 걸음 · ±2 도망 · ±3 빠른 산책**. ±2는 잰걸음 전용 그림(`dash`)이 있으면 그걸 쓰고, **±3은 언제나 걷기 그림을 두 배 빠른 fps로** 그린다 (렌더러 `spriteAnim`의 `quick`). 산책은 걷는 모습이어야 해서 나눠 뒀다.
- 걷기 그림은 좌우 두 가지뿐 — 위아래 전용 걷기 그림은 아직 없다.
- 산책 확인은 쉽지 않다: 컴퓨터를 3분 안 쓰면 낮잠(`nap`)이 들어 산책이 멈춘다. 시험할 때는 config 의 `play.nap` 을 꺼야 한다.

## AI 상태 감지 (main.js)

- 출처: Claude Code·Codex hooks 세션 파일, Claude 앱·ChatGPT 앱 화면 감지(`app-watch.ps1`, 1초마다 JSON 한 줄), Codex 작업 기록(`codex-sessions.js`, 출처 이름 'Codex 앱').
- 화면 감지: 중지 버튼 = 작업 중, 허용·승인 버튼 = 확인 대기. 중지 버튼이 사라질 때 답 아래 버튼(복사·좋은 응답 등, `WATCHED_APPS[].done`) 수가 시작 때보다 늘었으면 바로 완료.
- 알려진 한계: 앱 창이 완전히 가려지면 화면 정보가 갱신되지 않아 ChatGPT 일반 채팅 완료를 늦게 알아챌 수 있다. Codex는 기록을 따르므로 정확하다.
- 알림: Windows 토스트 (AUMID `com.usagipet.desktop`, 시작 메뉴 "우사기 펫" 바로 가기). 누르면 시작 메뉴 앱 ID로 Claude·ChatGPT 앱을 연다 (`focusProvider`).
- 개인정보: Codex 기록에서 대화 내용은 쓰지 않고 이벤트 종류·시각만 쓴다. `~/.codex/auth.json`은 읽지 않는다. `AppData\Roaming\Claude`는 보호 폴더라 건드리지 않는다.

## 주의할 점 (전에 겪은 문제)

- `app-watch.ps1`은 UTF-8 **BOM**으로 저장. PowerShell 변수 이름은 대소문자를 구분하지 않으니 겹치지 않게.
- preload에 오류 리스너를 두면 contextIsolation 때문에 페이지 오류를 못 잡는다 → 페이지 스크립트에서 `window.pet.reportError` 호출.
- 설정 창은 HTML 문자열을 그린 뒤 `patch()`로 바뀐 부분만 고친다 (포커스·전환 유지). 이벤트는 `data-set` / `data-act` / `data-nav` / `data-ui` 위임.
- 시트에 동작을 붙일 때 **없는 줄을 가리키는 기본 배정이 다른 그림을 잘못 가리키지 않는지** 확인 (예전에 eat:15가 춤 줄을 가리킬 뻔함).
- 시트를 바꾸기 전에는 항상 `pets\sprite-before-<이름>.png` 백업.

## 남은 아이디어 (사용자가 아직 정하지 않음)

- 위아래로 걷는 전용 애니메이션 줄
- 먹기(수박) · 도토리 · 낮잠 · 반기기 · 잰걸음 전용 그림
- 옷 갈아입기 기능 (시트 통째 교체 방식 vs 소품 겹치기 — 결정 전)
- 설정 창 일반 → 버전 정보에 "새 소식 보기"(패치노트) 버튼
