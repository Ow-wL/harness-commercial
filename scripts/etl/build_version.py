"""
데이터 버전 생성 — 수동으로 받은 원본 → 런타임 파일 8개 + manifest.json  (docs/DATA_VERSIONING.md §3·§7)

  python scripts/etl/build_version.py <spec.json> [--out <디렉터리>]      기본 out = data/versions/<spec.id>

spec.json (상대 경로는 spec 파일이 있는 디렉터리 기준):
{
  "id": "2026-09", "note": "상가 2026-09-30 기준 파일 반영, 나머지 승계",
  "roles": {
    "shops":          {"inputs": {"shops_csv": "_raw/2026-09/상가_인천_202609.csv"}, "as_of": "2026-09-30",
                       "sources": [{"title": "...", "url": "...", "portal_registered": "2026-10-31", "downloaded": "2026-11-01",
                                    "file": "_raw/2026-09/상가_인천_202609.csv"}]},
    "panel":          {"inputs": {"pop_csv": "...", "sgis_dir": "...", "sgis_dbf": "(선택: sgis_dir/bnd_dong_00_2025_2Q.dbf)"},
                       "as_of": "2026-09-30", "sources": [...]},
    "market_panel":   {"inputs": {"move_zips": ["..._202609.zip"]}, "as_of": "2026-09", "sources": [...]},
    "stability_pc":   {"inputs": {"permits_csv": "..."}, "as_of": "(선택: 없으면 데이터의 관측기준일)", "sources": [...]},
    "stability_food": {"inputs": {"general_csv": "...", "rest_csv": "..."}, "as_of": "(선택)", "sources": [...]},
    "stations":       {"inputs": {"file": "...xlsx"}, "as_of": "2024-12", "sources": [...]},
    "schools":        {"inputs": {"file": "...csv"}, "as_of": "...", "sources": [...]},
    "rent":           {"inputs": {"file": "...csv"}, "as_of": "2026Q2", "sources": [...]},
    "<역할>":          {"carry_from": "2026-06"}             ← 바뀌지 않은 역할은 이전 버전에서 승계: id("2026-06" = data/runtime,
                                                              그 밖은 data/versions/<id>) 또는 경로(상대 경로는 저장소 루트 기준)
  }
}

규칙
- 가공은 원본 ETL 실행 사본(scripts/etl/etl_*.py)의 함수를 원본 `__main__` 과 같은 순서로 부른다. 중간 산출물(패널_경쟁성·패널_고객성)은
  원본처럼 CSV 로 썼다가 다시 읽는다(dtype 왕복을 원본과 같게). CSV 는 utf-8-sig · '\\n' 줄바꿈 (_common.write_csv).
- 출력 디렉터리가 이미 있고 비어 있지 않으면 거부한다 (기존 버전 덮어쓰기 금지). 중간에 실패하면 이번에 만든 디렉터리를 지운다.
- 다운로드는 하지 않는다. 원본 파일은 spec 의 경로에 미리 있어야 한다.
- 검증은 하지 않는다 → 이어서 validate_version.py, diff_report.py.
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
import tempfile

import _common as CM  # noqa: E402  (_bootstrap 포함)
import pandas as pd

from scoring_engine import etl_rent

INPUT_KEYS = {
    "shops": ("shops_csv",),
    "panel": ("pop_csv", "sgis_dir"),
    "market_panel": ("move_zips",),
    "stability_pc": ("permits_csv",),
    "stability_food": ("general_csv", "rest_csv"),
    "stations": ("file",),
    "schools": ("file",),
    "rent": ("file",),
}
ETL_SCRIPTS = {
    "shops": ["etl_shops.py"],
    "panel": ["etl_shops.py", "etl_pop.py", "etl_sgis.py"],
    "market_panel": ["etl_move.py"],
    "stability_pc": ["etl_stability.py"],
    "stability_food": ["etl_stability.py", "etl_stability_food.py"],
    "stations": [], "schools": [], "rent": [],
}
LEGACY_SOURCE_NOTE = {"title": "sources/team_v0.3/07_가공데이터 (팀 전달 가공본, 출처는 sources/team_v0.3/00_README.md 데이터 표)"}


class SpecError(ValueError):
    pass


def _abs(base: str, p: str) -> str:
    return p if os.path.isabs(p) else os.path.normpath(os.path.join(base, p))


def _inputs(role: str, spec_role: dict, base: str) -> dict:
    inputs = spec_role.get("inputs") or {}
    missing = [k for k in INPUT_KEYS[role] if k not in inputs]
    if missing:
        raise SpecError(f"roles.{role}.inputs 에 {missing} 가 없다")
    out = {}
    for k, v in inputs.items():
        if isinstance(v, list):
            out[k] = [_abs(base, x) for x in v]
        else:
            out[k] = _abs(base, v)
    for k, v in out.items():
        for p in (v if isinstance(v, list) else [v]):
            if not os.path.exists(p):
                raise SpecError(f"roles.{role}.inputs.{k}: 파일 없음 {p}")
    return out


def _input_records(inputs: dict) -> dict:
    rec = {}
    for k, v in inputs.items():
        paths = v if isinstance(v, list) else [v]
        infos = [{"path": os.path.basename(p), **(CM.file_info(p) if os.path.isfile(p) else {"dir": True})} for p in paths]
        rec[k] = infos if isinstance(v, list) else infos[0]
    return rec


def _sources(spec_role: dict, base: str) -> list:
    out = []
    for s in spec_role.get("sources") or []:
        s = dict(s)
        if s.get("file"):
            p = _abs(base, s["file"])
            if os.path.isfile(p):
                s.update(CM.file_info(p))
                s["file"] = os.path.basename(p)
        out.append(s)
    return out


def _derive_stability_as_of(df: pd.DataFrame) -> str:
    """etl_stability.build 의 관측기준일과 같은 규칙: 종료일 max, 없으면 인허가일 max."""
    asof = df["종료일"].max()
    if pd.isna(asof):
        asof = df["인허가일"].max()
    return asof.date().isoformat()


class Builder:
    def __init__(self, spec: dict, base: str, out_dir: str, work: str):
        self.spec, self.base, self.out, self.work = spec, base, out_dir, work
        self.roles: dict = {}
        self._shops_df = None

    # ── 승계 ──────────────────────────────────────────────────────────
    def carry(self, role: str, source: str) -> None:
        """source: 이전 버전 id ("2026-06" = data/runtime, 그 밖은 data/versions/<id>) 또는 경로(상대 경로는 저장소 루트 기준)."""
        if source == CM.LEGACY_VERSION_ID:
            src_dir = CM.DEFAULT_DATA_DIR
        elif os.sep in source or "/" in source:
            src_dir = source if os.path.isabs(source) else os.path.join(CM.ROOT, source)
        else:
            src_dir = CM.version_dir(source)
        v = CM.resolve_data_version(src_dir)
        src = v.path(role)
        dst = os.path.join(self.out, v.files[role])
        shutil.copyfile(src, dst)
        if v.manifest is not None:
            r = v.manifest["roles"][role]
            sources, etl = r.get("sources", []), r.get("etl", [])
        else:
            sources, etl = [LEGACY_SOURCE_NOTE], []
        self.roles[role] = {"file": v.files[role], **CM.file_info(dst), "encoding": CM.role_encoding(role),
                            "as_of": v.as_of[role], "sources": sources, "etl": etl, "carried_from": v.id,
                            "inputs": {}}
        print(f"[{role}] 승계 {v.id}: {v.files[role]}")

    # ── 가공 ──────────────────────────────────────────────────────────
    def _record(self, role: str, filename: str, as_of: str, spec_role: dict, inputs: dict) -> None:
        path = os.path.join(self.out, filename)
        self.roles[role] = {"file": filename, **CM.file_info(path), "encoding": CM.role_encoding(role),
                            "as_of": as_of, "sources": _sources(spec_role, self.base),
                            "etl": [CM.script_record(s) for s in ETL_SCRIPTS[role]], "carried_from": None,
                            "inputs": _input_records(inputs)}
        print(f"[{role}] {filename} ({self.roles[role]['bytes']:,} bytes, as_of {as_of})")

    def _as_of(self, role: str, spec_role: dict, derived: str | None = None) -> str:
        v = spec_role.get("as_of") or derived
        if not v:
            raise SpecError(f"roles.{role}.as_of 가 없다")
        return str(v)

    def build_shops(self, spec_role: dict) -> None:
        import etl_shops
        inp = _inputs("shops", spec_role, self.base)
        df = etl_shops.load(inp["shops_csv"])
        CM.write_csv(df, os.path.join(self.out, CM.ROLE_FILES["shops"]))
        self._shops_df = df
        self._record("shops", CM.ROLE_FILES["shops"], self._as_of("shops", spec_role), spec_role, inp)

    def _shops_for_panel(self) -> pd.DataFrame:
        if self._shops_df is not None:
            return self._shops_df
        path = os.path.join(self.out, self.roles["shops"]["file"])   # 승계한 shops
        return pd.read_csv(path, encoding="utf-8-sig", low_memory=False)

    def build_panel(self, spec_role: dict) -> None:
        import etl_pop
        import etl_sgis
        import etl_shops
        inp = _inputs("panel", spec_role, self.base)
        dbf = inp.get("sgis_dbf") or os.path.join(inp["sgis_dir"], "bnd_dong_00_2025_2Q.dbf")
        if not os.path.isfile(dbf):
            raise SpecError(f"roles.panel.inputs.sgis_dbf: 파일 없음 {dbf}")
        # etl_shops.__main__: 패널_경쟁성.csv
        comp_csv = os.path.join(self.work, "패널_경쟁성.csv")
        CM.write_csv(etl_shops.build_panel(self._shops_for_panel()), comp_csv)
        # etl_pop.__main__: 패널_고객성.csv → 패널_경쟁성.csv 와 조인 → 패널_통합.csv
        pop_panel = etl_pop.build_panel(etl_pop.load(inp["pop_csv"]))
        CM.write_csv(pop_panel, os.path.join(self.work, "패널_고객성.csv"))
        shop_panel = pd.read_csv(comp_csv, encoding="utf-8-sig")
        merged = etl_pop.join_with_shops(pop_panel, shop_panel)
        if merged["총인구"].isna().any():
            raise SpecError("etl_pop 조인 미매칭 행이 있다 (시군구명·행정동명 이름 조인) — 행정동 개편·개명 확인")
        panel_csv = os.path.join(self.out, CM.ROLE_FILES["panel"])
        CM.write_csv(merged, panel_csv)
        # etl_sgis.__main__: 패널_통합.csv 를 다시 읽어 종사자수·1인가구 붙이고 덮어쓴다
        sgis = etl_sgis.load_stats(inp["sgis_dir"], dbf)
        panel = pd.read_csv(panel_csv, encoding="utf-8-sig")
        merged = etl_sgis.attach(panel, sgis)
        CM.write_csv(merged, panel_csv)
        self._record("panel", CM.ROLE_FILES["panel"], self._as_of("panel", spec_role), spec_role, inp)

    def build_market_panel(self, spec_role: dict) -> None:
        import etl_move
        inp = _inputs("market_panel", spec_role, self.base)
        zips = inp["move_zips"]
        if not zips:
            raise SpecError("roles.market_panel.inputs.move_zips 가 비어 있다")
        out, yms = [], []
        for zp in zips:
            ym = zp.rsplit("_", 1)[-1].replace(".zip", "")
            df = etl_move.build(zp)
            df.insert(1, "기준연월", ym)
            out.append(df)
            yms.append(ym)
        res = pd.concat(out, ignore_index=True)
        filename = f"패널_시장성_{max(yms)}.csv"      # 원본 파일명 규칙 (패널_시장성_202608.csv). 엔진은 역할 키로 찾는다
        CM.write_csv(res, os.path.join(self.out, filename))
        self._record("market_panel", filename, self._as_of("market_panel", spec_role), spec_role, inp)

    def build_stability_pc(self, spec_role: dict) -> None:
        import etl_stability
        inp = _inputs("stability_pc", spec_role, self.base)
        df = etl_stability.load(inp["permits_csv"])
        CM.write_csv(etl_stability.build(df), os.path.join(self.out, CM.ROLE_FILES["stability_pc"]))
        self._record("stability_pc", CM.ROLE_FILES["stability_pc"],
                     self._as_of("stability_pc", spec_role, _derive_stability_as_of(df)), spec_role, inp)

    def build_stability_food(self, spec_role: dict) -> None:
        import etl_stability_food
        inp = _inputs("stability_food", spec_role, self.base)
        panel, _cov = etl_stability_food.build_food(inp["general_csv"], inp["rest_csv"])
        CM.write_csv(panel, os.path.join(self.out, CM.ROLE_FILES["stability_food"]))
        derived = None
        if not spec_role.get("as_of"):     # 관측기준일을 데이터에서: build_food 와 같은 _load 로 한 번 더 읽는다 (약 6s)
            df = pd.concat([etl_stability_food._load(inp["general_csv"], "일반"),
                            etl_stability_food._load(inp["rest_csv"], "휴게")], ignore_index=True)
            derived = _derive_stability_as_of(df)
        self._record("stability_food", CM.ROLE_FILES["stability_food"],
                     self._as_of("stability_food", spec_role, derived), spec_role, inp)

    def copy_role(self, role: str, spec_role: dict) -> None:
        inp = _inputs(role, spec_role, self.base)
        dst = os.path.join(self.out, CM.ROLE_FILES[role])
        shutil.copyfile(inp["file"], dst)
        if role == "rent":
            etl_rent.incheon_areas(etl_rent.load_rent(dst))     # 분기 열 개수(엔진 상수)·인천 상권 행 확인
        self._record(role, CM.ROLE_FILES[role], self._as_of(role, spec_role), spec_role, inp)

    def run(self) -> dict:
        roles = self.spec.get("roles") or {}
        missing = [r for r in CM.ROLES if r not in roles]
        if missing:
            raise SpecError(f"spec.roles 에 역할 누락 {missing}")
        unknown = sorted(set(roles) - set(CM.ROLES))
        if unknown:
            raise SpecError(f"spec.roles 에 모르는 역할 {unknown}")
        builders = {"shops": self.build_shops, "panel": self.build_panel, "market_panel": self.build_market_panel,
                    "stability_pc": self.build_stability_pc, "stability_food": self.build_stability_food,
                    "stations": lambda s: self.copy_role("stations", s), "schools": lambda s: self.copy_role("schools", s),
                    "rent": lambda s: self.copy_role("rent", s)}
        for role in CM.ROLES:          # shops 가 panel 보다 먼저 (panel 이 shops 결과를 쓴다)
            spec_role = roles[role]
            if spec_role.get("carry_from"):
                self.carry(role, spec_role["carry_from"])
            else:
                builders[role](spec_role)
        return {"schema": CM.MANIFEST_SCHEMA, "id": self.spec["id"], "created": CM.now_iso(),
                "note": self.spec.get("note", ""), "engine_at_build": _common_engine(),
                "builder": CM.script_record("build_version.py"), "roles": self.roles}


def _common_engine() -> str:
    import scoring_engine
    return scoring_engine.ENGINE_VERSION


def build(spec_path: str, out_dir: str | None = None) -> str:
    import json
    with open(spec_path, encoding="utf-8") as f:
        spec = json.load(f)
    if not isinstance(spec.get("id"), str) or not spec["id"]:
        raise SpecError("spec.id 가 없다")
    base = os.path.dirname(os.path.abspath(spec_path))
    out = os.path.abspath(out_dir) if out_dir else os.path.join(CM.VERSIONS_DIR, spec["id"])
    if os.path.exists(out) and os.listdir(out):
        raise FileExistsError(f"이미 있음: {out} — 기존 버전을 덮어쓰지 않는다. 새 id 로 만든다")
    created = not os.path.exists(out)
    os.makedirs(out, exist_ok=True)
    work = tempfile.mkdtemp(prefix="build_version_")
    try:
        manifest = Builder(spec, base, out, work).run()
        CM.save_manifest(out, manifest)
    except BaseException:
        if created:
            shutil.rmtree(out, ignore_errors=True)
        raise
    finally:
        shutil.rmtree(work, ignore_errors=True)
    print(f"[out] {out} ({len(manifest['roles'])}개 역할, manifest.json)")
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("spec")
    ap.add_argument("--out", default=None)
    a = ap.parse_args(argv)
    try:
        build(a.spec, a.out)
    except (SpecError, FileExistsError, FileNotFoundError, ValueError) as e:
        print(f"실패: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
