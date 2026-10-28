# 데이터 버전 구조 (묶음 C, 2026-10-19 설계 메모)

> 범위: backend·스크립트 쪽 구조만. 프런트 표시·결과 캐시 키 변경은 묶음 A가 끝난 뒤 별도 단위.
> 근거: `docs/IMPROVEMENT_PLAN_2026-10.md` 2-1절, 사용자 결정(2026-10-19) — 데이터 교체는 **엔진 버전과 분리된 축**,
> 적용은 **반자동**(수집·검증·차이 보고서는 자동, 운영 리비전 전환은 사용자 승인).
> 이 문서의 "제안" 절(§8, §9)은 `docs/DECISIONS.md`·`docs/TASKS.md`에 아직 쓰지 않았다.

## 1. 축 분리 — 엔진 버전 × 데이터 버전

| 축 | 식별자 | 고르는 곳 | 바뀌면 |
|---|---|---|---|
| 엔진 | `SCORING_ENGINE_VERSION=v0_3\|v0_4` (`mvp-0.3`·`mvp-0.4`) | `scoring_engine/__init__.py` | 점수 공식·입력 계약. golden 필요 (D-006) |
| 데이터 | `DATA_VERSION` (기본 = `data/runtime` = 버전 `2026-06`) | `scoring_engine/runtime.py` | 같은 공식에 다른 자료. golden 대신 **검증 + 부평역 29업종 스냅샷 비교** |

- `data/runtime/`은 원본 `07_가공데이터`의 바이트 동일 사본이며 그대로 둔다. 매니페스트가 없고, 로더가 코드 상수(`LEGACY_VERSION_ID`·`LEGACY_AS_OF`)로
  버전 `2026-06`·기준일을 채운다. v0.3·v0.4 golden은 이 데이터로 계속 통과한다.
- 새 버전은 `data/versions/<id>/`에 **8개 런타임 파일 + `manifest.json`**(+ `snapshot/`)으로 둔다. 기존 버전 디렉터리는 덮어쓰지 않는다
  (`build_version.py`가 거부). 데이터 파일(약 38MB)은 git 제외, `manifest.json`·`snapshot/`만 commit (`.gitignore`).
- 엔진은 프로세스당 하나(D-024)이고 데이터도 프로세스당 하나다. 실행 중 프로세스에서 파일을 바꾸지 않는다 — 적용은 새 이미지·새 리비전(§6).
- 엔진 상수가 바뀌어야 하는 갱신(임대료 분기 `etl_rent.QUARTERS`)은 데이터 버전이 아니라 엔진 버전(v0.5)으로 다룬다.

## 2. 역할 키 → 파일 (`scoring_engine/runtime.py ROLE_FILES`)

| 역할 키 | 기본 파일명(`2026-06`) | 인코딩 | 기준일 키(`as_of`) 의미 | 만드는 ETL |
|---|---|---|---|---|
| `shops` | `인천_상가_정제.csv` | utf-8-sig | 상가(상권)정보 자료 기준일 (지금 `2026-06-30`) | `etl_shops.py` |
| `panel` | `패널_통합.csv` | utf-8-sig | 주민등록 인구 기준월 말일 (지금 `2026-08-31`; SGIS 2024는 `sources`에 기록) | `etl_shops.py` → `etl_pop.py` → `etl_sgis.py` |
| `market_panel` | `패널_시장성_202608.csv` | utf-8-sig | 생활이동 기준월 (지금 `2026-08`). **파일명에 월이 들어가므로 역할 키로만 찾는다** | `etl_move.py` |
| `stability_pc` | `패널_안정성.csv` | utf-8-sig | 인허가(PC방) 관측기준일 (지금 `2026-05-07`) | `etl_stability.py` |
| `stability_food` | `패널_안정성_음식.csv` | utf-8-sig | 인허가(일반·휴게음식점, 인천) 관측기준일 (지금 `2026-09-29`) | `etl_stability_food.py` |
| `stations` | `역사_전국도시철도.xlsx` | (xlsx) | 역사정보 기준 (지금 `2024-12`) | 없음 — 원본 그대로 |
| `schools` | `학교_전국.csv` | cp949 | 학교 위치 기준 (지금 `2026-03`) | 없음 — 원본 그대로 |
| `rent` | `임대료_소규모상가_R-ONE.csv` | cp949 | 최신 분기 (지금 `2026Q2`, 엔진 상수 고정) | 없음 — 원본 그대로 |

