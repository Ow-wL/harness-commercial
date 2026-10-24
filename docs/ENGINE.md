# Scoring Engine v0.3 (`mvp-0.3`)

위치: `scoring_engine/v0_3/` (원본 `sources/team_v0.3/04_엔진코드/engine/`과 바이트 동일). 상세 설계: 원본 `03_설계서_기획/5대관점_스코어링_설계서.md`.

## 진입점

```python
scoring.analyze(site, dong, panel, stores, stations, facilities, cohort_counts,
                radius_profile=None, radius_ref=None, loc_profile=None, loc_ref=None,
                user_weights=None, importance=None, user_licenses=None, schools=None) -> dict
```
웹/테스트에서는 직접 부르지 않고 adapter를 쓴다:
```python
from scoring_engine.service import AnalysisService
from scoring_engine.context import BUPYEONG_STATION
AnalysisService().analyze(BUPYEONG_STATION, "R10406", importance={"stability": 5})
```

## 입력 (실데이터 경로 — run_all.py / service.py 기준)

| 인자 | 내용 |
|---|---|
| `site` | `Site(lat, lng, biz_code, biz_name, dong_name, query)` |
| `dong` | 분석 지점 값: `pop_total, target_pop, target_share, workers, solo_household_share` (행정동), `inflow_daily, inflow_by_hour[24], work_ratio` (시군구), `gugu_rent_per_sqm, rent_area` (상권), `survival_3y__gugu_sobun, closure_rate__gugu_sobun, avg_tenure__gugu_sobun` (시군구, 있을 때만). 미보유: `gugu_spend_yoy, same_biz_net_change_1y, bus_stop_density = None` |
| `panel` | 비교 모집단 리스트: 158개 행정동(고객성), 11개 시군구(시장성), 9개 상권(임대료), 업종별 시군구(안정성), 반경 동종비중 158개(경쟁성) |
| `stores, stations, facilities` | 실데이터 경로에서는 빈 리스트. 대신 `radius_profile/radius_ref`, `loc_profile/loc_ref`를 쓴다 (리스트 경로는 demo 합성데이터용) |
| `cohort_counts` | `{"dong_sobun":0,"dong_jung":0,"gugu_sobun":부평구 3년 표본,"incheon_avg":9999}` → 안정성은 시군구 해상도 |
| `schools` | 학교명·type·lat·lng — 접근성 태그의 학교 300m 확인용 (점수 무관) |
| `user_weights` / `importance` / `user_licenses` | 사용자 조건 (동시에 weights+importance 불가) |

## 출력 (JSON 계약)
`meta`(업종, 업종코드, 업종그룹, 행정동, 분석반경_m, 엔진버전) · `종합`(점수, 적용_가중치, 최고_지표, 병목_지표, 데이터_충족률, 가중치_출처, 기본_가중치, [중요도, 하한_적용, 기본가중치_종합점수]) · `지표[5]`(key, label, score, raw, confidence, coverage, fallback, flags, note, breakdown[]) · `초보자_접근성` · `경고[]` · `면책`.
예시: `tests/golden/v0.3/json/full_PC방.json`.

## 5대 관점 (세부지표 가중치)
| 관점 | 세부지표 | 해상도 |
|---|---|---|
| 시장성 market | M1 일평균 유입 0.40 · M3 시간대 적합도 0.30 · M2 상권성격 적합도 0.20 · M4 업종소비 증감 0.10(데이터 없음) | 시군구 |
| 고객성 customer | C1 타겟연령 인구 0.35 · C2 타겟 비중 0.30 · C3 종사자 0.20 · C4 1인가구 0.15(업종 민감도) | 행정동 |
| 경쟁성 competition | P2 점포당 잠재수요 0.50 · P1 동종 비중 0.30(역) · P4 순증감 0.20(데이터 없음) | 반경 500m |
| 입지성 location | L2 역세권 강도 0.35 · L3 유인시설 근접도 0.35 · L1 최근접역 거리 0.20(역) · L4 버스 0.10(데이터 없음) | 좌표 |
| 안정성 stability | S1 3년 생존율 0.40 · S2 폐업률 0.25(역) · S3 평균 업력 0.20 · S4 임대료 0.15(역) | 시군구 / 상권 |

