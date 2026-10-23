## 무엇을

<!-- 한두 줄. 커밋 제목과 같은 말이면 그대로 적으면 됩니다 -->

## 왜

<!-- 어떤 문제나 요청 때문인지 -->

## 확인한 것

<!-- 어떻게 확인했는지. 보기: npm test 15개 통과 / 설정 창 → 상호작용 → 지금 해 보기로 춤 확인 -->

## 체크리스트

- [ ] `cd resources/app && npm test` 통과
- [ ] `main.js` 를 고쳤으면 `node --check main.js`
- [ ] 버전을 올렸으면 `package.json` · `패치노트.md` · `README.md` 에 기록하고, 루트와 `resources\app` 두 벌이 같음
- [ ] 시트를 바꿨으면 `pets\sprite-before-<이름>.png` 백업이 있음
- [ ] `app-watch.ps1` 은 UTF-8 **BOM** 그대로 (없으면 한글이 깨짐)
- [ ] `node_modules` · `release` · `logs` 가 섞이지 않았고, 100MB 넘는 파일이 없음
- [ ] `main.js` · `renderer` · `preload` 를 고쳤으면 펫을 완전히 껐다 켜서 확인

<sub>머지는 **Squash and merge**. 자세한 규칙은 [깃-규칙.md](../깃-규칙.md)</sub>
