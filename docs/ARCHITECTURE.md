# Architecture

## 1. 현재 (v0.3 원본) 데이터 흐름

```
08_원본_인허가 ─(etl_stability*.py)─┐
공공데이터 원본(미포함) ─(etl_*.py)──┴─▶ 07_가공데이터 ─▶ run_all.py ─▶ scoring.analyze() ─▶ 05_분석결과
                                                          ▲  (부평역 고정)                     (CSV + JSON 29개)
```

책임 구분 (코드 기준):

| 구성요소 | 책임 | 지점 의존? |
|---|---|---|
| `scoring.analyze()` | **순수 계산**. 전달받은 dict/list로 5대 관점 백분위, 가중 결합, 병목, 경고, 접근성 태그. 파일 I/O 없음 | 아니오 (입력만 본다) |
| `radius_demand.radius_profile/build_reference` | 반경 500m 점포·면적가중 수요, 158개 행정동 중심점 비교 모집단 | profile만 |
| `etl_location.site_profile` | 역세권 강도, 유인시설 종류별 근접도 | 예 |
| `run_all.py` | 데이터 로드, **지점 → 행정동·시군구·임대료 상권 연결(하드코딩)**, analyze 입력 조립, 후처리, 파일 출력 | 예 (전부 하드코딩) |

즉 v0.3에서 "임의 지점 분석"을 막는 것은 엔진이 아니라 `run_all.py`의 입력 조립부다.

## 2. 하드코딩 (run_all.py 기준)

| 위치 | 값 | 의미 | 웹에서 필요한 것 |
|---|---|---|---|
| `LAT, LNG` | 37.4894, 126.7246 | 부평역 좌표 | 요청 좌표 |
| `GU` | `"28237"` | 시장성 패널 행 (부평구) | 좌표 → 시군구코드 |
| `panel[...=="부평구" & =="부평1동"]` | 부평1동 | 고객성 행정동 행 | 좌표 → 행정동 |
| `stab_for`: `t.시군구 == "부평구"` | 부평구 | 안정성 지점 값 | 좌표 → 시군구명 |
| `RENT_AREA` | `"부평"` | 임대료(S4) 상권 | 좌표 → R-ONE 상권(9곳) 또는 없음 |
| `Site.from_query(..., "부평역 근처 {업종}", dong_name="부평구 부평1동")` | 문구 | `meta.query`, `meta.행정동` | 지점 이름 |
| `cc = {"dong_sobun":0, "dong_jung":0, "gugu_sobun":n, ...}` | | 안정성은 항상 시군구 해상도 | 동일 규칙 유지 |
| 결과 후처리 `market.fallback="gugu"`, flag `해상도_시군구` | | 시장성은 시군구 데이터 | 동일 규칙 유지 (adapter가 수행) |
| `stab["업종코드"]="R10406"` | | PC방 안정성 패널에 업종코드 열 없음 | 동일 (runtime loader) |
| `os.chdir(DATA)`, 출력 `05_분석결과` | | 전역 부작용, golden 덮어쓰기 | 웹에서는 사용 안 함 |
| `json.dump(open(path, "w"))` | | 인코딩 미지정 → Windows에서 cp949 | 웹에서는 사용 안 함 |

엔진 내부 상수 (변경 금지, 참고): `scoring.C_BASELINE_SURVIVAL_3Y=0.552`, `meta.엔진버전="mvp-0.3"`,
`etl_location.BBOX`(인천+인접 생활권), `load_schools`의 주소 '인천' 필터, `etl_rent.QUARTERS`(2024Q3~2026Q2 고정, 최신 분기 사용).

## 3. 하네스 구조 (현재)