컬럼·인코딩·키 규칙은 지금과 같아야 한다(스키마 변경 금지). 필수 컬럼은 `RUNTIME_FILES`(파일명 기준, 기존 그대로)에 있고, `ROLE_FILES`가 역할 키 → 기본 파일명을 잇는다.

## 3. `manifest.json` 형식 (`schema: 1`)

```json
{
  "schema": 1,
  "id": "2026-09",
  "created": "2026-11-05",
  "note": "상가 2026-09-30 기준 파일 반영. 나머지 역할은 2026-06 에서 승계",
  "roles": {
    "shops": {
      "file": "인천_상가_정제.csv",
      "sha256": "<파일 sha256>", "bytes": 35456902,
      "encoding": "utf-8-sig",
      "as_of": "2026-09-30",
      "sources": [
        {"title": "소상공인시장진흥공단_상가(상권)정보_20260930",
         "url": "https://www.data.go.kr/data/15083033/fileData.do",
         "portal_registered": "2026-10-31", "downloaded": "2026-11-01",
         "file": "소상공인시장진흥공단_상가(상권)정보_인천_202609.csv", "sha256": "<원본 sha256>", "bytes": 0}
      ],
      "etl": [{"script": "scripts/etl/etl_shops.py", "sha256": "<스크립트 sha256>"}],
      "carried_from": null
    },
    "panel":          {"...": "sources 에 인구·SGIS 두 출처, etl 에 etl_shops·etl_pop·etl_sgis 세 항목"},
    "market_panel":   {"file": "패널_시장성_202609.csv", "as_of": "2026-09", "...": "..."},
    "stability_pc":   {"carried_from": "2026-06", "...": "승계한 역할은 sources·etl 을 승계 원본 그대로 복사하고 carried_from 에 원본 버전 id"},
    "stability_food": {"...": "..."},
    "stations":       {"...": "..."},
    "schools":        {"...": "..."},
    "rent":           {"...": "..."}
  },
  "validation": {
    "script": "scripts/etl/validate_version.py", "sha256": "<스크립트 sha256>",
    "run_at": "2026-11-05T10:00:00", "baseline": "2026-06", "result": "pass",
    "checks": [{"name": "V1 manifest", "status": "pass", "detail": "..."}]
  },
  "snapshot": {
    "path": "snapshot/부평역_29업종.json", "sha256": "<스냅샷 sha256>",
    "engine": "mvp-0.4", "radius_m": 500, "created": "2026-11-05T10:05:00"
  }
}
```

- 날짜 구분: `as_of`(자료 기준일, 화면·API에 쓰는 값) / `portal_registered`(포털 등록일) / `downloaded`(수집일) / `created`(버전 생성일).
  화면·API에는 `as_of`만 나간다.
- `sha256`·`bytes`는 버전 디렉터리 안 파일 기준. 로더는 매니페스트의 `file` 이름만 쓰고 해시 검사는 `validate_version.py`(V1)가 한다.
- `validation`·`snapshot`은 생성 시점엔 없고 `validate_version.py --write`·`diff_report.py --snapshot`이 채운다.
- 매니페스트 자체는 해시하지 않는다(자기 참조). 변조 방지는 git commit 이력으로 한다.

## 4. 로더 동작 (`scoring_engine/runtime.py`)

```
resolve_data_version(data_dir=None)
  data_dir 인자 > 환경변수 DATA_VERSION > DEFAULT_DATA_DIR(data/runtime)
  DATA_VERSION 값: 디렉터리 경로(구분자 포함 또는 존재하는 디렉터리) 또는 버전 id(data/versions/<id>)
  <dir>/manifest.json 있음 → DataVersion(id=manifest.id, files=roles[*].file, as_of=roles[*].as_of, manifest=...)
  없음                   → 그 디렉터리를 버전 2026-06 으로 본다 (ROLE_FILES 기본 파일명, LEGACY_AS_OF)
load_runtime(data_dir=None) → RuntimeData(..., data_dir, version=DataVersion)
  읽기 호출(pd.read_csv 인자·dtype·인코딩·순서)은 그대로. 경로만 version.path(role) 로 바뀐다.
```

- `RuntimeData.as_of(role)` → `version.as_of[role]` (매니페스트 값, 없으면 `LEGACY_AS_OF[role]`).
- `scoring_engine/nearby.py SHOPS_AS_OF`는 `LEGACY_AS_OF["shops"]`의 별칭으로 남긴다. `NearbyStoreFinder.as_of`가 데이터 메타를 따르고,
  backend `/nearby-stores`의 `as_of`는 이 값을 낸다.
