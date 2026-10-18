# data/versions

데이터 버전 디렉터리 (`docs/DATA_VERSIONING.md`). 엔진 버전과 다른 축이다.

```
data/versions/<id>/            id 예: 2026-09 (상가 2026-09-30 기준 파일이 들어온 묶음)
  manifest.json                역할 키 8개 → 파일명·sha256·출처·기준일·ETL 해시·검증 결과·스냅샷  (commit)
  <런타임 파일 8개>             컬럼·인코딩·키 규칙은 data/runtime 과 같다                        (git 제외, 약 38MB)
  snapshot/부평역_29업종.json    diff_report.py --snapshot 이 만든 이전 버전 비교용 스냅샷          (commit)
```

- `data/runtime/`(원본 사본, 매니페스트 없음)이 버전 `2026-06`이다. 로더는 `DATA_VERSION`(id 또는 디렉터리)으로 고른다.
- 만들기: `python scripts/etl/build_version.py <spec.json>`(바뀌지 않은 역할은 `"carry_from": "2026-06"` 으로 승계) → `validate_version.py <dir> --write` → `diff_report.py data/runtime <dir> --snapshot`.
- 기존 버전 디렉터리는 덮어쓰지 않는다. 새 자료는 새 id 로.
- 원본 다운로드 파일은 `_raw/`(git 제외) 아래 두고 spec 에 경로를 적는다. 자동 다운로드 코드는 없다(수동 절차: `docs/DATA_VERSIONING.md` §7).
