"""
데이터 버전 검증 — 적용 전 필수, 실패하면 기존 버전 유지 (docs/DATA_VERSIONING.md §5)

  python scripts/etl/validate_version.py <버전 디렉터리|id> [--baseline data/runtime] [--write] [--json <out.json>]

단계 (앞 단계가 실패하면 뒤 단계는 돌지 않는다)
  V1 매니페스트   schema·id·역할 8개·파일 존재·sha256/bytes 일치
  V2 인코딩       CSV 를 선언 인코딩으로 strict 디코딩(전체), xlsx 열림
  V3 스키마       RUNTIME_FILES 필수 컬럼, panel 업종 29개 × 3 컬럼, 임대료 분기 열 개수
  V4 키 규칙      panel 158 = 경계 158 코드 집합, shops (시군구명,행정동명) == panel, market 11·시군구코드 == 행정동코드[:5],
                  stability __인천전체__·음식 14업종 ⊆ CODE_NAME, 임대료 인천 9개 상권
  V5 로더         load_runtime 성공, 엔진 필수 열 NaN 없음, 역·학교·유인시설 종류별 ≥ 1
  V6 라벨 일치율  경계 polygon ↔ shops 행정동 라벨 전수 일치율 — tests/test_location_agreement.py 의 floor 재사용
  V7 변화량 한계  baseline 대비 행 수·합계 변화가 LIMITS 를 넘으면 실패 (수동 확인 뒤 한계값을 조정한다)
결과: 콘솔 요약 + 종료 코드(0 pass / 1 fail). --write 면 manifest.validation 에 기록, --json 이면 파일로도 저장.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

import _common as CM  # noqa: E402
import pandas as pd

from scoring_engine import config as C, etl_location, etl_rent
from scoring_engine.location import LocationResolver
from scoring_engine.runtime import biz_panel_columns, load_runtime

TESTS_DIR = os.path.join(CM.ROOT, "tests")
BOUNDARY = os.path.join(CM.ROOT, "data", "geo", "인천_행정동경계_2026.geojson")
ID_RE = re.compile(r"^\d{4}-\d{2}[0-9a-z-]*$")
CSV_ROLES = tuple(r for r in CM.ROLES if CM.role_encoding(r) is not None)
# 유인시설 종류 — 학교급 3 + 상가 기반(etl_location). '지하철역'은 유인시설 테이블이 아니라 역 테이블이다
ANCHOR_TYPES = {"초등학교", "중학교", "고등학교"} | set(etl_location.SHOP_ANCHOR_CODE) | set(etl_location.SHOP_ANCHOR_MAJOR)
# V7 변화량 한계 (baseline 대비 비율). 초기값 — 첫 실제 버전에서 조정한다 (docs/DATA_VERSIONING.md §5)
LIMITS = {
    "shops.rows": 0.20, "panel.총인구": 0.05, "panel.종사자수": 0.10, "market_panel.일평균_유입": 0.25,
    "stations.rows": 0.10, "schools.rows": 0.10,
}


class Check:
    def __init__(self, name: str):
        self.name, self.problems, self.notes = name, [], []

    def fail(self, msg: str) -> None:
        self.problems.append(msg)

    def note(self, msg: str) -> None:
        self.notes.append(msg)

    def record(self) -> dict:
        return {"name": self.name, "status": "fail" if self.problems else "pass",
                "detail": "; ".join(self.problems or self.notes)}


def _agreement_module():
    """tests/test_location_agreement.py 의 floor 상수·resolve_codes 를 그대로 쓴다 (D-010)."""
    if TESTS_DIR not in sys.path:
        sys.path.insert(0, TESTS_DIR)
    import test_location_agreement as LA  # noqa: E402
    return LA


def _boundary_codes() -> set:
    with open(BOUNDARY, encoding="utf-8") as f:
        return {ft["properties"]["행정동코드"] for ft in json.load(f)["features"]}


# ── 단계 ───────────────────────────────────────────────────────────────
def v1_manifest(d: str, ck: Check):
    try:
        v = CM.resolve_data_version(d)
    except (ValueError, FileNotFoundError) as e:
        ck.fail(str(e))
        return None
    if v.manifest is None:
        ck.fail(f"{CM.MANIFEST_NAME} 없음 (매니페스트 없는 디렉터리는 검증 대상이 아니다 — data/runtime 은 원본 사본)")
        return None
    if not ID_RE.match(v.id):
        ck.fail(f"id 형식 아님: {v.id!r} (YYYY-MM[접미])")
    for r in CM.ROLES:
        rec = v.manifest["roles"][r]
        path = v.path(r)
        if not os.path.isfile(path):
            ck.fail(f"{r}: 파일 없음 {rec['file']}")
            continue
        if "sha256" not in rec or "bytes" not in rec:
            ck.fail(f"{r}: 매니페스트에 sha256/bytes 없음")
            continue
        info = CM.file_info(path)
        if info["sha256"] != rec["sha256"] or info["bytes"] != rec["bytes"]:
            ck.fail(f"{r}: 해시/크기 불일치 {rec['file']}")
        if not rec.get("as_of"):
            ck.fail(f"{r}: as_of 없음")
    ck.note(f"id {v.id}, 역할 {len(CM.ROLES)}개 해시 일치")
    return v


def v2_encoding(v, ck: Check):
    for r in CM.ROLES:
        enc, path = CM.role_encoding(r), v.path(r)
        if enc is None:
            try:
                pd.read_excel(path, nrows=0)
            except Exception as e:     # noqa: BLE001
                ck.fail(f"{r}: xlsx 열기 실패 ({type(e).__name__})")
            continue
        with open(path, "rb") as f:
            raw = f.read()
        try:
            raw.decode(enc)
        except UnicodeDecodeError as e:
            ck.fail(f"{r}: {enc} 디코딩 실패 (offset {e.start})")
    ck.note("선언 인코딩으로 전체 디코딩 성공")


def v3_schema(v, ck: Check):
    for r in CM.ROLES:
        enc, cols, path = CM.role_encoding(r), CM.role_required_columns(r), v.path(r)
        if not cols:
            continue
        head = pd.read_excel(path, nrows=0) if enc is None else pd.read_csv(path, encoding=enc, nrows=0)
        missing = [c for c in cols if c not in head.columns]
        if missing:
            ck.fail(f"{r}: 필수 컬럼 없음 {missing}")
    head = pd.read_csv(v.path("panel"), encoding="utf-8-sig", nrows=0)
    missing = [c for c in biz_panel_columns() if c not in head.columns]
    if missing:
        ck.fail(f"panel: 업종 컬럼 없음 {missing[:6]}{' …' if len(missing) > 6 else ''} ({len(missing)}개)")
    try:
        etl_rent.load_rent(v.path("rent"))
    except ValueError as e:
        ck.fail(f"rent: {e}")
    ck.note("필수 컬럼·업종 29×3 컬럼·임대료 분기 열 확인")


def v4_keys(v, ck: Check):
    panel = pd.read_csv(v.path("panel"), encoding="utf-8-sig", dtype={"행정동코드": str})
    codes = _boundary_codes()
    if len(panel) != len(codes):
        ck.fail(f"panel 행 {len(panel)} != 경계 행정동 {len(codes)}")
    if panel.duplicated(["시군구명", "행정동명"]).any():
        ck.fail("panel (시군구명, 행정동명) 중복")
    pc = panel["행정동코드"].astype(str)
    if not pc.str.fullmatch(r"\d{8}").all() or not pc.is_unique:
        ck.fail("panel 행정동코드가 중복 없는 8자리가 아님")
    if set(pc) != codes:
        ck.fail(f"panel 행정동코드 집합 != 경계 158 (panel 에만 {len(set(pc) - codes)}, 경계에만 {len(codes - set(pc))})")
    keys = ["시군구명", "행정동명"]
    shops = pd.read_csv(v.path("shops"), encoding="utf-8-sig", usecols=keys)[keys].drop_duplicates()
    s_keys, p_keys = set(map(tuple, shops.values)), set(map(tuple, panel[keys].values))
    if s_keys != p_keys:
        ck.fail(f"shops (시군구명,행정동명) 집합 != panel (shops 에만 {len(s_keys - p_keys)}, panel 에만 {len(p_keys - s_keys)})")
    m = pd.read_csv(v.path("market_panel"), encoding="utf-8-sig", dtype={"시군구코드": str})
    gu = set(pc.str[:5])
    if len(m) != len(gu) or not m["시군구코드"].is_unique:
        ck.fail(f"market_panel 행 {len(m)} / 유일 코드 {m['시군구코드'].nunique()} != 시군구 {len(gu)}")
    if set(m["시군구코드"]) != gu:
        ck.fail("market_panel 시군구코드 집합 != panel 행정동코드[:5] 집합")
    if panel.groupby(pc.str[:5])["시군구명"].nunique().max() != 1:
        ck.fail("시군구코드 하나에 시군구명이 여럿")
    st = pd.read_csv(v.path("stability_pc"), encoding="utf-8-sig")
    if "__인천전체__" not in set(st["시군구"]):
        ck.fail("stability_pc 에 __인천전체__ 행 없음")
    sf = pd.read_csv(v.path("stability_food"), encoding="utf-8-sig")
    bad = sorted(set(sf["업종코드"]) - set(C.CODE_NAME))
    if bad:
        ck.fail(f"stability_food 에 엔진 밖 업종코드 {bad}")
    if sf["업종코드"].nunique() != 14:
        ck.fail(f"stability_food 업종 {sf['업종코드'].nunique()}개 != 14")
    if "__인천전체__" not in set(sf["시군구"]):
        ck.fail("stability_food 에 __인천전체__ 행 없음")
    try:
        rent = etl_rent.incheon_areas(etl_rent.load_rent(v.path("rent")))
        if len(rent) != 9 or "부평" not in set(rent["상권"]):
            ck.fail(f"rent 인천 상권 {len(rent)}개 (기대 9, 부평 포함)")
    except ValueError as e:
        ck.fail(f"rent: {e}")
    ck.note(f"panel {len(panel)} = 경계 {len(codes)}, 시군구 {len(gu)}, shops 라벨 집합 일치")


def v5_loader(v, ck: Check):
    try:
        rt = load_runtime(v.data_dir)
    except Exception as e:     # noqa: BLE001
        ck.fail(f"load_runtime 실패: {type(e).__name__}: {e}")
        return None
    for col in ("위도", "경도", "상권업종소분류코드", "행정동코드"):
        n = int(rt.shops[col].isna().sum())
        if n:
            ck.fail(f"shops.{col} NaN {n}")
    for col in ("총인구", "종사자수", "1인가구비중"):
        n = int(rt.panel[col].isna().sum())
        if n:
            ck.fail(f"panel.{col} NaN {n}")
    if len(rt.stations) < 1:
        ck.fail("인천권 역 0개")
    if len(rt.schools) < 1:
        ck.fail("인천 학교 0개")
    have = set(rt.anchors["type"])
    missing = sorted(ANCHOR_TYPES - have)
    if missing:
        ck.fail(f"유인시설 종류 없음 {missing}")
    ck.note(f"역 {len(rt.stations)}, 학교 {len(rt.schools)}, 유인시설 {len(rt.anchors):,}, 임대료 상권 {len(rt.rent)}")
    return rt


def v6_agreement(v, rt, ck: Check):
    LA = _agreement_module()
    shops = pd.read_csv(v.path("shops"), encoding="utf-8-sig", dtype={"행정동코드": str},
                        usecols=["행정동코드", "시군구명", "위도", "경도"], low_memory=False)
    resolver = LocationResolver(panel=rt.panel)
    shops["resolved"] = LA.resolve_codes(resolver, shops["위도"].values, shops["경도"].values)
    shops["match"] = shops["resolved"] == shops["행정동코드"]
    rate = float(shops["match"].mean())
    if rate < LA.OVERALL_FLOOR:
        ck.fail(f"전체 일치율 {rate:.5f} < floor {LA.OVERALL_FLOOR}")
    if set(shops["시군구명"]) != set(LA.GU_FLOORS):
        ck.fail(f"shops 시군구 집합이 floor 표와 다름: {sorted(set(shops['시군구명']) ^ set(LA.GU_FLOORS))}")
    for gu, floor in sorted(LA.GU_FLOORS.items()):
        d = shops[shops["시군구명"] == gu]
        if len(d) and d["match"].mean() < floor:
            ck.fail(f"{gu} 일치율 {d['match'].mean():.5f} < floor {floor}")
    low = shops.groupby("행정동코드")["match"].mean()
    low = low[low < LA.DONG_MAJORITY_FLOOR]
    if not low.empty:
        ck.fail(f"라벨 점포 과반이 자기 동으로 판정되지 않는 동 {len(low)}개: {low.index.tolist()[:5]}")
    ck.note(f"전체 일치율 {rate:.5f} (floor {LA.OVERALL_FLOOR}), n={len(shops):,}")


def _measures(v) -> dict:
    shops_n = sum(1 for _ in open(v.path("shops"), encoding="utf-8-sig")) - 1
    panel = pd.read_csv(v.path("panel"), encoding="utf-8-sig", usecols=["총인구", "종사자수"])
    m = pd.read_csv(v.path("market_panel"), encoding="utf-8-sig", usecols=["일평균_유입"])
    st = pd.read_excel(v.path("stations"), usecols=["역사명"])
    sc = sum(1 for _ in open(v.path("schools"), encoding="cp949")) - 1
    sp = sum(1 for _ in open(v.path("stability_pc"), encoding="utf-8-sig")) - 1
    sf = sum(1 for _ in open(v.path("stability_food"), encoding="utf-8-sig")) - 1
    return {"shops.rows": shops_n, "panel.총인구": float(panel["총인구"].sum()), "panel.종사자수": float(panel["종사자수"].sum()),
            "market_panel.일평균_유입": float(m["일평균_유입"].sum()), "stations.rows": len(st), "schools.rows": sc,
            "stability_pc.rows": sp, "stability_food.rows": sf}


def v7_change_limits(v, baseline_dir: str, ck: Check):
    try:
        b = CM.resolve_data_version(baseline_dir)
    except (ValueError, FileNotFoundError) as e:
        ck.fail(f"baseline: {e}")
        return
    if os.path.abspath(b.data_dir) == os.path.abspath(v.data_dir):
        ck.note("baseline 이 자기 자신 — 변화량 검사 생략")
        return
    new, old = _measures(v), _measures(b)
    for key, limit in LIMITS.items():
        o, n = old[key], new[key]
        ratio = abs(n - o) / o if o else float("inf")
        if ratio > limit:
            ck.fail(f"{key}: {o:,.0f} → {n:,.0f} ({ratio:+.1%}, 한계 ±{limit:.0%})")
    for key in ("stability_pc.rows", "stability_food.rows"):
        if new[key] != old[key]:
            ck.fail(f"{key}: {old[key]} → {new[key]} (행 수는 같아야 한다)")
    ck.note(f"baseline {b.id} 대비 한계 안 (" + ", ".join(f"{k} {old[k]:,.0f}→{new[k]:,.0f}" for k in ("shops.rows", "panel.총인구")) + ")")


# ── 실행 ───────────────────────────────────────────────────────────────
def validate(version: str, baseline: str = CM.DEFAULT_DATA_DIR) -> dict:
    d = CM.version_dir(version)
    checks, result = [], "pass"

    def run(name, fn, *args):
        nonlocal result
        ck = Check(name)
        out = fn(*args, ck)
        checks.append(ck.record())
        if ck.problems:
            result = "fail"
        return out

    v = run("V1 manifest", v1_manifest, d)
    rt = None
    stages = [("V2 encoding", v2_encoding, lambda: (v,)), ("V3 schema", v3_schema, lambda: (v,)),
              ("V4 keys", v4_keys, lambda: (v,)), ("V5 loader", v5_loader, lambda: (v,)),
              ("V6 agreement", v6_agreement, lambda: (v, rt)), ("V7 change limits", v7_change_limits, lambda: (v, baseline))]
    for name, fn, args in stages:
        if result == "fail":
            checks.append({"name": name, "status": "skipped", "detail": "앞 단계 실패"})
            continue
        out = run(name, fn, *args())
        if name == "V5 loader":
            rt = out
    return {"script": CM.script_record("validate_version.py")["script"],
            "sha256": CM.script_record("validate_version.py")["sha256"], "run_at": CM.now_iso(),
            "version": v.id if v else None, "baseline": CM.repo_rel(CM.version_dir(baseline)),
            "result": result, "checks": checks}


def print_report(rep: dict) -> None:
    for c in rep["checks"]:
        print(f"  {c['status'].upper():7s} {c['name']:18s} {c['detail']}")
    print(f"validate {rep.get('version')}: {rep['result'].upper()}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("version", help="버전 디렉터리 또는 id (data/versions/<id>)")
    ap.add_argument("--baseline", default=CM.DEFAULT_DATA_DIR, help="변화량 비교 기준 (기본 data/runtime)")
    ap.add_argument("--write", action="store_true", help="manifest.validation 에 결과 기록")
    ap.add_argument("--json", default=None, help="결과 JSON 저장 경로")
    a = ap.parse_args(argv)
    rep = validate(a.version, a.baseline)
    print_report(rep)
    if a.json:
        with open(a.json, "w", encoding="utf-8", newline="\n") as f:
            json.dump(rep, f, ensure_ascii=False, indent=1)
    if a.write and rep["version"]:
        d = CM.version_dir(a.version)
        m = CM.load_manifest(d)
        m["validation"] = rep
        CM.save_manifest(d, m)
        print(f"[write] {os.path.join(d, CM.MANIFEST_NAME)} validation 갱신")
    return 0 if rep["result"] == "pass" else 1


if __name__ == "__main__":
    sys.exit(main())