- `GET /health`에 `data: {version, as_of: {역할 키: 기준일}}` 추가. `/analyze` 응답 스키마는 바꾸지 않는다(프런트 Zod strict).
- `location.default_resolver()`는 기본 경계 + 기본 panel(`data/runtime`)이며 테스트·검증 전용이다. 웹 경로의 `ContextBuilder`는
  `rt.panel`을 쓰므로 데이터 버전을 따른다.

## 5. 검증 단계 (`scripts/etl/validate_version.py <버전 디렉터리> [--baseline <디렉터리>] [--write]`)

앞 단계가 실패하면 뒤 단계는 돌지 않는다(빠른 실패). 결과는 `pass`/`fail` + 단계별 상세, `--write`면 `manifest.validation`에 기록.

| 단계 | 검사 | 실패 예 |
|---|---|---|
| V1 매니페스트 | `schema == 1`, `id` 형식 `YYYY-MM[접미]`, 역할 8개 모두 있음, 파일 존재, sha256·bytes 일치 | 역할 누락, 해시 불일치 |
| V2 인코딩 | CSV를 선언 인코딩으로 **strict** 디코딩(전체), xlsx 열림 | cp949 파일을 UTF-8로 저장 |
| V3 스키마 | `RUNTIME_FILES` 필수 컬럼, `panel` 업종 29개 × (`{업종}`, `타겟_`, `타겟비중_`), 임대료 열 개수(`etl_rent.load_rent`) | 컬럼 누락 |
| V4 키 규칙 | `panel` 158행·(시군구명, 행정동명) 중복 없음·`행정동코드` 8자리 유일·`data/geo/인천_행정동경계_2026.geojson` 158개 코드와 집합 일치, `shops` (시군구명, 행정동명) 집합 == `panel`, `market_panel` 11행·`시군구코드` 집합 == `행정동코드[:5]` 집합·코드당 시군구명 1개, `stability_pc`에 `__인천전체__`, `stability_food` 업종코드 ⊆ `config.CODE_NAME`·14개, 임대료 인천 9개 상권(`부평` 포함) | 157/158, 행정동 개편·개명 |
| V5 로더 | `load_runtime(dir)` 성공, 엔진 필수 열 NaN 없음(`shops` 좌표·코드, `panel` 총인구·종사자수·1인가구비중), 역 ≥ 1·학교 ≥ 1·유인시설 종류별 ≥ 1 | 조인 실패로 NaN |
| V6 라벨 일치율 | 경계 polygon ↔ `shops` 행정동 라벨 전수 일치율: 전체·구별 floor(`tests/test_location_agreement.py`의 `OVERALL_FLOOR`·`GU_FLOORS` 재사용), 동 과반 0.5 | 좌표계·경계 어긋남 |
| V7 변화량 한계 | baseline(기본 `data/runtime`) 대비: `shops` 행 ±20%, `panel` 총인구 합 ±5%·종사자수 합 ±10%, `market_panel` 일평균_유입 합 ±25%, `stations`·`schools` 행 ±10%, `stability_*` 행 수 같음 | 반쪽 파일, 단위 변경 |

V8(별도 스크립트) `diff_report.py`: 부평역 29업종을 두 버전으로 계산해 차이 보고서. 점수 변화는 정상이며, **미산출(score None)·NaN·오류가 늘면 실패**.
한계값(V7)은 초기값이며 실제 첫 버전(2026-09)에서 조정한다 — 조정은 이 표와 스크립트 상수(`LIMITS`)를 함께 바꾼다.

## 6. 적용·복구 절차 (반자동 — 전환만 사용자 승인)

```
[자동]   build_version → validate_version(--write) → diff_report(--snapshot) → 보고서 사용자 검토
[승인]   사용자 승인
[배포]   이미지 빌드(데이터 버전 포함) → Cloud Run 새 리비전(무트래픽, 태그) → /health data.version·engine 확인
         → warm 87/87(v0.4) → smoke(/nearby-stores as_of, 부평역 /analyze 값 = diff_report 값) → 트래픽 100% 전환
[보존]   이전 리비전·이미지는 복구용으로 보존 (docs/DEPLOYMENT_2026-10-19.md 와 같은 절차)
[복구]   gcloud run services update-traffic … --to-revisions <이전 리비전>=100  (파일 교체 없음, 프로세스가 통째로 바뀐다)
```

