# DESIGN.md — 우리동네 상권분석 매니저

> 인천 행정동 단위 상권분석 서비스의 디자인 시스템. **frontend의 모든 UI는 이 문서를 따른다.**
> 기능 범위는 `docs/TASKS.md`, API 계약은 `backend/README.md`, 엔진 결과 JSON은 `docs/ENGINE.md`.
> 정보 구조는 원본 MVP 화면(`sources/team_v0.3/06_MVP화면/`, 읽기 전용)을 존중하되, 시각 규칙은 이 문서가 정한다.
> 형식은 awesome-design-md(Stitch DESIGN.md)의 9개 영역을 따르고 이 서비스 전용 영역(결과 위계·데이터 컴포넌트·오류 상태)을 더했다.

목차
1. Visual Theme & Atmosphere — 디자인 원칙
2. Color Palette & Roles
3. Typography Rules
4. Layout Principles — spacing, grid, breakpoint, app shell
5. Screens & States — 화면 A~E
6. Analysis Result Hierarchy
7. Component Stylings — 기본 컴포넌트
8. Data Components — 서비스 전용 컴포넌트
9. Data Density & Progressive Disclosure
10. Loading / Empty / Error
11. Depth & Elevation
12. Motion
13. Iconography
14. Responsive Behavior
15. Accessibility
16. Do's and Don'ts
17. Design Tokens
18. Agent Prompt Guide — 구현 규칙

---

## 1. Visual Theme & Atmosphere

**한 문장:** 밝고 차분한 업무형 분석 도구. 흰 표면과 옅은 회청색 바탕 위에 진한 잉크색 글자, 강조색은 **Harbor Blue 하나**. 장식 대신 숫자·라벨·막대 길이가 화면을 이끈다. 그림자·그라데이션·큰 hero 없이 1px 선과 표면 단계로 구조를 만든다. "공공데이터로 계산한 상대 순위"라는 서비스 성격에 맞게 확신보다 **근거와 한계를 함께 보여 주는** 톤이다.

분위기: Clean · Calm · Analytical · Trustworthy · Data-first
피하는 분위기: AI SaaS 랜딩, 네온 그라데이션, glassmorphism, 게임 점수판, 이모지 UI, 데이터보다 장식이 먼저 보이는 화면.

### 디자인 원칙 (6)

| # | 원칙 | UI에서 뜻하는 것 |
|---|---|---|
| P1 | **위치와 업종은 항상 보인다** (Context always visible) | 결과·세부·오류 어디서든 화면 상단에 `Location Chip`(시군구 행정동)과 `Business Chip`(업종·그룹)이 고정된다. 사용자가 "지금 무엇을 보고 있는지"를 스크롤 위치와 무관하게 안다. |
| P2 | **숫자가 먼저, 장식은 나중** (Data first) | 점수는 tabular 숫자로 오른쪽 정렬, 막대 길이로 비교한다. 아이콘·일러스트·배경 장식은 점수보다 먼저 눈에 띄면 안 된다. 한 화면에 시선을 끄는 요소는 종합점수 하나와 병목 하나뿐이다. |
| P3 | **비교가 쉬운 배열** (Comparison before decoration) | 5대 관점은 **항상 같은 순서**(시장성·고객성·경쟁성·입지성·안정성)와 같은 축(0–100)으로 나란히 둔다. 업종 비교 표도 같은 열 순서. 정렬을 바꿔 보여 주지 않는다. |
| P4 | **색은 의미가 있을 때만** (Color has meaning) | 강조색은 행동(버튼·링크·선택·포커스)에만. 점수 막대는 중립 데이터색. 경고색은 병목·경고·분석 불가에만. "높으면 초록, 낮으면 빨강" 같은 장식적 점수 색칠은 하지 않는다. |
| P5 | **요약 → 근거 → 원자료** (Progressive disclosure) | 첫 화면은 요약(종합·5대 관점·병목·충족률·경고)만. 세부 지표(breakdown)와 원시값(raw)은 사용자가 펼칠 때 나온다. 단, **경고·데이터 없음·한계는 접지 않는다.** |
| P6 | **한계를 솔직하게** (Honest data) | 계산 못한 값은 0이 아니라 "데이터 없음"으로, 낮은 해상도(시군구 단위)·낮은 신뢰도는 라벨로 표시한다. 모든 지표 근처에 출처·기준시점을 둘 자리를 둔다(공공누리 출처표시 조건, 기획보고서 정정본 v2). 결론을 단정하지 않는다("하세요/마세요" 금지). |

---

## 2. Color Palette & Roles

라이트 테마 하나. 중립색은 아주 약하게 푸른 기운이 있는 slate 계열(순수 회색보다 차분하고 Harbor Blue와 어울림).
대비는 흰색(`#FFFFFF`) 배경 기준 WCAG 2.1 비율(약)이다. 본문 텍스트는 4.5:1 이상, 큰 텍스트·UI 경계는 3:1 이상.

### 2.1 중립·표면

| 토큰 | Hex | 역할 | 대비 |
|---|---|---|---|
| `--color-bg` | `#F5F7FA` | 앱 바탕(페이지 배경). 흰 표면과 구분되는 첫 단계 | — |
| `--color-surface` | `#FFFFFF` | 패널·카드·입력·표 배경 | — |
| `--color-surface-muted` | `#EEF1F5` | 메타 줄, 표 헤더, 비활성 영역, 세부 패널 안쪽 | — |
| `--color-surface-sunken` | `#E4E8EE` | 막대 트랙, skeleton, 눌린 상태 | — |
| `--color-border` | `#DDE2E9` | 기본 1px 구분선·카드 테두리·표 행 구분 | — |
| `--color-border-strong` | `#B9C1CC` | 입력 테두리, 강조 구분, hover 테두리 | 1.8:1 (장식 경계) |
| `--color-text-primary` | `#17202B` | 제목·본문·점수 숫자 | 16.4:1 |
| `--color-text-secondary` | `#444E5B` | 보조 본문, 라벨 | 8.5:1 |
| `--color-text-muted` | `#656F7C` | 캡션, 메타, 단위, placeholder | 5.1:1 (`--color-surface-muted` 위 4.5:1) |
| `--color-text-disabled` | `#9AA3AE` | 비활성 텍스트(읽기 대상 아님) | 2.6:1 |
| `--color-text-inverse` | `#FFFFFF` | 강조색 버튼 위 글자 | — |

입력 테두리는 `--color-border-strong`(1.8:1)만으로 경계를 알리지 않는다 — 라벨·배경(`--color-surface`)·포커스 링이 함께 경계를 만든다(§15).

### 2.2 강조색 (Harbor Blue — 하나만)

| 토큰 | Hex | 역할 |
|---|---|---|
| `--color-accent` | `#1D5BBF` | primary 버튼, 링크, 선택 상태, 지도 마커, 포커스 링. 흰 배경 대비 6.4:1 |
| `--color-accent-hover` | `#174CA0` | hover |
| `--color-accent-active` | `#123E84` | pressed |
| `--color-accent-subtle` | `#EAF1FC` | 선택된 행·옵션 배경, 선택 칩 배경 |
| `--color-accent-border` | `#A8C3EC` | 선택된 카드·칩 테두리 |
| `--color-focus-ring` | `#1D5BBF` | 2px 포커스 링 (+2px 흰 offset) |

강조색은 **행동과 선택**에만 쓴다. 점수 막대·차트 데이터에 쓰지 않는다(P4).

### 2.3 데이터색 (점수·차트 — 강조색과 분리)

| 토큰 | Hex | 역할 |
|---|---|---|
| `--color-data-bar` | `#4A6B94` | 점수 막대 채움(5대 관점 모두 같은 색). 트랙 대비 4.5:1, 흰색 대비 5.5:1 |
| `--color-data-bar-muted` | `#9DB0C8` | 보조 시리즈, 비교 대상(예: 인천 평균) |
| `--color-data-track` | `#E4E8EE` | 막대 트랙(= surface-sunken) |
| `--color-data-reference` | `#17202B` | 기준선(인천 중앙값 50 등) 1px |
| `--color-data-missing` | `#C5CCD6` | "데이터 없음" 빗금 패턴 선 |

### 2.4 5대 관점 식별색 (identity, 값이 아님)

5개 관점을 **구분**하기 위한 색이다. 같은 채도·비슷한 명도의 차분한 색 5개로, 한 화면에 나란히 놓여도 무지개처럼 보이지 않게 맞췄다. 흰색 대비 4.4–5.7:1(비텍스트 3:1 기준 충족).
**규칙:** 이 색은 관점 라벨 앞 8px 사각 마커, 세부 섹션 왼쪽 3px 띠, 차트 범례에만 쓴다. **점수 막대 채움에는 쓰지 않는다** — 막대는 모두 `--color-data-bar`(값 비교는 길이로만).