```
sources/team_v0.3/      원본 (읽기 전용, 해시 검증)
scoring_engine/
  location.py           LocationResolver(좌표 → 2026 인천 행정동, point-in-polygon, 코드로 panel 연결) + ContextBuilder(좌표 → SiteContext, 반경 500m 점포 0개 거부). 한 모듈 (eng review D3, D-011)
  v0_3/                 canonical 엔진 사본 (원본과 바이트 동일)
  runtime.py            RuntimeData — 런타임 데이터 1회 로드
  reference.py          ReferenceCache — 비교 모집단 캐시 (프로세스 메모리)
  context.py            SiteContext — run_all 하드코딩을 명시적 파라미터로. BUPYEONG_STATION만 검증됨
  service.py            AnalysisService.analyze(ctx, biz) — run_all 업종 루프와 같은 입력 조립 + 후처리
data/runtime/           엔진 입력 데이터 (원본 07_가공데이터 사본)
data/geo/               행정동 경계(2026-07 기준 158개) + 2024→2026 crosswalk. 별도 매니페스트, raw/는 git 제외 (D-009)
data/cache/             (비어 있음) 향후 reference 디스크 캐시
tests/                  무결성, canonical 엔진, 데이터 스키마, golden regression, adapter 계약
scripts/check.*         전체 검증
backend/, frontend/     (비어 있음) 향후 FastAPI, React + TypeScript
```

## 4. 목표 구조

```
Frontend (React+TS, 지도)
  │  POST /analyze {lat, lng, biz_code, importance?, user_weights?, user_licenses?}
  ▼
Backend API (FastAPI)            입력 검증, 오류 응답, 응답 스키마. 엔진 결과를 바꾸지 않는다 (pass-through)
                                 입력·도메인 오류 → 4xx + error code, 내부 오류 → 500 + request_id (D-012)
  ▼
Location Resolver                lat/lng → 인천 내부 여부, 행정동(코드·이름), 시군구(코드·이름). 2026-07 polygon 직접 사용 (2024 crosswalk는 검증용, D-009)
  ▼
Analysis Context Builder         좌표 → SiteContext (location.ContextBuilder, rent_area=None, 500m 점포 0개 거부) → analyze() 입력 dict (service.py)
  ▼
Scoring Engine (v0_3, 불변)
```

### Location Resolver / Context Builder (구현됨: `scoring_engine/location.py`, 아래는 설계 당시 요구사항과 현재 상태)
1. **행정동 경계 데이터.** → `data/geo/인천_행정동경계_2026.geojson` (158개, panel 코드와 일치, 1-1·1-2 완료, D-009). 아래는 확보 전 기록.
   런타임 데이터에는 경계 폴리곤이 없다. 점포 좌표에 붙은 행정동 라벨만 있다.
   - 데이터의 시군구는 **개편 후 체계**다: 제물포구·영종구·서해구·검단구 (구 중구·동구·서구 아님), 시군구코드 28125/28155/28275/28290.
     경계 데이터도 같은 체계·같은 코드여야 한다. 코드 체계 불일치가 가장 큰 위험.
   - 대안(근사): 상가 점포 최근접 이웃 다수결. 경계 데이터 검증용으로도 쓸 수 있다.
2. **키 규칙** (테스트로 고정됨): `시군구코드 == 행정동코드[:5]`, 패널 158개 행정동 = 상가 데이터 158개 행정동.
3. **임대료 상권 연결 규칙.** R-ONE은 인천 9개 상권만 있고 경계가 이미지뿐. 설계서 11-x의 "상권명 역 중심 500m" 근사를 쓸지 팀 결정 필요. 연결 안 되면 `rent_area=None` → S4 제외(엔진이 가중치 재분배).
4. **인천 밖 / 바다 / 데이터 공백 좌표 거부** 규칙. Resolver는 어느 행정동 polygon에도 속하지 않는 점을 `LocationOutside`로 거부한다.
   주의: 연안 행정동 polygon은 바다를 일부 포함한다. 이런 점은 Resolver를 통과하고, ContextBuilder가 반경 500m 안 점포 0개면 `NoDataNearby`로 거부한다. 해안에서 500m 안에 점포가 있으면 바다 위 점도 분석된다 (예: 37.45, 126.40 → 영종구 용유동, 반경 내 점포 있음).
