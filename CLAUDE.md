# 우사기 펫 (UsagiPet) — Claude Code 작업 안내

Windows 바탕화면 위에 떠 있는 우사기(치이카와) 펫. Claude 앱 · ChatGPT 앱 · Claude Code · Codex의 작업 상태를 보여 주고, 클릭·간식·춤 같은 상호작용을 한다.
Electron 33.2.1 앱이며, **이 폴더가 곧 설치본이자 소스**다 (asar로 묶지 않음). 소스를 고치면 바로 실행본이 바뀐다.

## 사용자와 일하는 방식

- 사용자는 **민준**. 대화는 **한국어**로, 짧고 바로 쓸 수 있게. "무엇을 했는지"와 함께 "왜"를 한 줄로.
- **버전을 올릴 때마다 패치노트를 쓴다** (아래 "버전 올리기"). 이전 버전 항목은 지우지 않는다.
- 고친 뒤에는 "우사기 펫을 껐다 켜면 적용"인지, 실행 중에 바로 적용되는지(시트 그림 교체) 알려 준다.
- 바꾼 동작은 가능하면 직접 확인하고 확인한 내용을 말한다 (아래 "확인 방법").

## 폴더 구조

```text
UsagiPet-win32-x64\              ← Claude Code를 여기서 연다
  UsagiPet.exe                   실행 파일 (Electron)
  CLAUDE.md                      이 문서
  패치노트.md · README.md        사용자용 패치노트 · 사용 설명서 (resources\app 안에 같은 파일이 하나씩 더 있음 — 둘 다 같게 유지)
  pets\sprite.png                지금 쓰는 펫 시트 (1536×4576, 22줄). 실행 중에 바꿔도 바로 적용
  pets\sprite-before-*.png       시트를 바꿀 때마다 남긴 백업 (fight · dance · legs)
  pets\sprite.json               (없음) 시트 줄 배정을 덮어쓰고 싶을 때만
  logs\app-watch.log             감지·상태·오류 기록 — 문제를 볼 때 가장 먼저 확인
  dev\sprite-tools\add_rows.py   새 동작 그림을 시트에 붙이는 도구 (Python)
  dev\sprite-sources\            지금 시트의 춤 원본 그림 3장
  resources\app\                 ★ 앱 소스
    package.json                 버전 (지금 0.4.16), npm test
    main.js                      메인 프로세스: 창·시트 인식·드래그·산책·상태 감지·알림·트레이·설정 창
    llm-status.js                AI 상태 합치기 규칙 (우선순위: waiting > error > working > done)
    codex-sessions.js            ChatGPT(Codex) 앱 작업 기록 ~/.codex/sessions/**/rollout-*.jsonl 읽기
    app-watch.ps1                Claude 앱·ChatGPT 앱 화면(UI Automation) 감지. ★ UTF-8 BOM 유지 (없으면 한글 깨짐)
    preload.js                   펫 창 ↔ 메인 (contextIsolation)
    settings-preload.js          설정 창 ↔ 메인
    renderer\index.html          펫 화면: 그림 그리기·시선·말풍선·상호작용 엔진 (HTML+CSS+JS 한 파일)
    renderer\settings.html/.js   설정 창(컨트롤센터)
    renderer\fonts\              Jua · Noto Sans KR (오프라인용)
    hooks\                       Claude Code·Codex hooks (pet-status.js, install.js)
    test\                        node --test 자동 테스트 15개
    assets\default-pet.png       내장 기본 우사기 시트
```