- 실행 중 프로세스에서 데이터를 바꾸지 않으므로 `RuntimeData`·`ReferenceCache` 무효화는 자동(새 프로세스). 디스크 캐시·멀티 워커는 계속 미도입(D-016).
- 이미지에 데이터 버전을 넣는 방법(제안, 이번 단위에서 Dockerfile은 바꾸지 않았다): build arg `DATA_VERSION`(기본 비움 = `data/runtime`),
  값이 있으면 `COPY data/versions/${DATA_VERSION}/ data/versions/${DATA_VERSION}/` + `ENV DATA_VERSION=${DATA_VERSION}`.
- 프런트(9-C4 완료, 2026-10-28, D-033): backend 가 `/analyze`·`/nearby-stores` 성공 응답 헤더 `X-Data-Version`에 데이터 버전 id 를 싣고(본문 스키마 그대로), 프런트는 결과마다 그 버전으로 결과 캐시(버전이 바뀌면 전체 폐기)·A/B 비교 계약(엔진·데이터 버전이 같을 때만 한 비교)을 나눈다. 화면 기준일은 `/health data.as_of`(결과 버전과 다르면 비움 → `/health` 재조회). 아래 줄은 9-C4 전의 기록이다 —
  그 전까지는 데이터 버전이 바뀐 리비전으로 전환할 때 열린 화면의 결과 캐시가 이전 데이터 결과를 보여 줄 수 있다 → 전환 공지·새로고침.

## 7. 수집(fetch) — 수동 다운로드 절차 (자동 다운로드 코드 없음)

포털 로그인·ZIP·약관·봇 차단을 확인하지 않았으므로 자동 다운로드는 쓰지 않는다. 받은 원본은 저장소 밖(예: `data/versions/_raw/<id>/`, git 제외)에 두고
`build_version.py` 입력 JSON에 경로·출처·등록일·수집일을 적는다. 받은 파일은 먼저 `scripts/etl/run_etl.py prep <파일>`(원본 `prep.py` 진단)로 인코딩·컬럼·좌표계를 본다.