세부지표 점수 = 비교 모집단 대비 백분위(`pct_rank`: 값보다 엄격히 작은 비율, 역방향 지표는 `100 − 그 값`, 표본 5 미만이면 None). 예외: C4는 50 쪽으로 당긴 값(`50 + (백분위 − 50) × 민감도`), L3는 유인시설 종류별 백분위의 평균. 비교 모집단은 관점마다 다르다(시장성 11개 구, 고객성 158개 행정동, 경쟁성·입지성 158개 점포 중심점, 안정성 업종별 구 — `docs/SCORE_EXPLANATION_AUDIT.md` 4장). 결측은 0점이 아니라 제외 후 재정규화.
관점 점수 = 세부지표 점수의 가중평균, coverage < 0.5면 None. 종합 = 관점 점수의 그룹 가중치 가중평균. **관점·종합 점수는 백분위·순위가 아니다** (`meta.정규화_기준` "인천 전체 행정동 백분위"와 병목 경고의 "인천 하위 N%"는 엔진 원문이며 화면은 이를 순위로 표시하지 않는다). 병목 = 최저 관점, 25 미만이면 경고(가중치 무관).
안정성은 최대 13개 업종(PC방 + 음식 12)만 산출된다 — 나머지는 데이터 없음(정상). 그 13개도 지점 시군구의 3년 표본이 30 미만이면 None이다. 미산출이어도 엔진은 폴백 flag(`해상도_저하__incheon_avg` 등)와 note "표본이 부족해 … 단위로 계산했습니다"를 남기므로, 화면은 미산출 관점에 해상도 칩·이 note를 쓰지 않고 score·coverage로 안내한다.

## 29개 업종 / 4개 그룹
- A 고객밀착형: 편의점 G20405, 슈퍼마켓 G20404, 미용실 S20701, 피부 관리실 S20702, 네일숍 S20703, 세탁소 S20901, 약국 G21501
- B 유동인구형: 카페 I21201, 빵/도넛 I21001, 김밥/만두/분식 I21007, 토스트/샌드위치/샐러드 I21005, 아이스크림/빙수 I21008, 버거 I21004, 치킨 I21006, 피자 I21003
- C 목적방문형: PC방 R10406, 독서실/스터디 카페 R10202, 입시·교과학원 P10501, 요가/필라테스 학원 P10603, 당구장 R10310, 노래방 R10407, 전자 게임장 R10404
- D 체류소비형: 백반/한정식 I20101, 생맥주 전문 I21103, 일반 유흥 주점 I21101, 요리 주점 I21104, 중국집 I20201, 일식 회/초밥 I20301, 양식 I20401

## 변경 금지 영역 (v0.3)
`config.py`: `BIZ_GROUP`(업종 그룹·29개 업종), `WEIGHTS`, `AGE_PROFILE`, `SOLO_SENSITIVITY`, `HOUR_PROFILE`, `WORK_PREF`, `ANCHOR`, `RADIUS_M`·감쇠 거리, `MIN_COHORT_N*`, `BOTTLENECK_THRESHOLD`, `MIN_WEIGHT`, `IMPORTANCE_MULT`, `MIN_COVERAGE`, `SYNONYM`.
`scoring.py`: 세부지표 가중치, `pct_rank`, `_weighted`, `_conf`, 폴백 사다리, 병목·경고 규칙, `resolve_weights`(R1~R6).
`access.py`: `ACCESS` 표, `barrier_level` 규칙, 학교 300m 검사.
`radius_demand.py`, `etl_location.py`: 반경 수요·비교 모집단·역 병합·유인시설 규칙.
adapter 후처리(시장성 `fallback="gugu"`, `해상도_시군구`)도 golden에 포함되므로 같은 취급.

변경이 필요하면: 새 엔진 버전(예: `v0_4/`) + golden 새 버전 디렉터리 + DECISIONS 기록. v0.3 golden은 그대로 둔다. (v0.4 = 반경 D-024, v0.5 = 팀 전달 v0.5 + 반경 D-028)