| 관점 (key) | 토큰 | Hex | 표기 순서 |
|---|---|---|---|
| 시장성 `market` | `--color-persp-market` | `#3F6FB0` | 1 |
| 고객성 `customer` | `--color-persp-customer` | `#2F8584` | 2 |
| 경쟁성 `competition` | `--color-persp-competition` | `#6D5BA8` | 3 |
| 입지성 `location` | `--color-persp-location` | `#5A7F3F` | 4 |
| 안정성 `stability` | `--color-persp-stability` | `#9A6B1F` | 5 |

색만으로 구분하지 않는다: 항상 한글 라벨이 함께 나오고, 순서가 고정이다.

### 2.5 상태색 (semantic)

빨강/초록만으로 의미를 전달하지 않는다 — 상태색은 항상 **텍스트 라벨 + 아이콘 모양**과 함께 쓴다.

| 상태 | 글자/아이콘 | 배경 | 테두리 | 쓰는 곳 |
|---|---|---|---|---|
| success | `--color-success` `#1E7A4C` | `--color-success-subtle` `#E8F5EE` | `--color-success-border` `#9FD1B6` | 확인 완료, 진입장벽 "낮음" 라벨 |
| warning | `--color-warning` `#9A5A00` | `--color-warning-subtle` `#FFF4E2` | `--color-warning-border` `#F0C98A` | 병목(25 미만), 엔진 `경고[]`, 신뢰도 low, 해상도 저하, 분석 불가(사용자 상황) |
| danger | `--color-danger` `#B42318` | `--color-danger-subtle` `#FDECEB` | `--color-danger-border` `#F2B8B3` | 서버 오류(`internal_error`), 입력 오류 필드 |
| info | `--color-info` `#2B5F9E` | `--color-info-subtle` `#EDF3FA` | `--color-info-border` `#B7CCE6` | 안내, 면책·방법론 설명 |

- 낮은 점수는 **warning(주황 계열)**으로만 표시하고 danger(빨강)는 쓰지 않는다. 점수가 낮은 것은 오류가 아니다.
- 높은 점수에 success(초록)를 칠하지 않는다. 최고 관점은 텍스트 라벨 "가장 강한 관점"으로 표시한다.

### 2.6 지도색 (4-4에서 사용)

| 토큰 | Hex/값 | 역할 |
|---|---|---|
| `--color-map-marker` | `#1D5BBF` | 선택 지점 핀(= accent), 흰 2px 외곽선 |
| `--color-map-radius-fill` | `rgba(29,91,191,0.08)` | 반경 500m 원 채움 |
| `--color-map-radius-stroke` | `#1D5BBF` | 반경 원 1.5px 점선(4 4) |
| `--color-map-dong-fill` | `rgba(29,91,191,0.06)` | 선택된 행정동 polygon 채움 |
| `--color-map-dong-stroke` | `#4A6B94` | 선택된 행정동 경계 1.5px |
| `--color-map-boundary` | `#656F7C` | 인천 시 경계 1px |
| `--color-map-outside-dim` | `rgba(23,32,43,0.06)` | 인천 밖 영역 옅은 덮개(선택 불가 표시) |
| `--color-map-invalid-marker` | `#656F7C` | 분석 불가 지점 핀(회색) |

---

## 3. Typography Rules

### 3.1 Font stack

```
--font-sans: "Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont,
             "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", "Segoe UI", Roboto, sans-serif;
--font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
```

- Pretendard(SIL OFL 1.1)는 **선택 사항**이다. 쓰려면 self-host하고, 없어도 OS 기본 한글 폰트(Apple SD Gothic Neo / 맑은 고딕 / Noto Sans KR)로 레이아웃이 깨지지 않아야 한다. 필수 웹폰트를 전제로 크기를 맞추지 않는다.
- 숫자: 점수·표·메타는 `font-variant-numeric: tabular-nums;` — 자릿수가 세로로 정렬돼 비교가 빠르다.
- 한국어 줄바꿈: 본문 `word-break: keep-all; overflow-wrap: anywhere;`.
- `--font-mono`는 업종코드(`R10406`), request_id, 좌표 원문에만.

### 3.2 Type scale

| 역할 | 토큰 | size / line-height | weight | letter-spacing | 사용 위치 |
|---|---|---|---|---|---|
| Display | `--text-display` | 28px / 36px | 700 | -0.02em | 초기 화면 서비스 제목 1곳 |
| Page title | `--text-page-title` | 22px / 30px | 700 | -0.015em | 결과 화면 제목("부평구 부평1동 · PC방") |
| Section title | `--text-section` | 17px / 26px | 600 | -0.01em | "왜 이런 점수가 나왔나", "주의할 점" 등 섹션 머리 |
| Card title | `--text-card-title` | 15px / 22px | 600 | 0 | 카드·관점 세부 블록 제목 |
| Body | `--text-body` | 15px / 24px | 400 | 0 | 본문, 설명, note |
| Small | `--text-small` | 13px / 20px | 400 | 0 | 보조 설명, 칩, 메타 줄, 표 본문 |
| Caption | `--text-caption` | 12px / 16px | 500 | 0.01em | 출처·기준시점, 축 라벨, 단위 |
| Score XL | `--text-score-xl` | 44px / 48px | 700 | -0.02em | 종합 점수 숫자 1곳 (tabular) |
| Score M | `--text-score-m` | 18px / 24px | 600 | 0 | 5대 관점 점수 숫자 (tabular, 오른쪽 정렬) |
| Score S | `--text-score-s` | 14px / 20px | 600 | 0 | 세부 지표 점수, 표 안 점수 (tabular) |
| Table / meta | `--text-table` | 13px / 20px | 400 | 0 | 표 셀, raw 값, 메타 (tabular) |
| Label | `--text-label` | 13px / 18px | 600 | 0 | 입력 라벨, 표 헤더, 그룹 라벨 |

- 본문 최소 15px, 읽어야 하는 텍스트 최소 12px. 12px 미만 금지.
- 위계는 크기·굵기·색(primary/secondary/muted)으로 만든다. 대문자 변환·밑줄 장식·색 글자 남발 금지.
- 점수 옆 단위는 숫자보다 작게: 종합 `64.1` + `/100`(`--text-small`, muted).
- 숫자 표기: 점수는 소수 1자리(엔진 값 그대로, 다시 반올림하지 않는다), 인구·점포수는 천 단위 콤마, 비율은 `%`, 거리는 `m`. 데이터 없음은 `—`가 아니라 텍스트 "데이터 없음".

---

## 4. Layout Principles

### 4.1 Spacing scale (4px 기반)

| 토큰 | px | 대표 용도 |
|---|---|---|
| `--space-1` | 4 | 아이콘-텍스트 간격, 칩 내부 세로 |
| `--space-2` | 8 | 라벨-값, 칩 사이, 막대 행 내부 |
| `--space-3` | 12 | 표 행 세로 패딩, 입력 내부 세로 |
| `--space-4` | 16 | 카드 내부(모바일), 폼 필드 사이 |
| `--space-5` | 20 | 카드 내부(기본), 패널 좌우(모바일) |
| `--space-6` | 24 | 섹션 내부 블록 사이, grid gap(데스크톱), 패널 좌우(데스크톱) |
| `--space-8` | 32 | 섹션 사이(패널 안) |
| `--space-10` | 40 | 큰 섹션 사이(데스크톱 결과 영역) |
| `--space-12` | 48 | 화면 상단 여백(초기 화면) |
| `--space-16` | 64 | 초기 화면 중앙 블록 상하 여백(데스크톱) |

이 scale 밖의 값(예: 10px, 18px, 30px)을 새로 쓰지 않는다.

### 4.2 Breakpoints & grid

| 이름 | 범위 | columns | gutter(gap) | 바깥 padding |
|---|---|---|---|---|
| mobile | 0 – 639px | 4 | 16px | 16px |
| tablet | 640 – 1023px | 8 | 16px | 24px |
| desktop | 1024 – 1439px | 12 | 24px | 24px |
| wide | ≥ 1440px | 12 | 24px | 32px |

- 최대 content 폭: 문서형 화면(초기·오류) **960px**, 워크스페이스 전체 **1440px**. 그보다 넓으면 가운데 정렬하고 양옆은 `--color-bg`.
- 텍스트 한 줄 최대 길이: 본문 **72자**(약 680px). 결과 패널이 넓어져도 본문 단락은 680px를 넘지 않는다.
- 막대 차트 행 최대 폭 **560px** — 화면이 넓다고 막대를 늘리지 않는다(비교 정확도와 시선 이동 때문).

### 4.3 App shell