| 역할 | 출처 (공식 포털) | 주기·확인 | 받는 법 |
|---|---|---|---|
| `shops` | 소진공 상가(상권)정보 [15083033](https://www.data.go.kr/data/15083033/fileData.do) | 분기. 20260630 파일 2026-08-05 등록, 차기 2026-10-31 | 로그인 → 파일 다운로드(ZIP) → 인천 CSV(UTF-8) |
| `panel`(인구) | 행안부 행정동 성별·연령별 인구 [15097972](https://www.data.go.kr/data/15097972/fileData.do) | 월간 | CSV(cp949) |
| `panel`(SGIS) | 국가데이터처 SGIS 행정구역 통계 및 경계 [15129688](https://www.data.go.kr/data/15129688/fileData.do) | 반기 (2027-02까지 변화 없음) | ZIP(SHP·CSV·DBF). `etl_sgis.py`가 기대하는 파일명 4개 + `bnd_dong_00_2025_2Q.dbf` |
| `market_panel` | 서울시 수도권 생활이동 [OA-22298](https://data.seoul.go.kr/dataList/OA-22298/F/1/datasetView.do) | 월간, 월 ~73MB ZIP | ZIP 그대로(`etl_move.py`가 스트리밍) |
| `stability_pc` | 행안부 인허가 인터넷컴퓨터게임시설제공업(전국) — 데이터셋 ID 미확인 | 수시 | 전국 CSV(cp949) |
| `stability_food` | 행안부 인허가 일반음식점 [15096283]·휴게음식점 (전국) | 수시 | 전국 CSV → `run_etl.py prep <파일> --incheon`으로 인천 추출 |
| `stations` | 전국도시철도역사정보표준데이터 [15013205](https://www.data.go.kr/data/15013205/standard.do) | 연간 | xlsx |
| `schools` | 전국초중등학교위치표준데이터 [15021148](https://www.data.go.kr/data/15021148/standard.do) | 수시 | CSV(cp949) |
| `rent` | 한국부동산원 R-ONE (data.go.kr [15069766]은 2025Q1에서 멈춤) | 분기 | 엔진 상수 고정 → 승계. 새 분기는 엔진 v0.5 |

## 8. 제안 — D-006 개정 문안 (`docs/DECISIONS.md`에는 아직 쓰지 않음)

> ## D-006 Golden 변경은 엔진 버전 변경일 때만 (2026-10-19 개정: 데이터 버전 축 분리)
> v0.3 golden·매니페스트는 덮어쓰지 않는다 (`scripts/manifest.py create`는 기존 파일이 있으면 거부). **점수 공식·설정·입력 계약**을 바꾸면:
> 새 엔진 디렉터리(`scoring_engine/v0_4/`), 새 golden(`tests/golden/v0.4/`), 변경 이유를 여기 기록, 이전 버전 대비 차이 보고서.
> v0.3 golden 테스트는 v0.3 엔진에 대해 계속 통과해야 한다.
>
> **데이터 교체는 엔진 버전과 다른 축이다** (2026-10-19, 사용자 결정, `docs/DATA_VERSIONING.md`). 같은 스키마의 새 시점 자료는
> `data/versions/<id>/` + `manifest.json`으로 두고 `DATA_VERSION`으로 고른다. 기존 golden(v0.3·v0.4)은 계속 `data/runtime`(데이터 버전
> `2026-06`)으로 통과시키며 새 데이터 버전에 golden을 만들지 않는다. 대신 (a) `scripts/etl/validate_version.py` 7단계 검증과
> (b) 부평역 29업종 스냅샷(`snapshot/`)을 매니페스트에 기록해 이전 버전과 차이 보고서(`diff_report.py`)로 비교한다 — 점수 변화는 정상,
> 미산출·NaN·오류 증가는 실패. 엔진 상수가 바뀌어야 하는 갱신(임대료 분기)만 엔진 버전으로 다룬다. 적용은 새 이미지·새 리비전(무트래픽 → warm → 전환)이며
> 실행 중 프로세스의 파일을 바꾸지 않는다. `data/runtime/`은 계속 원본 바이트 동일 사본이다.

## 9. 제안 — `docs/TASKS.md` 9장 문안

> ## 9. 데이터 버전 구조 (묶음 C, D-006 개정 — `docs/DATA_VERSIONING.md`)
> - [x] 9-1 구조 (2026-10-19): 역할 키 로더(`DATA_VERSION`, 매니페스트 없으면 `data/runtime` 동작 바이트 동일), `/health data`, `/nearby-stores as_of` 데이터 메타,
>   `scripts/etl/`(원본 ETL 실행 사본 7개 + `validate_version.py`·`build_version.py`·`diff_report.py`·`run_etl.py`), 테스트. 전체 check 통과. 운영 미반영.
> - [ ] 9-2 첫 데이터 버전 `2026-09`: 상가 2026-09-30 파일(2026-10-31 등록 예정) 수동 수집 → `build_version` → `validate_version` → `diff_report` → V7 한계값 조정 → 사용자 검토.
>   인허가(PC방) 데이터셋 ID 확인. 생활이동 202609 ZIP. 상가·인구·SGIS·생활이동 ETL 경로는 이때 처음 실제 원본으로 실행한다.
> - [ ] 9-3 이미지·배포: Dockerfile build arg `DATA_VERSION`(§6), 무트래픽 리비전 → warm → smoke → 전환(사용자 승인), `docs/DEPLOYMENT_*.md` 기록.
> - [x] 9-4 프런트(2026-10-28 완료, TASKS 9-C4 · D-033): `/health data.version`을 결과 캐시 키·A/B 대조에 추가, 데이터 출처 표·점포 안내·`scoreGuide.ts` 날짜를 API 값으로(정적 날짜 제거 테스트), "데이터 YYYY-MM 기준" 표시.
> - [ ] 9-5 반자동화: 월 1회 수집 알림(상가 분기 등록 후), 검증·보고서 자동 실행. 포털 약관·봇 차단 확인 전에는 다운로드 자동화 없음.

## 10. 이번 단위에서 확인한 것 / 못 한 것

- 원본 `08_원본_인허가` 3개 파일로 `etl_stability.py`·`etl_stability_food.py`(실행 사본)를 돌리면 `data/runtime/패널_안정성.csv`·`패널_안정성_음식.csv`와
  **줄바꿈(`\n`)까지 맞추면 바이트 동일**하다 (2026-10-19 측정; Windows pandas 기본 `\r\n`이라 `build_version.py`는 `lineterminator="\n"`으로 쓴다).
  `tests/test_etl_scripts.py`가 이 재현을 검사한다(원본은 읽기만 한다).
- 상가·인구·SGIS·생활이동 원본은 저장소에 없어 `etl_shops`·`etl_pop`·`etl_sgis`·`etl_move` 경로는 **실행하지 못했다**(함수 호출 순서만 원본 `__main__`과 같게 옮겼다). 첫 버전(9-2)에서 실제 원본으로 검증한다.
- 새 데이터를 받지 않았다(상가 차기 파일 2026-10-31). `data/versions/`에는 README만 있다.
- Dockerfile·프런트·`docs/TASKS.md`·`docs/DECISIONS.md`는 바꾸지 않았다(§6·§8·§9 제안).