5. 부평역 좌표 → Resolver 결과 `부평구 부평1동` = `BUPYEONG_STATION`과 같은 행정동 (TASKS 1-4 완료, 엔진 버전 변경 불필요). 일반 경로의 `rent_area`는 `None`이라 안정성(S4)·종합은 golden과 다를 수 있다 (D-011).

> ✅ **해결된 우려 (TASKS 1-4).** 하드코딩 좌표(37.4894, 126.7246)에서 가장 가까운 점포 50개가 `부평6동` 라벨이라
> Resolver가 부평6동을 낼 수 있다고 봤지만, polygon 기준 이 좌표는 `부평1동`이다 (부평6동 경계까지 17m).
> 그 점포들은 경계 건너편에 있고 라벨과 polygon 모두 부평6동이다. golden 컨텍스트와 같으므로 엔진·golden 변경 없음 (D-010).
>
> ⚠ **남은 데이터 이슈 (TASKS 1-5a).** 남동구 구월1동 서쪽 띠는 경계상 구월1동이지만 점포 라벨 2,486개는 구월3동이다.
> 보정하지 않고 polygon 결과를 쓴다 (D-010 known conflict).

## 5. 성능과 캐시 경계

측정 (2026-10-05, Windows 11, Python 3.10, 이 저장소의 adapter 기준):

| 작업 | 시간 | 지점 의존 | 처리 |
|---|---|---|---|
| 런타임 데이터 로드 (`load_runtime`) | 3.6s (상가 CSV 0.55s, 역 병합 루프·xlsx 포함) | 아니오 | 앱 시작 시 1회 |
| `build_reference` (업종 1개) | ~2.0s | 아니오 | **업종별 캐시** (29개, 콜드 합계 ~60s) |
| 입지 reference (유인시설 집합 1개) | ~0.4s | 아니오 | **유인시설 집합별 캐시** (14개) |
| 안정성 기준 분포 | ms | 아니오 | 그때그때 (가벼움) |
| `radius_profile` (지점 1개) | ~14ms | 예 | 요청마다 |
| `analyze` 1건 (캐시 warm) | ~20ms | 예 | 요청마다 |
| 29개 업종 전체 (캐시 warm) | ~0.5s | 예 | 요청마다 |

위험 요소:
- **콜드 스타트 60초+.** `build_reference`를 요청 경로에서 처음 계산하면 첫 요청이 최대 1분 걸린다. → backend는 `RuntimeData` 로드 후 바로 서비스하고 29개 warm은 background에서 진행, 아직 warm되지 않은 업종은 on-demand 계산 (TASKS 3-1, D-012). 디스크 캐시(2-2)는 필요해질 때.
- `build_reference`는 호출마다 `dong_total`·중심점을 다시 groupby하고, 158개 중심점마다 13.5만 점포 전체에 haversine을 돈다. 수요(분모) 부분은 업종과 무관한데 업종마다 반복된다. (최적화는 golden으로 동일성 검증한 뒤에만)
- `ReferenceCache`는 계산 중 전역 lock을 잡는다 → 콜드 상태 동시 요청과 background warm은 직렬화된다 (요청당 대기 ≤ 업종 1개 계산, 약 2s).
- 멀티 워커(uvicorn workers N)면 워커마다 데이터·캐시를 따로 가진다 → 메모리 N배, 콜드 N번. 디스크 캐시가 필요해지는 지점.

캐시 경계 (무효화 키):
- 런타임 데이터 + reference: `(엔진 버전, data/runtime 해시, config.RADIUS_M, 업종코드 | 유인시설 집합)`. 데이터나 엔진이 바뀌지 않으면 영구 유효.
- 지점 결과: `(위 키, lat, lng, biz, 사용자 가중치/중요도/면허)`. 필요해지면 그때 도입 (현재 불필요, 20ms).
- `data/cache/`에 쓸 때는 위 키를 파일명/메타에 넣고, 키가 다르면 버린다. 캐시는 정답이 아니다 — golden이 정답이다.
