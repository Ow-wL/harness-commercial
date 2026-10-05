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

점수 = 인천 비교 모집단 대비 백분위(`pct_rank`, 표본 5 미만이면 None). 결측은 0점이 아니라 제외 후 재정규화.
관점 coverage < 0.5면 관점 점수 None. 종합 = 그룹 가중치 가중평균. 병목 = 최저 관점, 25 미만이면 경고(가중치 무관).
안정성은 13개 업종(PC방 + 음식 12)만 산출된다 — 나머지는 데이터 없음(정상).

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

변경이 필요하면: 새 엔진 버전(예: `v0_4/`) + golden 새 버전 디렉터리 + DECISIONS 기록. v0.3 golden은 그대로 둔다.

## 알아둘 결합 (주의)
- `AGE_PROFILE`은 실데이터 경로에서 `raw.타겟_정의` 문구에만 쓰인다. 타겟 인구 값은 `패널_통합.csv`의 `타겟_{업종명}` 컬럼(ETL `etl_pop.py`가 계산)에서 온다. 연령 프로파일을 바꾸려면 패널 재생성이 필요하다.
- 패널 컬럼명이 **업종명**(`타겟_PC방`, `PC방`)이다. `config.CODE_NAME`의 이름을 바꾸면 컬럼을 못 찾는다.
- `Site.from_query`는 업종을 문구에서 다시 해석한다. adapter는 해석 결과가 요청 업종코드와 다르면 오류를 낸다.
- 원본 테스트(test_weights/test_access 14건)는 합성 데이터(demo.py)만 쓴다. 실데이터 검증은 golden regression이 담당한다.
