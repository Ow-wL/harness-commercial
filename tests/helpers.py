"""테스트 공용 경로·비교 함수."""
from __future__ import annotations

import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import manifest as M  # noqa: E402

SOURCE_DIR = M.SOURCE_DIR
GOLDEN_DIR = os.path.join(ROOT, "tests", "golden", "v0.3")
GOLDEN_CSV = os.path.join(GOLDEN_DIR, "부평역_업종별_적합도.csv")
GOLDEN_JSON_DIR = os.path.join(GOLDEN_DIR, "json")
ENGINE_COPY_DIR = os.path.join(ROOT, "scoring_engine", "v0_3")
RUNTIME_DIR = os.path.join(ROOT, "data", "runtime")

# 하네스 사본 → 원본 트리 안의 경로 (매니페스트 키)
COPIES = {
    ENGINE_COPY_DIR: "04_엔진코드/engine",
    RUNTIME_DIR: "07_가공데이터",
    GOLDEN_JSON_DIR: "05_분석결과/업종별_상세JSON",
}
GOLDEN_CSV_SOURCE = "05_분석결과/부평역_업종별_적합도.csv"

# float 비교 허용오차: 부동소수점 잡음만 허용한다. 반올림된 점수(0.1 단위)가 바뀌면 실패해야 한다.
REL_TOL = 1e-9
ABS_TOL = 1e-9


def manifest_files() -> dict:
    return M.load_manifest()["files"]


def load_json(path: str):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def normalize(obj):
    """엔진 출력(dict, tuple, numpy 스칼라)을 JSON 왕복으로 golden 과 같은 형태로 만든다."""
    return json.loads(json.dumps(obj, ensure_ascii=False))


def _is_num(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def deep_diff(got, want, path: str = "$", out=None) -> list[str]:
    out = [] if out is None else out
    if _is_num(got) and _is_num(want):
        if math.isnan(got) and math.isnan(want):
            return out
        if not math.isclose(got, want, rel_tol=REL_TOL, abs_tol=ABS_TOL):
            out.append(f"{path}: {got!r} != {want!r}")
    elif isinstance(got, dict) and isinstance(want, dict):
        for k in sorted(set(got) | set(want)):
            if k not in got:
                out.append(f"{path}.{k}: missing in output")
            elif k not in want:
                out.append(f"{path}.{k}: unexpected key in output")
            else:
                deep_diff(got[k], want[k], f"{path}.{k}", out)
    elif isinstance(got, list) and isinstance(want, list):
        if len(got) != len(want):
            out.append(f"{path}: length {len(got)} != {len(want)}")
        for i, (a, b) in enumerate(zip(got, want)):
            deep_diff(a, b, f"{path}[{i}]", out)
    elif got != want:
        out.append(f"{path}: {got!r} != {want!r}")
    return out
