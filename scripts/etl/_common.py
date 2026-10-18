"""scripts/etl 공용 — 해시, CSV 쓰기 규칙, 매니페스트 입출력, 역할 키 메타 (docs/DATA_VERSIONING.md §2·§3)."""
from __future__ import annotations

import _bootstrap  # noqa: F401  — 엔진·scripts/etl sys.path 순서 고정

import hashlib
import json
import os
from datetime import datetime

import pandas as pd

from scoring_engine.runtime import (DEFAULT_DATA_DIR, LEGACY_AS_OF, LEGACY_VERSION_ID, MANIFEST_NAME,  # noqa: F401
                                    MANIFEST_SCHEMA, ROLE_FILES, ROLES, RUNTIME_FILES, VERSIONS_DIR,
                                    DataVersion, read_manifest, resolve_data_version, version_dir)

ROOT = _bootstrap.ROOT
ETL_DIR = _bootstrap.ETL_DIR
CSV_ENCODING = "utf-8-sig"
# 원본 팀이 만든 07_가공데이터는 '\n' 줄바꿈이다 (Windows pandas 기본 '\r\n' 이 아님). 같은 입력이면 같은 바이트가 나오게 고정한다.
CSV_LINE_TERMINATOR = "\n"


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def file_info(path: str) -> dict:
    return {"sha256": sha256_file(path), "bytes": os.path.getsize(path)}


def role_encoding(role: str):
    """역할의 읽기 인코딩 (xlsx 는 None)."""
    return RUNTIME_FILES[ROLE_FILES[role]][0]


def role_required_columns(role: str):
    return RUNTIME_FILES[ROLE_FILES[role]][1]


def write_csv(df: pd.DataFrame, path: str, encoding: str = CSV_ENCODING) -> None:
    """런타임 CSV 쓰기 규칙: index 없음, utf-8-sig, '\\n' 줄바꿈."""
    df.to_csv(path, index=False, encoding=encoding, lineterminator=CSV_LINE_TERMINATOR)


def load_manifest(data_dir: str) -> dict:
    m = read_manifest(data_dir)
    if m is None:
        raise FileNotFoundError(f"{os.path.join(data_dir, MANIFEST_NAME)} 없음")
    return m


def save_manifest(data_dir: str, manifest: dict) -> str:
    path = os.path.join(data_dir, MANIFEST_NAME)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
        f.write("\n")
    return path


def script_record(name: str) -> dict:
    """매니페스트의 etl/validation 항목 — scripts/etl/<name> 의 저장소 상대 경로와 해시."""
    path = os.path.join(ETL_DIR, name)
    return {"script": repo_rel(path), "sha256": sha256_file(path)}


def repo_rel(path: str) -> str:
    try:
        return os.path.relpath(path, ROOT).replace(os.sep, "/")
    except ValueError:        # 다른 드라이브
        return path.replace(os.sep, "/")


def now_iso() -> str:
    return datetime.now().replace(microsecond=0).isoformat()


def to_jsonable(obj):
    """엔진 출력(numpy 스칼라·tuple 포함)을 JSON 왕복으로 평범한 파이썬 값으로 만든다 (tests/helpers.normalize 와 같은 방식)."""
    return json.loads(json.dumps(obj, ensure_ascii=False, default=lambda o: o.item() if hasattr(o, "item") else str(o)))
