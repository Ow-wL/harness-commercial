"""
무결성 — 원본(Source of Truth)과 그 사본들이 하네스 구축 시점의 해시와 같은지.

  원본 트리 sources/team_v0.3              ← 수정·삭제·추가 금지
  canonical 엔진 scoring_engine/v0_3       ← 원본 엔진과 바이트 동일
  data/runtime                             ← 원본 07_가공데이터와 바이트 동일 (컬럼·내용 변경 금지)
  tests/golden/v0.3                        ← 원본 05_분석결과와 바이트 동일 (덮어쓰기 금지)
"""
import os

import pytest

from helpers import (COPIES, GOLDEN_CSV, GOLDEN_CSV_SOURCE, M, SOURCE_DIR, manifest_files)


def test_source_tree_unchanged():
    if not os.path.isdir(SOURCE_DIR):
        pytest.skip("sources/team_v0.3 없음 (원본 미배포 환경) — 사본 해시 검사는 계속 수행")
    errs = M.verify()
    assert not errs, "원본이 바뀌었다 (수정 금지):\n" + "\n".join(errs)


def _copy_cases():
    for copy_dir, src_rel in COPIES.items():
        for fn in sorted(os.listdir(copy_dir)):
            full = os.path.join(copy_dir, fn)
            if os.path.isfile(full) and not fn.startswith((".", "README", "MANIFEST")):
                yield pytest.param(full, f"{src_rel}/{fn}", id=f"{os.path.basename(copy_dir)}/{fn}")
    yield pytest.param(GOLDEN_CSV, GOLDEN_CSV_SOURCE, id="golden/부평역_업종별_적합도.csv")


@pytest.mark.parametrize("copy_path,source_key", list(_copy_cases()))
def test_copy_matches_source_manifest(copy_path, source_key):
    files = manifest_files()
    assert source_key in files, f"원본에 대응 파일 없음: {source_key}"
    assert M.sha256(copy_path) == files[source_key]["sha256"], f"{copy_path} 가 원본과 다르다"


def test_all_golden_json_present():
    files = manifest_files()
    want = {k.rsplit("/", 1)[1] for k in files if k.startswith("05_분석결과/업종별_상세JSON/")}
    have = set(os.listdir(next(d for d, s in COPIES.items() if s.endswith("상세JSON"))))
    assert want <= have and len(want) == 29