```
┌──────────────────────────────────────────────────────────────┐
│ Header 56px: 서비스명 · (결과 화면) Location Chip · Business Chip │
├───────────────────────────┬──────────────────────────────────┤
│ Workspace Panel           │ Map Area                          │
│ (조건 입력 → 결과)          │ (sticky, 남은 폭 전체)              │
│ desktop 480px / wide 560px│                                   │
│ 자체 스크롤                 │                                   │
└───────────────────────────┴──────────────────────────────────┘
```

- **Header**: 높이 56px, `--color-surface`, 아래 1px `--color-border`. 왼쪽 서비스명(`--text-card-title`, 600), 결과가 있으면 가운데 정렬 없이 서비스명 오른쪽에 Location Chip·Business Chip. 오른쪽에는 "데이터 출처" 링크 1개(텍스트 버튼). 그 이상의 nav 항목을 만들지 않는다.
- **Sidebar navigation은 만들지 않는다.** 페이지가 사실상 하나(위치 → 업종 → 분석 → 결과)이고 메뉴로 갈 곳이 없다. 기능이 늘어 화면이 3개 이상이 될 때 다시 판단한다.
- **Workspace Panel**: 왼쪽 고정 폭, `--color-surface`, 오른쪽 1px border. 위에서 아래로 "조건(위치·업종) → 분석 버튼 → 결과". 결과가 나오면 조건 영역은 한 줄 요약(칩 + "조건 변경" ghost 버튼)으로 접힌다.
- **Map Area**: 나머지 폭, 높이 `calc(100vh - 56px)`, sticky. 지도 SDK 연결 전(4-1~4-3)에는 같은 자리에 `--color-surface-muted` 바탕의 위치 요약 플레이스홀더(행정동 이름·좌표·"지도는 준비 중")를 둔다.
- 핵심 흐름이 시각적으로 보이게: 패널 상단에 3단계 표시 `① 위치 ② 업종 ③ 분석` (§8.13 Step Indicator). 진행 막대처럼 꾸미지 않는다.

---

## 5. Screens & States

원본 MVP 화면의 정보 구조(조건 칩 → 종합·5대 관점 막대 → 병목 → 메타 → 근거 세부 → 업종 비교 → 데이터 출처 → 면책)를 유지한다. 현재 API에 없는 원본 영역(AI 해석 문장, 지원사업 매칭)은 **자리를 만들지 않는다**(`docs/TASKS.md` 보류).

### A. 초기 화면 (분석 전)

- Desktop: shell 그대로. 패널: Display 제목 "우리동네 상권분석 매니저" + 한 줄 설명(`--text-body`, secondary: "인천 158개 행정동 공공데이터로 위치·업종을 비교합니다") → Step Indicator → 위치 선택 필드 → 업종 선택 → primary 버튼 "분석하기"(폭 100%). 지도 영역: 인천 전체 보기 + 안내 문구 "지도를 눌러 위치를 고르세요".
- hero 이미지·일러스트·통계 카운터·마케팅 문구를 넣지 않는다. 제목 위아래 여백은 `--space-12` 이하.
- "분석하기"는 위치와 업종이 모두 정해질 때까지 disabled. 무엇이 비었는지 버튼 아래 `--text-small` muted로 알려 준다("위치를 먼저 선택하세요").

### B. 분석 진행 상태

- 실제 단계가 하나의 요청(`POST /analyze`)이므로 **가짜 퍼센트 progress bar를 만들지 않는다.**
- 패널의 결과 자리에 결과 레이아웃과 같은 모양의 skeleton(§10.1) + 위쪽에 한 줄 상태: spinner 16px + "분석 중… 위치 확인 → 지표 계산 → 결과 정리". 세 단계는 텍스트 나열일 뿐 체크 표시 애니메이션을 하지 않는다.
- 업종 reference가 아직 준비되지 않은 첫 요청은 2~3초 걸릴 수 있다. 1초 이후부터 상태 문구를 보이고, 5초를 넘으면 "처음 분석하는 업종은 조금 더 걸립니다" 보조 문구를 추가한다.
- 진행 중에는 "분석하기" 버튼이 loading 상태(§7.1)이고 조건 입력은 잠긴다.

### C. 분석 결과 화면

§6 위계를 따른다. 포함 요소: 선택 위치(좌표)·행정동·업종 / 종합 점수 / 5대 관점 / 병목 / 데이터 충족률 / 가중치 출처 / 주의할 점(엔진 `경고[]` + 한계 flag) / 초보자 접근성 / 세부 분석(관점별 breakdown·raw) / 데이터 출처·면책.

### D. 위치 선택 / 지도 (4-4)

- 지도를 클릭(탭)하면 그 좌표에 마커 + 반경 500m 원을 그리고, 패널의 위치 필드에 "선택됨 · 좌표"를 채운다. 행정동 이름은 분석 응답의 `context`로 확정되므로 그 전에는 좌표만 보여 준다(지어내지 않는다).
- 분석 후: 해당 행정동 polygon을 `--color-map-dong-*`로 강조, 마커 유지.
- 인천 밖은 `--color-map-outside-dim`으로 옅게 덮어 선택 불가임을 미리 보여 준다(그래도 선택하면 `location_outside` 상태, §10.3).
- 지도 컨트롤(확대/축소/현재 위치): 오른쪽 위, 40×40px 정사각 버튼 세로 스택, `--color-surface` + 1px border + `--shadow-sm`. 지도 위 떠 있는 요소만 그림자를 허용한다(§11).
- 범례: 왼쪽 아래 작은 패널(선택 지점·반경 500m·행정동 경계), `--text-caption`.

### E. Error / Empty

§10.3 표를 따른다. backend `error.code`마다 문구·톤·사용자 다음 행동을 고정한다.

---

## 6. Analysis Result Hierarchy

사용자가 보는 순서와 화면 순서를 같게 한다. 위에서 아래로:

| 순서 | 질문 | 컴포넌트 | 시각 무게 |
|---|---|---|---|
| 1 | 어디를 분석했나 | Context Bar: Location Chip(`부평구 부평1동`) + 좌표(`--text-caption`, mono) | 중 — 패널 상단 sticky |
| 2 | 어떤 업종인가 | Context Bar: Business Chip(`PC방 · 목적방문형`) | 중 — 같은 줄 |
| 3 | 종합적으로 어떤가 | Overall Score(44px 숫자 + `/100` + "인천 158개 행정동 대비 백분위") | **최상** — 화면에서 가장 큰 숫자 1개 |
| 4 | 가장 좋은/나쁜 관점 | Perspective Score 5행 + 최고 관점 라벨 + Bottleneck Badge | 상 — 종합 바로 아래 |
| 5 | 왜 이런 점수인가 | 세부 분석: 관점별 Metric Breakdown(접힘) | 하 — 요청 시 펼침 |
| 6 | 데이터가 충분한가 | Coverage Indicator + 신뢰도·해상도 라벨 | 중하 — 요약 블록 하단 메타 줄 |
| 7 | 주의할 점 | Warning Panel(`경고[]`, 병목, 해상도 저하) | 상 — 경고가 있으면 접지 않고 요약 바로 아래 |

규칙:
- **종합 점수는 크게, 그러나 화면을 지배하지 않게.** 44px 숫자 블록은 패널 폭의 40%를 넘지 않고, 같은 줄 오른쪽에 최고 관점·병목 요약 2줄을 둔다(desktop). 종합 숫자에 색을 입히지 않는다(`--color-text-primary`).
- **5대 관점은 horizontal score bar로 표시한다.** 라벨(왼쪽 고정 폭 64px) · 막대(0–100 축, 50 위치에 기준선) · 점수(오른쪽 정렬 tabular). 막대 높이 10px, 행 높이 36px, 행 간격 `--space-2`.
  - 왜 막대인가: "다섯 관점 중 어디가 강하고 약한가?"라는 질문에는 같은 축 위 길이 비교가 가장 정확하다.
  - **radar chart는 쓰지 않는다**: 축 순서에 따라 면적이 달라 보이고, 점수 null을 표현할 수 없으며, 정확한 값 비교가 어렵다.
  - compact score card 5개 grid도 기본으로 쓰지 않는다(시선이 2차원으로 흩어진다). 모바일에서도 막대 행을 유지한다.
- 순서는 고정(시장성→안정성). 점수순 정렬 금지(P3).
- 기준선: 50(인천 행정동 중앙 백분위) 위치에 1px `--color-data-reference` 세로선 + 범례 "50 = 인천 중앙".
- 병목(`종합.병목_지표`) 행: 라벨 옆 Bottleneck Badge. 점수가 25 미만이면(엔진 경고 기준) 막대 오른쪽 끝에 warning 색 3px 표시와 badge가 warning 톤. 25 이상이면 badge는 neutral 톤("가장 낮은 관점").
- 최고 관점(`종합.최고_지표`): 라벨 옆 neutral 텍스트 "가장 강한 관점" (색칠 없음).
- 사용자가 가중치(중요도)를 바꾼 결과면 종합 아래에 "사용자 가중치 적용 · 기본 가중치 점수 61.7" 한 줄(`가중치_출처`, `기본가중치_종합점수`).

