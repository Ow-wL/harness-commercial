# A3 NAVER 검수 스파이크 — 실제 NAVER 지도 + A3 블루안 패널

`frontend/spike/a3-naver-review.html` 재현 안내와 결과 요약. 2026-10-14~15 검수. 결정은 D-022·D-023, 시각 규칙은 `DESIGN.md` §19.

- 목적: A3 블루안 패널을 실제 NAVER 지도(래스터·GL·다크 커스텀 스타일) 위에 올려 축척·맞춤·대비·가림·정보창·스타일 실패 복구를 확인한다.
- 범위: **검수 스파이크만**. 제품(`frontend/src`)에는 다크 스타일·스타일 실패 복구·A3 화면이 아직 적용되지 않았다(UI 개편 단위). 8-B1 단일 지도 맞춤만 제품에 있다.
- 앱 코드를 import하지 않는 독립 페이지다. 빌드·타입검사 대상이 아니다(`frontend/spike/`).

## 실행

1. `frontend/.env`(커밋 안 함)에 `VITE_NAVER_MAP_CLIENT_ID`. 다크 스타일을 보려면 `VITE_NAVER_MAP_STYLE_ID`(Style Editor My Style ID, 커밋 안 함). 키 목록은 `frontend/.env.example`.
2. 개발 서버: `npm --prefix frontend run dev -- --port 5173` (NAVER 콘솔에 등록된 주소여야 지도 인증이 된다).
3. **보이는 GPU 브라우저**에서 `http://localhost:5173/spike/a3-naver-review.html?gl=1`. GL은 하드웨어 WebGL2가 필요하다 — 소프트웨어 렌더러(SwiftShader 등, 헤드리스)는 SDK가 래스터로 대체한다. 탭이 숨겨졌거나 창이 가려져 그리기가 멈추면 GL `init`이 오지 않는다.

## 쿼리

| 쿼리 | 뜻 |
|---|---|
| `gl=1` | GL 요청. 스타일 ID가 있으면 `customStyleId` 적용 |
| `style=<ID>` | 환경변수 대신 이 스타일 ID(잘못된 ID로 실패 경로 확인) |
| `b=bupyeong1b\|guwol\|songdo\|ganghwa` | 비교 B(맞춤 기준: 래스터 기준 zoom 13) |
| `z=<zoom>` | 검수용 zoom 고정(맞춤 중심 유지) — 같은 축척 1:1 부분 캡처용 |
| `band=white` | 다크 지도에서도 이전 흰 저작권 띠(비교용) |
| `bandBg=<CSS 색>` | 다크 지도 띠 색 시험(후보 비교용) |
| `hidden=measure` | 숨김 탭에서도 수치 측정(ready로 세지 않음) |
| `failFallback=1` · `failStyledInit=1` · `holdInit=1` · `initTimeout=<ms>` | 검수 전용: 밝은 대체 지도 실패 / 스타일 지도 init 시간 초과 / 스타일 지도 init 무시 / 대기 시간 |

## 계측 (`window.__review`)

`status`(loading → waiting-visible → sdk → init → ready | init-timeout | style-failed | fallback-init → ready | fallback-failed …), `renderMode`(1 래스터 / 2 GL), `tone`(dark/light), `styleRequest`, `attempts`(지도 세대별 결과), `fallback`, `plan`·`d`(맞춤), `log`(visibilitychange·focus·resize·zoom·idle·init 등 시각 기록), `snap()`·`mark(label)`(캡처 전후 상태 비교), `openStore(i)`·`refit()`.
유효 판정: 캡처 전후 `visible + ready + 지도 크기 정상 + 이동 완료` 그리고 zoom·중심·크기 동일, 사이에 hidden 없음.

## 결과 요약 (기록: `results/`, 대표 캡처: `screenshots/`)

| 항목 | 결과 | 근거 |
|---|---|---|
| GL·래스터 축척 | 같은 축척에서 GL zoom = 래스터 zoom − 1(z15: 3.791 / 1.895 m/px) | `results/log-R1440.txt` |
| 비교 맞춤(래스터·GL) | 부평1동·구월3동 함께, 송도2동·강화읍 B만 + "두 위치 모두 보기" | `results/log-compare.txt`, `12`, `20` |
| 모바일 시트·로고 줄 | 시트가 로고·축척을 덮지 않음, 버튼은 오른쪽 아래 | `07`, `08`, `20` |
| 저작권 줄 가독성 | 배경 띠 추가 후 통과 | `30` → `34`, `results/log-ctlband.txt` |
| 밝은 대체 팔레트 | 점포 `#066B54`: 점포 대 배경 최소 3.81(래스터)·4.32(GL), 선택 점포 구분 | `41` → `50`·`51`, `results/log-markers.txt` |
| 다크 GL(발행 스타일) | GL + 스타일 요청 200 + 실제 화면 다크. 점포 최소 3.53·핀 5.29(1:1) | `D01`, `D03`, `D05`, `results/log-dark.txt` |
| POI | 재발행 2회 뒤 음식점·쇼핑 브랜드 POI 꺼짐(은행·역·출구·건물 이름 유지) | `D10` → `D16` |
| 저작권 띠(다크) | 옅은 회청색 `rgba(222,229,240,.94)`: 글자 6.65·로고 2.02(흰 띠 6.94·1.90) | `D12`, `D13` |
| 스타일 실패 복구 | 잘못된 ID(400)·스타일 init 시간 초과 → 밝은 지도 1회 재생성, 밝은 지도 실패 시 종료, 늦은 이벤트 무시, 숨김 동안 대기 시간 멈춤 | `D08`, `D09`, `results/log-dark.txt` |

캡처 배율: 파일 이름의 `1to1`은 CSS px 1:1, `0.96x`·`0.5x`는 축소 캡처(배치 확인용). 1440 화면은 이 작업 환경에서 1:1로 캡처할 수 없었다.

## 한계 (미확인)

- 1440 전체 화면 GL의 1:1 대비(1:1 근거는 562·375 폭 부분 캡처와 gstack 래스터 1440뿐).
- 실제 모바일 기기(터치 탭·pinch). 에뮬레이션은 마우스 클릭이다.
- 스타일 실패 경로 중 "init 시간 초과"·"밝은 지도 실패"는 검수 전용 쿼리로 대기 시간을 줄여 확인했다. 숨김은 `visibilityState` 재정의로 흉내 냈다.
- 제품 적용 전 — 제품 규칙은 `DESIGN.md` §19.3.1.
- 전체 캡처 원본은 저장소 밖(`.gstack/design-8/a3/shots/naver-review/`)에 있다. 기록의 캡처 번호 중 이 폴더에 없는 것은 원본에만 있다. 기록에는 스타일 ID를 남기지 않았다.