## v0.4 (`mvp-0.4`, D-024) — 분석 반경 선택
- `scoring_engine/v0_4/` = v0.3 사본 + 최소 diff: `config.RADIUS_OPTIONS_M = (300, 500, 1000)`, `scoring.analyze(..., radius_m=None)`(기본 500, 다른 값은 `ValueError`) → 경쟁성 raw `반경m`·`meta.분석반경_m`에 기록, `엔진버전 = "mvp-0.4"`.
- 반경은 경쟁성(과 종합·경고)만 바꾼다. 비교 모집단(`build_reference`)도 반경마다 다르므로 `radius_profile`·`radius_ref`를 같은 반경으로 만들어 넘겨야 한다(`AnalysisService`가 한다).
- 프로세스당 엔진 하나: `SCORING_ENGINE_VERSION=v0_4`(또는 `v0_5`). 기본은 v0.3.
- 변경 금지: 허용 diff 밖 변경은 `tests/test_engine_v0_4_diff.py`가 막는다. 바꾸려면 새 버전으로.

## v0.5 (`mvp-0.5`, D-028) — 팀 전달 v0.5 + 반경 선택
상세(차이·이유·검증·퍼즐 조사 반영 방식): `docs/ENGINE_V0_5.md`.
- `scoring_engine/v0_5/` = 팀 전달 엔진(`sources/team_v0.5/04_엔진코드/engine`) 13개 파일 + 반경 최소 diff(`config.RADIUS_OPTIONS_M`, `analyze/score_competition/score_customer(..., radius_m)`, 경쟁성 raw `반경m`·`meta.분석반경_m`·고객성 `인구_기준` 문구). 허용 diff 밖은 `tests/test_engine_v0_5_diff.py`가 막는다. `엔진버전`은 팀과 같은 `mvp-0.5`.
- 팀 번들의 "v0.4"(집적 효과)는 웹 v0.4(반경)와 다른 변경이다. 웹 v0.5는 팀 v0.4·v0.5를 모두 포함한다.
- 진입점 추가 인자: `analyze(..., agg_ref=반경 전체 점포 수 분포, radius_m=…)`. 반경 계산 `radius_profile/build_reference(..., pop_col=DEMAND_COLS, extra_cols=[타겟_업종, 총인구, 종사자수], same_weights=config.same_weights(업종), areas=DongAreas)` → `customer_inputs(rp, ref, 타겟열)`로 고객성 지점 값·비교 분포를 같은 반경 값으로 덮어쓴다(`service.py`가 팀 run_all v0.5와 같은 순서로).
- 경계: `etl_boundary.DongAreas(data/geo/SGIS_행정동경계_2025_2Q_인천.geojson, panel)` 1회 로드(`RuntimeData.areas`, `boundary.py`가 UTF-8로 읽고 중심점 가중치 재사용). 158/158 연결, 분동 4곳은 모체 동 경계(팀 v0.5: × 인구 비율 — 결함, v0.5.1에서 수정, D-029).
- 캐시 키: 경쟁성 (업종, 반경) — 같은 표가 경쟁성·집적도·고객성 비교 분포를 준다(87개). 입지성 (유인시설 집합, 학교구역 적용 여부) — 18개(반경 무관).
- 반경은 고객성(반경 인구)·경쟁성(과 종합·경고)을 바꾼다. 시장성·입지성·안정성·초보자 접근성은 반경과 무관(golden r300·r1000으로 확인).
- 출력 추가: 고객성 raw `종사자_민감도`·`1인가구_민감도`·`인구_기준`, 경쟁성 raw `동종점포수_정확일치`·`동종점포수_실효(대체업종_포함)`·`대체업종_계수`·`업종_집적유형`·`집적_계수`·`상권_집적도_백분위`·`잠재수요_구성`(+ 세부지표 `p3` 상권 집적도, 집적형·중간형만), 입지성 raw `역_의존도`·`학교구역_제외_학교수`, 안정성 raw `임대료_해석`, `초보자_접근성.학교구역_200m_학교수`, `meta.정규화_기준` = "인천 158개 행정동 중심점(동네 평균 지점) 대비 백분위 — 상업지 후보지끼리의 순위가 아님". 학교구역 경고는 `경고[0]`.
- 이름은 같지만 뜻이 바뀐 raw: 고객성 `타겟연령_거주인구`·`종사자수`(반경 면적 배분), 경쟁성 `반경_추정수요`(거주 + 종사자), `점포당_잠재수요`(÷ 실효 동종 수), `동종업종_비중`(실효 ÷ 전체), 입지성 `유인시설_근접도`(가까운 3곳 평균). `동종점포수`는 정확 일치 그대로(= `/nearby-stores` count).
- 변경 금지: 팀 원본과 같은 설정·계산(가중치·집적 계수·역 의존도·민감도·대체업종·학교구역 거리). 지오비전 퍼즐 수치로 바꾸지 않는다(D-028).
- golden: `tests/golden/v0.5/`(500m = 팀 결과 사본, r300·r1000 = `scripts/golden_v0_5.py`). Python 3.12+로 만든 팀 결과와 3.10 실행의 `종합.적용_가중치` 반올림 1칸 차이(14칸)만 테스트가 재계산으로 허용한다.