### 결과 레이아웃 (desktop 패널 기준)

```
[Context Bar: 📍부평구 부평1동  37.4894, 126.7246 | PC방 · 목적방문형 | 조건 변경]
─────────────────────────────────────────────
[Overall Score 64.1/100]   가장 강한 관점: 고객성 82.8
 인천 158개 행정동 대비     병목: 경쟁성 30.2
─────────────────────────────────────────────
 시장성 ■ ███████████░░░░░│░░░░  61.6
 고객성 ■ ████████████████│███░  82.8   가장 강한 관점
 경쟁성 ■ ██████░░░░░░░░░░│░░░░  30.2   [병목]
 입지성 ■ ████████████████│██░░  79.8
 안정성 ■ ███████████████░│░░░░  63.9
─────────────────────────────────────────────
 데이터 충족률 100% · 신뢰도 높음 4 / 보통 1 · 가중치 기본(업종그룹)
─────────────────────────────────────────────
[주의할 점]  (경고가 있으면 펼친 상태로)
[초보자 접근성]  진입장벽 중간 · 등록업 · 학교 주변 입지 규제
[왜 이런 점수가 나왔나] 관점별 아코디언 5개 (기본 접힘)
[데이터 출처 · 면책]
```
(■ = 관점 식별색 8px 사각, 막대 채움은 모두 `--color-data-bar`, │ = 50 기준선. 실제 UI에 이모지를 쓰지 않는다 — 📍는 line icon 자리 표시.)

---

## 7. Component Stylings

### 7.1 Button

공통: 높이 40px(desktop) / **44px(mobile·touch)**, 좌우 패딩 16px, radius `--radius-md`(6px), `--text-small` 600, 아이콘 16px + 간격 `--space-2`. transition 120ms.

| 종류 | 기본 | hover | active | focus |
|---|---|---|---|---|
| primary | bg `--color-accent`, 글자 inverse | bg `--color-accent-hover` | bg `--color-accent-active` | 2px `--color-focus-ring` + 2px 흰 offset |
| secondary | bg `--color-surface`, 1px `--color-border-strong`, 글자 primary | bg `--color-surface-muted` | bg `--color-surface-sunken` | 동일 |
| ghost | 배경·테두리 없음, 글자 `--color-accent` | bg `--color-accent-subtle` | bg `--color-surface-sunken` | 동일 |
| destructive | bg `--color-surface`, 1px `--color-danger-border`, 글자 `--color-danger` | bg `--color-danger-subtle` | — | 동일 |
| disabled | bg `--color-surface-muted`, 글자 `--color-text-disabled`, 테두리 `--color-border`, cursor not-allowed | 변화 없음 | — | 포커스는 받지 않음(`disabled`) |
| loading | 원래 스타일 유지 + 왼쪽 16px spinner, 글자 "분석 중…", `aria-busy="true"`, 클릭 무시 | — | — | — |

- 한 화면에 primary 버튼은 1개(현재 단계의 주 행동). destructive는 현재 기능에 쓸 곳이 거의 없다(예: "선택 지우기"도 secondary로 충분) — 되돌릴 수 없는 행동이 생길 때만.
- pill 모양 버튼, 그라데이션 버튼, 그림자 버튼 금지.

### 7.2 Input (text / number)

높이 40px(desktop) / 44px(touch), 패딩 0 12px, radius `--radius-md`, bg `--color-surface`, 1px `--color-border-strong`, `--text-body`.

| 상태 | 스타일 |
|---|---|
| default | 위 기본값. placeholder `--color-text-muted` |
| hover | 테두리 `--color-text-muted` |
| focus | 테두리 `--color-accent` + 2px focus ring(offset 0, `rgba(29,91,191,0.25)`) |
| invalid | 테두리 `--color-danger`, 아래 오류 문구 `--text-small` `--color-danger` + 아이콘, `aria-invalid="true"`, `aria-describedby` 연결 |
| disabled | bg `--color-surface-muted`, 글자 `--color-text-disabled`, 테두리 `--color-border` |

라벨은 입력 위, `--text-label`, 간격 `--space-2`. placeholder를 라벨 대신 쓰지 않는다.

### 7.3 Select — 업종 선택 (Business Select)

데이터: `GET /businesses`(4그룹 29업종, 엔진 config 순서). 순서를 바꾸지 않는다.

- 닫힌 상태: Input과 같은 크기. 선택 전 "업종 선택", 선택 후 "PC방" + 오른쪽 `--text-caption` muted 그룹명("목적방문형").
- 열린 목록(listbox): `--color-surface`, 1px border, radius `--radius-lg`, `--shadow-overlay`, 최대 높이 360px 스크롤.
  - **그룹 라벨**: `--text-caption` 600, `--color-text-muted`, 위 12px/아래 4px 여백, 선택 불가. 표기는 API `name`("고객밀착형").
  - 옵션 행: 높이 40px(touch 44px), 패딩 0 12px, `--text-body`.
  - hover/키보드 활성: bg `--color-surface-muted`.
  - selected: bg `--color-accent-subtle`, 글자 `--color-accent` 600, 오른쪽 체크 아이콘.
- **검색 규칙**: 29개라 기본은 검색 없이 그룹 목록. 검색을 넣는다면 목록 맨 위 입력 1개, 업종명 부분 일치(공백 무시), 결과가 없으면 "일치하는 업종이 없습니다"(muted). 그룹 라벨은 해당 그룹 결과가 있을 때만 보인다.
- 모바일: 같은 목록을 bottom sheet(§14)로 연다.
- 키보드: ↑↓ 이동, Enter 선택, Esc 닫기, 첫 글자 타이핑으로 이동(native `<select>`와 같은 기대 동작).

### 7.4 Location Field / 위치 선택 버튼

- 지도 연결 전(4-1~4-3): 필드 영역에 "위치" 라벨 + 좌표 표시 + secondary 버튼 "지도에서 선택"(4-4 이후 활성). 개발용 좌표 입력이 필요하면 lat/lng 두 Input(§7.2)을 같은 규칙으로.
- 지도 연결 후: 필드는 읽기 전용 요약("선택됨 · 37.4894, 126.7246")과 ghost 버튼 "다시 선택". 선택 전에는 secondary 버튼 "지도에서 위치 선택"(아이콘: map-pin line).
- 터치 목표 최소 44×44px.

### 7.5 Card

**카드를 쓰는 경우** (독립적으로 의미가 있고, 선택·비교·이동의 단위일 때):
- 세부 분석의 차트 블록(질문 하나에 답하는 묶음), 오류/빈 상태 블록, 지도 위 떠 있는 패널, 선택 가능한 항목(향후 위치 후보 등).

**카드를 쓰지 않는 경우** (section + divider로 충분):
- 결과 요약(종합·5대 관점·메타)은 한 섹션 안의 행으로, 섹션 사이는 1px `--color-border` divider.
- 초보자 접근성·주의할 점·출처는 섹션. 카드 안에 카드를 넣지 않는다.

| 속성 | 값 |
|---|---|
| radius | `--radius-lg` (8px). 이보다 둥글게 하지 않는다 |
| border | 1px `--color-border` |
| background | `--color-surface` (bg `--color-bg` 위) / 패널 안에서는 `--color-surface` + border, 또는 `--color-surface-muted` 배경 블록 |
| shadow | 없음 (`--shadow-none`) |
| padding | `--space-5` (20px) desktop / `--space-4` (16px) mobile |
| 제목-본문 간격 | `--space-3` |
| hover (클릭 가능할 때만) | 테두리 `--color-border-strong`, 배경 변화 없음, cursor pointer |
| selected | 테두리 `--color-accent-border` + 왼쪽 안쪽 3px `--color-accent` 띠, 배경 `--color-surface` 유지 |
| disabled | 배경 `--color-surface-muted`, 글자 disabled, 테두리 `--color-border` |

### 7.6 Chip / Tag

높이 28px, 좌우 패딩 `--space-3`(12px), radius `--radius-pill`, `--text-small`, 1px border.
- neutral: bg `--color-surface`, border `--color-border`, 글자 secondary
- accent(선택된 조건): bg `--color-accent-subtle`, border `--color-accent-border`, 글자 `--color-accent`
- status: §2.5 subtle 배경 + 상태 글자색 + 앞 아이콘 12px
칩은 짧은 식별자(행정동, 업종, 신뢰도, 해상도)에만. 문장을 넣지 않는다.

