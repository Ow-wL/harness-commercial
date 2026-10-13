# 8-B0 지도 맞춤 SDK 스파이크 — 재현 자료

결과 해석과 정책 영향은 `docs/UX_REDESIGN.md` 3장. 이 폴더는 같은 측정을 다시 돌리기 위한 스크립트와 대표 결과다.
측정일 2026-10-13(1차), 2026-10-14(판정 기준 정정 후 재측정 — 아래 `results/`는 재측정 값). 제품 코드는 쓰지 않는다.

## 구성

| 경로 | 내용 |
|---|---|
| `frontend/spike/map-fit-spike.html` | 스파이크 페이지(vite dev가 서빙, 빌드·타입검사 밖). 앱 코드를 import하지 않는다. 지도 옵션은 앱 `MapView.tsx`와 같다(`zoomControl` 오른쪽 위, `scaleControl: true`, `mapDataControl: false`). `?zoomStyle=SMALL` = 확대 컨트롤 SMALL, `?mapData=1` = SDK 기본 저작권 표기 켬 |
| `run.sh` | 스파이크 측정 전체(3폭 × 컨트롤 2종, 가설, 이벤트, 숨김) → `results/` |
| `run-app.sh` | 실제 앱 화면의 지도·범례·SDK 컨트롤 위치 측정(읽기만) → `results/app-*.json` |
| `scripts/*.js` | `$B eval`로 페이지 안에서 실행하는 측정 스크립트 |
| `results/*.json` | 대표 결과(아래 표) |
| `screenshots/*.jpg` | 직접 계산 1,000m · SMALL 컨트롤, U를 빨간 점선으로 표시 |

## 재현

전제: `frontend/.env`에 `VITE_NAVER_MAP_CLIENT_ID`(등록된 Web 서비스 URL `http://localhost:5173`), gstack browse 바이너리(`~/.claude/skills/gstack/browse/dist/browse`, 다르면 `B=` 환경변수).

```bash
cd frontend && npm run dev -- --port 5173 --strictPort      # 터미널 1
bash docs/spikes/8-B0/run.sh                                 # 저장소 루트, 약 2분
```
앱 실측은 backend도 띄운 뒤(`PYTHONDONTWRITEBYTECODE=1 python -m uvicorn backend.app.main:app --port 8000`) `bash docs/spikes/8-B0/run-app.sh`.

주의
- 1차 측정에서 `$B eval`은 한글 `//` 주석이 든 스크립트에 대해 오류 없이 빈 결과를 돌려줬다(원인 미확인). 한글 문자열 리터럴(`run-events.js`의 '지도 확대')은 정상 동작했다. 그래서 `scripts/*.js`에는 주석을 두지 않고 설명은 이 README에 둔다. 각 스크립트는 실패 시 `ERR …` 문자열을 돌려주며 `run.sh`는 결과가 JSON이 아니면 멈춘다.
- `$B eval` 경로는 cwd 아래여야 하므로 저장소 루트에서 실행한다.
- 지도 생성 직후에는 SDK 컨트롤 DOM이 아직 없을 수 있어(1차 측정에서 1/4회) 스크립트가 2초 기다린다. `obstacles`가 4개(범례·반경 chip·SDK 2개)인지 확인한다.
- 사용자 휠·드래그·± 클릭은 합성 DOM 이벤트다(실제 입력·터치 pinch는 미검증).

## 판정 기준

완료 조건: 원 bbox ⊂ U(±1px) **그리고** 원 지름 ≥ 0.5 × min(U.w, U.h).
- **판정은 원 SVG 요소 사각형**(`Circle.getElement().getBoundingClientRect()`, 지도 컨테이너 기준)으로 한다 → `verdict.ok`, `verdict.basis = "svg"`.
- 교차 확인은 **bounds 계산**(`map.getBounds()`와 `circle.getBounds()`, 경도 선형·위도 Web Mercator) → `verdict.bounds`. 두 판정이 다르면 `verdict.agree = false`. 재측정 36건(18조합 × SDK·직접) 모두 `agree = true`.
- `getProjection().fromCoordToOffset`은 판정에 쓰지 않는다(`panBy` 뒤 갱신되지 않음 — 1차 측정에서 24~29px 차이). 페이지는 `rect.projDiag`로만 남긴다.

## 직접 계산 (단일 원) — 스파이크 `S.fitCustom`

```
d   = 지금 zoom에서 원 지름(px) = max(bounds 계산 w, h)
z   = clamp(지금 zoom + floor(log2(min(U.w, U.h) / d)), minZoom, maxZoom)
setCenter(원 중심) → setZoom(z, false) → panBy(Point(지도 중심.x − U 중심.x, 지도 중심.y − U 중심.y))
```
`panBy(+x, +y)`는 보이는 영역을 오른쪽·아래로 옮긴다 = 원이 화면에서 왼쪽·위로 x, y px 움직인다. 그래서 (지도 중심 − U 중심)을 넘기면 원 중심이 U 중심에 온다. 재측정에서 원 중심 − U 중심 = (0, 0) 18/18(`circleCenterMinusUCenter`). 예: 1280 LARGE U 중심 (375, 342.5), 지도 중심 (400, 371.5) → `panBy(25, 29)`.

**A∪B(비교)에는 직접 계산을 시험하지 않았다.** 비교는 SDK `fitBounds(A∪B, U margin)` 결과만 있다(`hypothesis-*.json`의 `unionSdkFitBounds`). 비교용 직접 계산과 숨김 중 B 선택·버튼 요청은 8-B2 검증 항목이다.

## 대표 결과

| 파일 | 내용 |
|---|---|
| `app-1280x800-before-select.json`, `app-1280x800-result.json`, `app-970x800-result.json`, `app-375x812-result-mapscreen.json` | 앱 실측: 지도 사각형, 범례·안내 칩, SDK 요소(확대 컨트롤 50×238, 로고·축척 158×17). 앱은 `mapDataControl: false`라 "© NAVER Corp." 표기 요소가 없다 |
| `final-{1280x800,970x800,375x812}-{LARGE,SMALL}.json` | U·margin, 반경 300·500·1,000에서 SDK `fitBounds` vs 직접 계산 zoom·판정 |
| `hypothesis-*.json` | 비대칭 margin(`asym`) / 같은 U 크기의 대칭 margin(`symSameU`) / 각 축 큰 쪽 대칭(`symMax`)의 zoom, A∪B SDK 맞춤 |
| `events-1280x800.json` | 조작별 이벤트 순서·동기 여부, `panTo` 중 `fitBounds`/`setZoom` 겹침, 합성 휠·드래그·± |
| `hidden-{1280x800,375x812}.json` | `display:none`·0×0에서 `fitBounds`·`getSize`·U, 다시 보인 뒤 판정 |