## v0.5.1 (`mvp-0.5.1`, D-029) — v0.5 + 분동 배분 결함 수정
- `scoring_engine/v0_5_1/` = `v0_5` + `etl_boundary.DongAreas`의 분동 비율 한 줄(비율 1.0) + 엔진버전 문자열(`scoring.py`, 사본 `test_access.py`). 허용 diff `tests/test_engine_v0_5_1_diff.py`, 해시 `tests/manifests/engine_v0_5_1.sha256.json`.
- 결함(팀 엔진 유래): 신설 분동(아라1·2동, 운서1·2동)을 SGIS 2025 모체 경계로 연결하면서 가중치에 "분동 인구 ÷ 형제 합"을 곱했다. 패널 값은 이미 분동별이라 배분 인구 = 면적 비율 × 인구비 × 분동 값(이중 적용) — 같은 경계·같은 총량에서 분동 전보다 약 절반. 비율은 팀 `etl_sgis.attach`(SGIS **모체** 통계를 분동에 나눔, 그곳은 맞음)에서 온 규칙이다.
- 수정 가정: 분동들은 모체 경계 안에 고르게 산다(엔진의 동 안 균등 거주 가정 그대로) → 분동마다 모체 면적 비율만 곱한다. 분동 전후 배분 총량이 보존된다(합성·실데이터 테스트). 대안(2026 자식 경계로 따로 배분)은 경계 출처가 섞여 다음 과제로 둔다(`docs/ENGINE_V0_5.md` 9장).
- v0.5(`v0_5/`, golden v0.5 = 팀 결과)는 그대로 둔다 — 결함 재현 테스트가 v0.5에 고정돼 있다. golden v0.5.1 = `tests/golden/v0.5.1/r300·r500·r1000`(`scripts/golden_v0_5.py`). 응답 형태는 v0.5와 같다(프런트 `isAreaWeightedEngine`).

## 알아둘 결합 (주의)
- `AGE_PROFILE`은 실데이터 경로에서 `raw.타겟_정의` 문구에만 쓰인다. 타겟 인구 값은 `패널_통합.csv`의 `타겟_{업종명}` 컬럼(ETL `etl_pop.py`가 계산)에서 온다. 연령 프로파일을 바꾸려면 패널 재생성이 필요하다.
- 패널 컬럼명이 **업종명**(`타겟_PC방`, `PC방`)이다. `config.CODE_NAME`의 이름을 바꾸면 컬럼을 못 찾는다.
- `Site.from_query`는 업종을 문구에서 다시 해석한다. adapter는 해석 결과가 요청 업종코드와 다르면 오류를 낸다.
- 원본 테스트(test_weights/test_access 14건)는 합성 데이터(demo.py)만 쓴다. 실데이터 검증은 golden regression이 담당한다.