### 7.7 Table

업종 비교·데이터 출처·raw 값 표.
- 헤더: bg `--color-surface-muted`, `--text-label`, 글자 secondary, 높이 36px.
- 행: 높이 40px(세로 패딩 `--space-3`), 아래 1px `--color-border`, 줄무늬 배경 금지.
- 숫자 열 오른쪽 정렬 + tabular. 텍스트 열 왼쪽 정렬.
- 현재 분석 대상 행(예: 업종 비교에서 선택 업종): bg `--color-accent-subtle` + 왼쪽 3px `--color-accent` 띠 + 글자 600.
- 모바일: 표를 카드로 바꾸지 말고 가로 스크롤(첫 열 고정). 열이 3개 이하면 그대로.

### 7.8 Disclosure / Accordion

- 머리: 높이 48px, 왼쪽 chevron 16px(접힘 → 펼침 90° 회전), 제목 `--text-card-title`, 오른쪽 요약값(예: 관점 점수 `--text-score-s`). 전체 머리가 버튼(`<button aria-expanded>`).
- 펼친 내용: 위 `--space-3`, 아래 `--space-5`, 왼쪽 들여쓰기 없음.
- 여러 개를 동시에 펼칠 수 있다(비교를 위해). "모두 펼치기" ghost 버튼을 섹션 제목 오른쪽에 둔다.

---

## 8. Data Components

### 8.1 Overall Score
- 역할: "종합적으로 어떤가"(위계 3).
- 구성: 캡션 "종합 적합도"(`--text-caption` muted) → 숫자 `--text-score-xl` + `/100`(`--text-small` muted) → 설명 "인천 158개 행정동 대비 백분위"(`--text-caption`).
- 색: 숫자 `--color-text-primary`. 점수 구간별 색 금지.
- 간격: 블록 안 `--space-1`, 블록 오른쪽 요약과 `--space-6`.
- 상태: 정상 / 종합 null(엔진이 계산 불가) → 숫자 자리에 "산출 불가"(`--text-section`, muted) + 이유 한 줄.

### 8.2 Perspective Score (막대 행)
- 역할: 5대 관점 비교(위계 4).
- 구성: [8px 식별색 사각 + 라벨 64px] [막대 트랙 10px, radius 2px, 50 기준선] [점수 `--text-score-m` 48px 오른쪽 정렬] [badge 자리].
- 채움 `--color-data-bar`, 트랙 `--color-data-track`.
- 상태:
  - 정상: 점수 길이만큼 채움.
  - **데이터 없음**(`score: null`, flag `커버리지_부족_미산출` 등): 트랙 전체를 `--color-data-missing` 45° 빗금(1px, 6px 간격), 점수 자리에 "데이터 없음"(`--text-small` muted). 0으로 그리지 않는다. 툴팁/보조 문구: "이 업종은 해당 관점 데이터가 부족해 종합점수에서 제외했습니다".
  - 신뢰도 low: 점수 뒤 status chip "신뢰도 낮음"(warning subtle).
  - hover(desktop): 행 배경 `--color-surface-muted`, 클릭하면 해당 관점 세부 아코디언으로 스크롤·펼침.

### 8.3 Bottleneck Badge
- 역할: 가장 약한 관점(`종합.병목_지표`)을 표시(위계 4·7).
- 모양: chip(§7.6) "병목".
- 점수 < 25: warning 톤 + 경고 아이콘 + 요약 블록 아래 한 줄 설명 "종합 점수보다 이 관점이 실제 위험 요인일 수 있습니다".
- 점수 ≥ 25: neutral 톤, 문구 "가장 낮은 관점". 공포스러운 빨강·깜빡임 금지.

### 8.4 Coverage Indicator (데이터 충족률)
- 역할: "데이터가 얼마나 충분한가"(위계 6). `종합.데이터_충족률`(0–1), 관점별 `coverage`·`confidence`·`fallback`.
- 표현: 텍스트 우선 — "데이터 충족률 100%" + 옆에 작은 5칸 세그먼트(각 12×6px, 계산된 관점 = `--color-data-bar`, 없음 = 빗금). 원형 게이지 금지.
- 신뢰도 요약: "신뢰도 높음 4 · 보통 1". 표기 매핑은 엔진 `confidence` 값 그대로 `high`→높음, `medium`→보통, `low`→낮음(이 3개 외 값은 원문 표시). low가 있으면 warning chip.
- 해상도 한계: flag `해상도_시군구`, `해상도_저하__*`가 있으면 info chip "시군구 단위 데이터"를 해당 관점 옆에.

### 8.5 Location Chip
- 내용: map-pin line icon 14px + "부평구 부평1동"(API `context.gu_name + dong_name`). 좌표는 칩 밖 `--text-caption` mono.
- neutral chip. 클릭하면(결과 화면) 지도에서 해당 지점으로 이동.
- 행정동 이름은 **API context 값 그대로**. 점포 라벨 등으로 바꾸지 않는다(D-010 구월 충돌 포함).

### 8.6 Business Chip
- 내용: "PC방" + 구분점 + 그룹명("목적방문형"). 업종코드는 hover/보조에서만(mono, caption).
- neutral chip. 결과 화면에서 업종을 바꾸는 진입점("조건 변경")은 칩 옆 ghost 버튼으로 분리.

### 8.7 Warning Panel (주의할 점)
- 데이터: 엔진 `경고[]`(문자열), 병목 < 25, 신뢰도 low, 해상도 저하 flag, `rent_area=null`로 인한 S4 제외 안내.
- 모양: 섹션 제목 "주의할 점" + 목록. 각 항목: 왼쪽 아이콘 16px(warning/info) + `--text-body` 문장. 배경 `--color-warning-subtle`, 왼쪽 3px `--color-warning` 띠, radius `--radius-md`, 패딩 `--space-4`.
- 경고가 없으면 섹션을 숨기지 말고 "특별한 경고가 없습니다" 한 줄(muted)만 둔다 — 없음과 누락을 구분한다.
- **접지 않는다.** 아코디언 안에 넣지 않는다.

### 8.8 Beginner Accessibility (초보자 접근성)
- 데이터: `초보자_접근성.제도_진입장벽`(낮음/중간/높음), `이유[]`, `인허가`, `근거`, `필요_면허`, `입지_규제`, `창업비용_참고`.
- 표현: 3단계 세그먼트(낮음·중간·높음 칸, 현재 칸만 채움 `--color-data-bar`) + 텍스트 "진입장벽 중간". 색으로 좋고 나쁨을 칠하지 않는다(높음 = 빨강 금지).
- 아래 정의 목록(dl): 인허가 / 필요 면허 / 입지 규제 / 근거. 값이 null이면 "해당 없음" 또는 "확인 필요"(엔진 값 그대로 해석하지 않는다).
- 사용자가 면허를 입력해 진입장벽이 바뀐 경우 "보유 면허 반영" info chip.
- `초보자_접근성`이 null이면 섹션에 "이 업종은 접근성 정보가 없습니다".

### 8.9 Metric Breakdown (관점 세부)
- 위치: "왜 이런 점수가 나왔나" 섹션의 관점별 아코디언 안.
- 아코디언 머리: 식별색 3px 왼쪽 띠 + 관점명 + 점수 + 신뢰도 chip.
- 내용 순서: ① `note`(엔진 설명 문장, `--text-body`) ② 세부 지표 표: 지표명 / 점수 / 적용 가중치 / 기여도 / 상태(`breakdown[]`) ③ 관점에 맞는 차트 1개(아래) ④ flags chip ⑤ Raw Data Disclosure.
- 세부 지표 `상태`가 계산이 아니면(데이터 없음 등) 행 전체 muted + 상태 텍스트. 기여도 0으로 보이지 않게 "—" 대신 "제외".
- 차트는 질문이 있을 때만:
  | 관점 | 질문 | 차트 |
  |---|---|---|
  | 경쟁성 | 가까운 동종 점포가 얼마나 있나? | 0–500m 거리 축 위 점(dot strip) + 가까운 순 목록 5개 |
  | 시장성 | 영업시간대에 사람이 들어오나? | 24시간 막대(유입) + 업종 영업 가중선 |
  | 안정성 | 이 업종이 이 구에서 버티나? | 1·3·5년 생존율 선(구 vs 인천) |
  | 고객성·입지성 | 근거 수치 | 차트 없이 정의 목록(dl) |
  데이터가 API에 없으면 차트를 그리지 않는다(지어내지 않음). 모든 차트는 아래에 같은 수치의 표 또는 텍스트 대체를 둔다(§15).