사용자 설정·상태 파일: `%USERPROFILE%\.claude-desk-pet\` (config.json, status.json, hooks 세션 기록).

## 실행 · 재시작 · 확인 방법

- 실행: `UsagiPet.exe`. 이미 떠 있는데 한 번 더 실행하면 설정 창이 열린다 (단일 인스턴스).
- **main.js · renderer · preload를 고치면 앱을 완전히 종료(트레이 → 종료)하고 다시 실행**해야 적용된다. `pets\sprite.png`만 바꾸면 실행 중에 바로 다시 읽는다.
- 테스트: `cd resources\app` → `npm test` (Node.js 필요. 상태 합치기·Codex 기록 읽기 테스트).
- 문법 확인: `node --check main.js`.
- 화면 확인: 설정 창 **상호작용 → 지금 해 보기**로 각 행동을 바로 실행해 볼 수 있다. 렌더러 오류는 `logs\app-watch.log`에 `renderer error …`로 남는다.

## 버전 올리기 (매번)

1. `resources\app\package.json`의 `version`을 올린다 (0.4.16 → 0.4.17 …).
2. `패치노트.md` 맨 위(가장 최신 자리)에 `## 0.4.17 — 한 줄 제목` 항목 추가. **사용자용 쉬운 말**로, `**새 기능** / **개선** / **바뀐 점** / **버그 수정**` 중 맞는 것만.
3. `README.md`의 "버전별 변경 내역" 아래에 `## 0.4.17에서 바뀐 점` 추가 — 설정 키·파일 형식까지 담은 자세한 기록.
4. 루트와 `resources\app`의 `README.md` · `패치노트.md`를 같은 내용으로 맞춘다.

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

### 줄 배정 문법 (`DEFAULT_SPRITE_OPTIONS.rows` 또는 `pets\sprite.json`의 `rows`)

- `동작: 줄번호` / `동작: [줄, 줄, …]` (여러 줄을 이어 한 동작, 몸 중심 `cx` 기준으로 그려 흔들리지 않음)
- 줄 대신 `{ row, frames: [프레임 순서…], say }` — 그 줄의 프레임을 적은 순서대로 (반복·멈춤 가능).
  `say`는 그 프레임이 나올 때 말할 대사 키 (renderer `PLAY_LINES`). 문자열이면 첫 프레임, `{ 순서: 키 }`면 그 순서.
- 가리킨 줄이나 프레임이 하나라도 없으면 그 동작은 쓰지 않고, 상호작용은 "효과로 대신"한다.
- `fpsByMood`를 sprite.json에 적으면 기본값 전체가 바뀐다 (fight 10, dance 10 등 함께 적어야 함).
- 상호작용 전용 그림 이름: `eat`(간식) · `dance` · `acorn`(도토리) · `nap`(낮잠) · `greet`(반기기) · `dash`(잰걸음, 오른쪽 — 왼쪽은 뒤집어 그림). 지금은 **dance만** 시트에 있다.

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
- 붙인 뒤 `DEFAULT_SPRITE_OPTIONS.rows`에 연결하고, 필요하면 `fpsByMood`와 renderer `PLAY_LINES` 대사를 추가한다.
- 미리보기 그림을 꼭 열어 보고, 프레임 수·순서·크기가 맞는지 확인한다.

## 상호작용 (renderer\index.html "우사기 상호작용")

`pat` 쓰다듬기 · `poke` 2.5초 안에 세 번 찌르면 fight · `snack` 간식(우클릭 메뉴 / 가끔) · `dance` 갑자기 춤추기 · `acorn` 도토리 닦기 · `flee` 근처에서 마우스를 휘저으면 도망(메인이 감지·이동) · `nap` 3분 미사용 시 도라야키 낮잠 · `greet` 2분 넘게 비웠다 돌아오면 반기기.
- 켜고 끄기: `config.play.<id>`, 전체 `config.playAll`. 설정 창 **상호작용** 페이지 (`PLAYS`, `PLAY_ART` in settings.js).
- 엔진: `play`(지금 하는 행동), `later()` 타이머(끝나면 `endPlay`로 정리), `react(name)` 시트 동작 재생, `loopReact`, `sayPlay(key, extra, ms)`.
- 상호작용·낮잠 중에는 메인이 산책을 멈춘다 (`pet:playing`, `pet:napping` → `setPetBusy`). `calm()` = idle 또는 done 일 때만 혼자 시작.
- 대사: 평소 말 `LINES`, 상호작용 `PLAY_LINES`. 우사기는 외침으로만 말하고 뜻은 괄호 (설정 `meaningBasic` / `meaningAI`).

## 산책

- 8방향 자동 산책 (`walkRange`, `pickWalkDirection`: 가로 3 · 대각 2 · 세로 1 가중치, `moveAlong`). 설정 `walk2d`로 끄면 좌우만.
- 걷기 그림은 좌우 두 가지뿐 — 위아래 전용 걷기 그림은 아직 없다.

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