### 8.10 Raw Data Disclosure
- 관점 아코디언 맨 아래 2차 disclosure "원시값 보기"(ghost, `--text-small`).
- 펼치면 key–value 표(`--text-table`, tabular, 키는 엔진 이름 그대로 — 번역·재가공하지 않는다), 배경 `--color-surface-muted`, 최대 높이 320px 스크롤.
- 첫 화면에서 raw를 보이지 않는다.

### 8.11 Map Marker
- 선택 지점: 지름 16px 원 `--color-map-marker` + 흰 2px 외곽선 + 바깥 1px `rgba(23,32,43,0.2)`. 핀 꼬리 모양을 쓰는 경우 높이 28px, 같은 색.
- 반경 500m 원: `--color-map-radius-fill` + 1.5px 점선 `--color-map-radius-stroke`.
- 분석 불가 지점: `--color-map-invalid-marker` 회색, 반경 원 없음.
- 현재 위치(사용자 GPS)를 쓰게 되면: 지름 12px `--color-info` + 반투명 정확도 원 — 선택 지점과 모양이 달라야 한다.

### 8.12 Map Selection State
| 상태 | 지도 | 패널 |
|---|---|---|
| 미선택 | 인천 전체, 안내 오버레이 "지도를 눌러 위치를 고르세요"(지도 아래쪽 가운데, surface 칩) | 위치 필드 비어 있음 |
| 선택(분석 전) | 마커 + 반경 원 | "선택됨 · 좌표", "분석하기" 활성(업종 선택 시) |
| 분석 중 | 마커 유지, 지도 조작 가능, 새 클릭은 무시하고 토스트 없이 커서만 기본 | loading |
| 분석 완료 | 마커 + 반경 원 + 행정동 polygon 강조 | 결과 |
| 분석 불가 | 회색 마커, 반경 원 없음 | 오류 블록(§10.3) |
| 밖 영역 hover | 커서 not-allowed, dim 영역 | — |

### 8.13 Step Indicator
- `① 위치 ② 업종 ③ 분석` 가로 3개, `--text-small`. 현재 단계 `--color-accent` 600, 완료 단계 글자 primary + 체크 아이콘 12px, 이후 단계 muted. 단계 사이는 16px 가는 선.
- 결과 화면에서는 숨기고 Context Bar로 대체한다.

---

## 9. Data Density & Progressive Disclosure

| 층 | 기본 상태 | 내용 |
|---|---|---|
| L0 요약 | 항상 펼침 | Context Bar, Overall Score, Perspective Score 5행, 병목/최고, Coverage 메타 줄 |
| L0 경고 | 항상 펼침 | Warning Panel, 데이터 없음 표시, 신뢰도 low·해상도 한계 chip |
| L1 해석 | 펼침 | 초보자 접근성 요약(진입장벽 + 이유 1~2개). 나머지 항목은 "자세히" disclosure |
| L2 근거 | 접힘(아코디언) | 관점별 note, breakdown 표, 차트 |
| L3 원자료 | 접힘(2차 disclosure) | raw key–value, flags 원문 |
| 부록 | 페이지 하단 섹션 | 데이터 출처·기준시점 표(현재 API에 없으므로 `docs/DATA.md` 기준 정적 내용 — 데이터가 바뀌면 함께 갱신), 면책(`면책` 원문), 엔진 버전(`meta.엔진버전`) |

- 패턴: accordion(관점별), disclosure(원시값·자세히), 섹션 + divider(나머지). modal은 쓰지 않는다(맥락이 끊김). 오른쪽 상세 drawer도 지금은 쓰지 않는다 — 패널 안 아코디언으로 충분하다.
- 펼침 상태는 URL·저장소에 보관하지 않는다(새 분석 시 기본값으로).
- 면책 문구(`면책`)는 접지 않고 페이지 하단에 `--text-small` muted로 항상 보인다.

---

## 10. Loading / Empty / Error

### 10.1 Loading
- **skeleton**: 결과 영역 첫 로딩에만. 실제 레이아웃과 같은 위치·크기의 블록(Overall 1개, 막대 행 5개, 메타 줄 1개), 색 `--color-surface-sunken`, radius `--radius-sm`. shimmer 애니메이션은 1.2s 1회 왕복, `prefers-reduced-motion`이면 정지.
- **spinner**: 16px, 버튼 안(loading)과 진행 상태 문구 옆에만. 화면 중앙 큰 spinner 금지.
- `/health`의 warm 진행도(예: 7/29)는 사용자에게 보여 주지 않는다. 운영 정보다.
- `GET /businesses` 로딩 중: 업종 select에 "업종 불러오는 중…" + disabled.

### 10.2 Empty
- 분석 전(초기): §5.A. 결과 자리에 빈 상태 블록 — line icon 24px(muted) + "위치와 업종을 고르면 이곳에 분석 결과가 나옵니다" + 3단계 안내. 일러스트 금지.
- 데이터 없음(관점 단위): §8.2 빗금 + "데이터 없음". 섹션 단위로 없으면 섹션 안에 한 줄 muted 설명.

### 10.3 Error (backend `error.code` 대응)

분기는 **`error.code`로만** 한다. `message`는 표시용이며 문자열로 분기하지 않는다. 422는 "사용자가 바꿀 수 있는 상황", 500은 "서버 문제".

| code | status | 톤 | 위치 | 제목 / 안내 | 다음 행동 |
|---|---|---|---|---|---|
| `invalid_request` | 422 | info(중립) | 패널 상단 inline 블록 | "요청 값이 올바르지 않습니다" / "위치와 업종을 다시 선택해 주세요" | 조건 다시 선택 |
| `invalid_business` | 422 | info | 업종 필드 아래 inline + 필드 invalid | "지원하지 않는 업종입니다" | 업종 다시 선택(목록 새로고침) |
| `invalid_analysis_options` | 422 | info | 가중치/중요도 입력 아래 inline | "분석 옵션을 확인해 주세요" + 서버 `message` 그대로(엔진 규칙 문장) | 옵션 수정·초기화 |
| `invalid_coordinate` | 422 | info | 위치 필드 아래 inline | "좌표를 확인할 수 없습니다" | 지도에서 다시 선택 |
| `location_outside` | 422 | warning(부드럽게) | 결과 자리 블록 + 지도 회색 마커 | "인천 안의 위치를 선택해 주세요" / "현재 인천 158개 행정동만 분석합니다" | 지도에서 다시 선택 |
| `no_data_nearby` | 422 | warning(부드럽게) | 결과 자리 블록 + 지도 회색 마커 | "주변 500m 안에 상가 데이터가 없어요" / "바다·산·공터처럼 점포가 없는 곳은 분석하지 않습니다. 근처 상가 쪽으로 옮겨 보세요" | 위치 다시 선택 |
| `internal_error` | 500 | danger(차분하게) | 결과 자리 블록 | "분석 중 문제가 생겼습니다" / "잠시 후 다시 시도해 주세요" | primary "다시 시도" + 하단 request_id |
| 네트워크 실패(응답 없음) | — | danger | 결과 자리 블록 | "서버에 연결할 수 없습니다" | "다시 시도" |

- 오류 블록: 카드(§7.5), 왼쪽 아이콘 20px(info/warning/danger), 제목 `--text-card-title`, 안내 `--text-body` secondary, 행동 버튼. 배경은 surface(상태 subtle 배경은 아이콘·띠에만 → 과한 경보 느낌 방지).
- **request_id**: `internal_error` 블록 맨 아래 `--text-caption` muted "문의 코드 3f2a…" (mono, 앞 8자 + 전체는 복사 버튼 ghost "복사"). 굵게·색칠하지 않는다.
- 422 오류에 빨강 배경·느낌표 대형 아이콘을 쓰지 않는다. 사용자 실수가 아니라 서비스 범위 밖인 경우도 있다.
- 오류가 나면 이전 결과를 지우고 오류 블록을 보여 준다(이전 결과를 새 조건 결과로 오해하지 않게).

---

## 11. Depth & Elevation

깊이는 **표면 단계 + 1px 선**으로 만든다. 그림자는 화면 위에 떠 있는 요소에만.

| 단계 | 표면 | 그림자 | 쓰는 곳 |
|---|---|---|---|
| 0 바닥 | `--color-bg` | 없음 | 페이지 배경 |
| 1 기본 | `--color-surface` + 1px border | 없음 | 패널, 카드, 표 |
| 1′ 안쪽 | `--color-surface-muted` | 없음 | 메타 줄, raw 영역, 표 헤더 |
| 2 지도 위 | `--color-surface` + 1px border | `--shadow-sm` | 지도 컨트롤, 범례, 안내 칩 |
| 3 떠 있음 | `--color-surface` + 1px border | `--shadow-overlay` | select 목록, tooltip, bottom sheet, toast |

- 카드에 그림자 금지. hover로 그림자를 만들지 않는다.
- glassmorphism(blur 배경) 금지. 반투명은 지도 overlay(§2.6)에만.

---

## 12. Motion

| 대상 | duration | easing | 비고 |
|---|---|---|---|
| hover/focus 색·테두리 | 120ms | `ease-out` | |
| 아코디언 펼침/접힘 | 180ms | `cubic-bezier(0.2, 0, 0, 1)` | 높이 + chevron 회전 |
| select 목록·tooltip 등장 | 120ms | `ease-out` | opacity + 4px 이동 |
| bottom sheet / 패널 전환 | 200ms | `cubic-bezier(0.2, 0, 0, 1)` | |
| 지도 마커 선택 피드백 | 160ms | `ease-out` | 크기 0.8 → 1 한 번 |
| 지도 이동(flyTo) | 400ms 이하 | SDK 기본 | |
| skeleton shimmer | 1.2s | linear | reduced-motion이면 정지 |

- 점수 숫자 카운트업, 막대 채우기 애니메이션, 페이지 진입 fade 연출 금지(값을 정확히 읽는 데 방해).
- `@media (prefers-reduced-motion: reduce)`: 위 transition을 0ms로, 지도 이동은 즉시 이동.

---

## 13. Iconography

- **line icon 한 세트만**: 1.5px stroke, 둥근 끝, 기본 16px(텍스트 옆) / 20px(오류·빈 상태) / 24px(빈 상태 대표 1개). 색은 주변 글자색을 따른다(`currentColor`).
- 라이브러리는 아직 정하지 않는다(4-1에서 결정). 정할 때 이 규칙(line, 1.5px, 24 grid)에 맞는 세트 하나만 쓰고 혼용하지 않는다.
- 쓰는 곳: map-pin(위치), store(업종), alert-triangle(warning), info(info), x-circle(danger), check(완료·선택), chevron(펼침), copy(request_id), plus/minus(지도 확대), crosshair(현재 위치).
- 장식 아이콘(섹션 제목 앞 아이콘 나열, 관점별 그림 아이콘) 금지. 관점 구분은 §2.4 식별색 사각으로 충분하다.
- 아이콘만 있는 버튼은 `aria-label` 필수 + desktop hover tooltip(`--text-caption`, surface + `--shadow-overlay`).
- 이모지를 UI 요소로 쓰지 않는다.

---

## 14. Responsive Behavior

| 화면 | desktop ≥1024 | tablet 640–1023 | mobile <640 |
|---|---|---|---|
| shell | 헤더 + [패널 480px(≥1440: 560px) │ 지도] | 헤더 + 지도 위(높이 40vh, 최소 280px) + 패널 아래(최대 720px 가운데) | 헤더 + 단계별 전체 화면 |
| 초기 | 패널 조건 + 지도 | 지도 위 + 조건 아래 | 1단계: 지도 전체 화면 + 하단 sheet(위치 확인·업종 선택·분석하기) |
| 결과 | 패널 결과 스크롤, 지도 sticky | 결과 위에 작은 지도(높이 200px, 접기 가능) | 결과 전체 화면 스크롤, 상단 sticky Context Bar, "지도 보기" 버튼으로 지도 화면 전환 |
| 5대 관점 | 막대 행 | 막대 행 | 막대 행 유지(라벨 56px, 점수 44px) |
| 표 | 그대로 | 그대로 | 가로 스크롤, 첫 열 고정 |
| 업종 select | 드롭다운 | 드롭다운 | bottom sheet |
| Overall Score | 숫자 + 오른쪽 요약 2줄 | 같음 | 숫자 위, 요약 2줄 아래 |

- **mobile bottom sheet**: 상단 radius `--radius-lg`, 손잡이 32×4px `--color-border-strong`, 높이 3단(peek 160px / half 50vh / full 90vh), `--shadow-overlay`. 지도와 결과를 한 화면에 동시에 좁게 넣지 않는다.
- 터치 목표 44×44px 이상(모든 breakpoint, 터치 기기).
- 가로 스크롤은 표 내부에만. 페이지 전체 가로 스크롤 금지.
- 폰트 크기는 breakpoint별로 바꾸지 않는다. Display만 mobile에서 24px.

---

## 15. Accessibility

- **포커스 표시**: 모든 상호작용 요소 `:focus-visible`에 2px `--color-focus-ring` + 2px 흰 offset. outline 제거 금지.
- **터치 목표**: 44×44px 이상. 지도 컨트롤 40px 버튼은 주변 4px 여백 포함 44px 영역.
- **색만으로 전달 금지**: 병목·경고·데이터 없음·신뢰도는 항상 텍스트 라벨 + 아이콘/패턴. 관점은 라벨이 주, 색이 보조.
- **헤딩 구조**: `h1` 페이지 제목(결과: "부평구 부평1동 · PC방 분석") → `h2` 섹션(주의할 점, 왜 이런 점수가…, 초보자 접근성, 데이터 출처) → `h3` 관점별 세부. 단계를 건너뛰지 않는다.
- **폼 라벨**: 모든 입력·select에 보이는 `<label>`. 지도 클릭 선택에는 같은 기능의 키보드 대안(좌표 입력 또는 "목록에서 행정동 선택")을 4-4에서 함께 제공한다.
- **오류 연결**: 필드 오류는 `aria-invalid` + `aria-describedby`로 문구와 연결. 결과 자리 오류 블록은 `role="alert"`(422·500 모두), 로딩 문구는 `aria-live="polite"`.
- **차트 대체**: 모든 막대·차트는 같은 값을 텍스트로 가진다(막대 행의 숫자, 차트 아래 표 또는 `<figcaption>` 요약). 막대 행은 `role="meter"` 대신 목록 + 숫자 텍스트로(스크린리더가 "시장성 61.6점"으로 읽게).
- **지도**: 지도 영역 `aria-label="위치 선택 지도"`, 선택 결과는 패널 텍스트로도 반드시 나온다.
- **모션**: `prefers-reduced-motion` 존중(§12).
- **대비**: §2 표의 조합만 쓴다. muted(`#656F7C`) 위에 더 옅은 글자를 쌓지 않는다.

---

## 16. Do's and Don'ts

### Do
- 결과의 모든 화면에서 **행정동(API `context`)과 업종을 Context Bar로 고정**한다.
- 5대 관점을 **항상 같은 순서·같은 0–100 축의 가로 막대**로 비교하고, 숫자를 막대 오른쪽에 tabular로 붙인다.
- 막대 채움은 `--color-data-bar` 하나. 관점 구분은 8px 식별색 사각과 라벨로.
- 50 기준선(인천 중앙)을 그려 "평균보다 위/아래"를 길이로 읽게 한다.
- 계산 못한 관점은 빗금 + "데이터 없음"으로 보여 주고 이유 한 줄을 붙인다.
- 병목은 점수 < 25일 때만 warning 톤, 그 외는 "가장 낮은 관점" 중립 표기.
- 신뢰도·해상도(시군구 단위)·S4 제외 같은 한계를 chip과 문장으로 드러낸다.
- 엔진 값(점수·라벨·note·면책)은 **그대로** 보여 준다. 반올림·의역·순서 변경 금지(3-4 pass-through 계약과 같은 정신).
- 출처와 기준시점을 결과 하단 표로 보여 준다.
- 오류는 `error.code`로 분기하고, 사용자가 할 다음 행동 하나를 버튼으로 준다.
- 섹션 사이는 divider, 카드는 독립 묶음(차트 블록·오류 블록·지도 위 패널)에만.
- desktop과 mobile을 둘 다 확인한다(§14).

### Don't
- 의미 없는 그라데이션, 네온, glassmorphism, 배경 패턴.
- 5대 관점을 무지개 5색 막대로 칠하기 / 점수 높음=초록·낮음=빨강 자동 색칠.
- 종합 점수를 화면 가득한 원형 게이지·도넛·속도계로 그리기. radar chart.
- 모든 정보를 카드로 감싸기, 카드 안에 카드, 모든 카드에 그림자.
- radius 12px 이상의 둥근 카드, pill 버튼(칩 제외).
- 낮은 점수를 빨강·느낌표·흔들림으로 공포스럽게 표현.
- `score: null`을 0점·빈 막대·"-"로 표시해 0처럼 보이게 하기.
- raw/breakdown을 첫 화면에 펼쳐 놓기. 경고를 아코디언 안에 숨기기.
- "이 자리에서 창업하세요/하지 마세요" 같은 단정 문구, 별점, 등급 메달, 점수 카운트업 애니메이션.
- 행정동 이름을 API context 대신 다른 값(점포 라벨, 추정)으로 바꾸기.
- 큰 hero 섹션, 마케팅 카피, 일러스트, 이모지 아이콘.
- 화면마다 새 색·새 spacing 값 만들기. hex를 컴포넌트 코드에 직접 쓰기.
- 중앙의 큰 spinner, 가짜 퍼센트 progress bar.
- 오류 `message` 문자열로 분기하기, request_id를 크게 강조하기.
- 원본 MVP에 있었지만 현재 API에 없는 영역(AI 해석 문장, 지원사업)을 빈 껍데기로 그리기.

---

## 17. Design Tokens

framework-agnostic CSS custom properties. 구현은 이 블록을 그대로 전역 스타일에 옮기고 컴포넌트는 토큰만 참조한다.

```css
:root {
  /* color — neutral & surface */
  --color-bg: #F5F7FA;
  --color-surface: #FFFFFF;
  --color-surface-muted: #EEF1F5;
  --color-surface-sunken: #E4E8EE;
  --color-border: #DDE2E9;
  --color-border-strong: #B9C1CC;
  --color-text-primary: #17202B;
  --color-text-secondary: #444E5B;
  --color-text-muted: #656F7C;
  --color-text-disabled: #9AA3AE;
  --color-text-inverse: #FFFFFF;

  /* color — accent (Harbor Blue, 행동·선택 전용) */
  --color-accent: #1D5BBF;
  --color-accent-hover: #174CA0;
  --color-accent-active: #123E84;
  --color-accent-subtle: #EAF1FC;
  --color-accent-border: #A8C3EC;
  --color-focus-ring: #1D5BBF;

  /* color — data (점수·차트 전용) */
  --color-data-bar: #4A6B94;
  --color-data-bar-muted: #9DB0C8;
  --color-data-track: #E4E8EE;
  --color-data-reference: #17202B;
  --color-data-missing: #C5CCD6;

  /* color — 5대 관점 식별 (라벨 마커·범례·세부 띠 전용, 막대 채움 금지) */
  --color-persp-market: #3F6FB0;
  --color-persp-customer: #2F8584;
  --color-persp-competition: #6D5BA8;
  --color-persp-location: #5A7F3F;
  --color-persp-stability: #9A6B1F;

  /* color — status (항상 텍스트·아이콘과 함께) */
  --color-success: #1E7A4C;
  --color-success-subtle: #E8F5EE;
  --color-success-border: #9FD1B6;
  --color-warning: #9A5A00;
  --color-warning-subtle: #FFF4E2;
  --color-warning-border: #F0C98A;
  --color-danger: #B42318;
  --color-danger-subtle: #FDECEB;
  --color-danger-border: #F2B8B3;
  --color-info: #2B5F9E;
  --color-info-subtle: #EDF3FA;
  --color-info-border: #B7CCE6;

  /* color — map (4-4) */
  --color-map-marker: #1D5BBF;
  --color-map-radius-fill: rgba(29, 91, 191, 0.08);
  --color-map-radius-stroke: #1D5BBF;
  --color-map-dong-fill: rgba(29, 91, 191, 0.06);
  --color-map-dong-stroke: #4A6B94;
  --color-map-boundary: #656F7C;
  --color-map-outside-dim: rgba(23, 32, 43, 0.06);
  --color-map-invalid-marker: #656F7C;

  /* typography */
  --font-sans: "Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo",
               "Noto Sans KR", "Malgun Gothic", "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  --text-display: 700 28px/36px var(--font-sans);        /* letter-spacing -0.02em */
  --text-page-title: 700 22px/30px var(--font-sans);     /* -0.015em */
  --text-section: 600 17px/26px var(--font-sans);        /* -0.01em */
  --text-card-title: 600 15px/22px var(--font-sans);
  --text-body: 400 15px/24px var(--font-sans);
  --text-small: 400 13px/20px var(--font-sans);
  --text-caption: 500 12px/16px var(--font-sans);        /* 0.01em */
  --text-label: 600 13px/18px var(--font-sans);
  --text-table: 400 13px/20px var(--font-sans);          /* tabular-nums */
  --text-score-xl: 700 44px/48px var(--font-sans);       /* -0.02em, tabular-nums */
  --text-score-m: 600 18px/24px var(--font-sans);        /* tabular-nums */
  --text-score-s: 600 14px/20px var(--font-sans);        /* tabular-nums */

  /* spacing (4px scale) */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;

  /* radius */
  --radius-sm: 4px;      /* 막대·skeleton·작은 요소 */
  --radius-md: 6px;      /* 버튼·입력·경고 블록 */
  --radius-lg: 8px;      /* 카드·목록·sheet 상단 */
  --radius-pill: 999px;  /* chip 전용 */

  /* elevation */
  --shadow-none: none;
  --shadow-sm: 0 1px 2px rgba(23, 32, 43, 0.08);                                   /* 지도 위 컨트롤 */
  --shadow-overlay: 0 4px 16px rgba(23, 32, 43, 0.12), 0 1px 3px rgba(23, 32, 43, 0.08); /* 목록·sheet·tooltip */

  /* layout */
  --header-height: 56px;
  --panel-width: 480px;
  --panel-width-wide: 560px;
  --content-max: 1440px;
  --doc-max: 960px;
  --prose-max: 680px;
  --chart-row-max: 560px;
  --control-height: 40px;
  --control-height-touch: 44px;

  /* motion */
  --duration-fast: 120ms;
  --duration-base: 180ms;
  --duration-panel: 200ms;
  --ease-out: cubic-bezier(0.2, 0, 0, 1);
}

/* breakpoints (CSS 변수로 media query를 쓸 수 없으므로 값으로 고정)
   mobile < 640px · tablet 640–1023px · desktop 1024–1439px · wide ≥ 1440px */
```

새 색·간격·radius가 필요하면 **먼저 이 표와 §2·§4를 갱신**한 뒤 쓴다.

---

## 18. Agent Prompt Guide — UI 구현 규칙

UI를 만들거나 고치기 전에:
1. **이 DESIGN.md를 읽는다.** 관련 섹션(컴포넌트·결과 위계·오류 표)을 다시 확인한다.
2. **토큰만 쓴다.** 색·spacing·radius·글꼴은 §17 토큰으로 쓰고, 컴포넌트 코드에 hex나 임의의 px 값을 직접 쓰지 않는다. 단 이 문서 본문이 컴포넌트별로 정한 고정 치수(예: 관점 라벨 64px, 점수 칸 48px, 막대 높이 10px, 마커 16px, 1px 선)는 그 값 그대로 쓴다.
3. **새 색을 만들지 않는다.** 필요하면 DESIGN.md를 먼저 갱신하자고 보고한다.
4. **spacing은 scale 안에서만**(4·8·12·16·20·24·32·40·48·64).
5. **위계를 지킨다**: Context → 종합 → 5대 관점 → 경고 → 접근성 → 세부 → 출처(§6). 순서를 바꾸지 않는다.
6. **엔진 값은 그대로** 표시한다. API `result`를 재계산·반올림·번역하지 않는다(3-4 pass-through, `docs/ENGINE.md` 계약). 행정동 이름은 `context` 그대로.
7. **오류는 `error.code`로 분기**하고 §10.3 표의 문구·톤을 쓴다.
8. **desktop(1280px)과 mobile(375px) 둘 다** 확인한다. 지도+결과를 mobile에서 한 화면에 압축하지 않는다.
9. **일반 SaaS 카드·대시보드 템플릿으로 바꾸지 않는다**(KPI 카드 grid, 도넛 차트, hero, 그라데이션 등). 이 서비스 전용 패턴(막대 행, Context Bar, Warning Panel)을 쓴다.
10. 접근성(§15): focus-visible, 44px 터치, 라벨, `aria-describedby`, 차트의 텍스트 대체.
11. API에 없는 데이터를 화면에 지어내지 않는다(빈 차트·가짜 값·placeholder 숫자 금지).

**충돌 규칙:** DESIGN.md와 실제 구현(라이브러리 제약, 지도 SDK 기본 스타일, API 변경 등)이 충돌하면 **임의로 디자인을 바꾸지 말고**, 무엇이 충돌하는지와 DESIGN.md 갱신안을 보고한다. 갱신이 승인되면 DESIGN.md를 먼저 고치고 구현한다.

빠른 프롬프트 예시:
- "결과 요약 블록을 만들어라: Context Bar(§8.5–8.6) → Overall Score(§8.1) → Perspective Score 5행(§8.2, 순서 고정, `--color-data-bar`, 50 기준선) → Coverage 메타 줄(§8.4). 카드로 감싸지 말고 divider로 나눈다."
- "`no_data_nearby` 오류 상태: §10.3 행 그대로. warning 톤 카드, 지도 회색 마커, '위치 다시 선택' secondary 버튼. 빨강 금지."
