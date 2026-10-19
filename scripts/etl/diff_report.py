"""
데이터 버전 차이 보고서 — 부평역 29업종을 두 데이터 버전으로 계산해 비교한다 (docs/DATA_VERSIONING.md §5 V8)

  python scripts/etl/diff_report.py <A: 디렉터리|id> <B: 디렉터리|id> [--out report.md] [--snapshot] [--radius 500]
  예:  python scripts/etl/diff_report.py data/runtime 2026-09 --out docs/reports/data_2026-09_diff.md --snapshot

- 분석 지점은 golden 과 같은 BUPYEONG_STATION(rent_area="부평", 엔진 context.py). 엔진은 이 프로세스의 SCORING_ENGINE_VERSION 하나.
- 점수가 바뀌는 것은 정상이다. **실패 판정**은 B 에서 오류·종합 미산출(score None)·NaN 이 A 보다 늘었을 때, 업종이 빠졌을 때,
  그리고 A 에서 산출되던 (업종, 관점)이 B 에서 미산출이 됐을 때(관점별 비교 — 총수가 같아도 잡는다).
- --snapshot: B 의 29업종 스냅샷을 <B>/snapshot/부평역_29업종.json 에 쓰고 B manifest.snapshot 에 경로·sha256·엔진·반경을 기록
  (B 에 매니페스트가 있을 때만). 스냅샷은 데이터+엔진의 파생물이라 다시 만들면 덮어쓴다.
- 두 버전을 한 프로세스에서 차례로 계산한다 (RuntimeData 2벌, 약 2×(4s 로드 + 60s reference)).
"""
from __future__ import annotations

import argparse
import math
import os
import sys

import _common as CM  # noqa: E402

from scoring_engine import ENGINE_VERSION, RADIUS_OPTIONS_M, config as C
from scoring_engine.context import BUPYEONG_STATION
from scoring_engine.runtime import load_runtime
from scoring_engine.service import AnalysisService

SNAPSHOT_REL = os.path.join("snapshot", "부평역_29업종.json")
PERSPECTIVES = ["market", "customer", "competition", "location", "stability"]


def _is_nan(x) -> bool:
    return isinstance(x, float) and math.isnan(x)


def _count_nan(obj) -> int:
    if isinstance(obj, dict):
        return sum(_count_nan(v) for v in obj.values())
    if isinstance(obj, list):
        return sum(_count_nan(v) for v in obj)
    return 1 if _is_nan(obj) else 0


def snapshot_of(results: dict, version_id: str, radius_m: int, errors: dict | None = None) -> dict:
    """업종별 핵심 값만 추린 스냅샷. results = {업종코드: analyze() 결과}, errors = {업종코드: 오류 문자열}."""
    biz = {}
    for code, res in results.items():
        r = CM.to_jsonable(res)
        ind = {i["key"]: i for i in r["지표"]}
        biz[code] = {"업종": r["meta"]["업종"], "종합": r["종합"]["점수"], "병목": r["종합"]["병목_지표"],
                     "충족률": r["종합"]["데이터_충족률"],
                     "관점": {k: ind[k]["score"] for k in PERSPECTIVES if k in ind},
                     "confidence": {k: ind[k].get("confidence") for k in PERSPECTIVES if k in ind},
                     "raw": {k: ind[k].get("raw") for k in PERSPECTIVES if k in ind},
                     "nan": _count_nan(res), "경고": [w if isinstance(w, str) else CM.to_jsonable(w) for w in r.get("경고", [])]}
    return {"version": version_id, "engine": ENGINE_VERSION, "radius_m": radius_m, "site": "부평역 (BUPYEONG_STATION)",
            "created": CM.now_iso(), "errors": dict(errors or {}), "businesses": biz}


def compute(data_dir: str, radius_m: int) -> dict:
    rt = load_runtime(data_dir)
    svc = AnalysisService(rt)
    results, errors = {}, {}
    for code in C.CODE_NAME:
        try:
            results[code] = svc.analyze(BUPYEONG_STATION, code, radius_m=radius_m)
        except Exception as e:      # noqa: BLE001 — 보고서에 남긴다
            errors[code] = f"{type(e).__name__}: {e}"
    return snapshot_of(results, rt.version.id, radius_m, errors)


def _perspective_none(snap: dict) -> set:
    """미산출(score None)인 (업종코드, 관점) 집합."""
    return {(code, k) for code, v in snap["businesses"].items() for k, score in v["관점"].items() if score is None}


def _rank(snap: dict) -> dict:
    rows = sorted(snap["businesses"].items(), key=lambda kv: -(kv[1]["종합"] if kv[1]["종합"] is not None else -1))
    return {code: i + 1 for i, (code, _) in enumerate(rows)}


def compare(a: dict, b: dict) -> dict:
    """두 스냅샷 비교. verdict pass/fail 과 업종별 차이."""
    ra, rb = _rank(a), _rank(b)
    rows, problems = [], []
    none_a = sum(1 for v in a["businesses"].values() if v["종합"] is None)
    none_b = sum(1 for v in b["businesses"].values() if v["종합"] is None)
    nan_a = sum(v["nan"] for v in a["businesses"].values())
    nan_b = sum(v["nan"] for v in b["businesses"].values())
    # 관점별 미산출(score None)은 업종·관점 단위로 본다 — 총수가 같아도 새로 미산출된 (업종, 관점)이 있으면 실패 (Codex 검수 2026-10-19).
    # A 에서 이미 미산출이던 관점은 허용한다(기존부터 데이터가 없는 조합).
    pnone_a = _perspective_none(a)
    pnone_b = _perspective_none(b)
    newly_none = [list(x) for x in sorted(pnone_b - pnone_a)]      # JSON 친화(리스트) — 보고서·스냅샷에 그대로 들어간다
    if len(b["errors"]) > len(a["errors"]):
        problems.append(f"오류 업종 {len(a['errors'])} → {len(b['errors'])}: {sorted(b['errors'])}")
    if none_b > none_a:
        problems.append(f"종합 미산출 업종 {none_a} → {none_b}")
    if newly_none:
        problems.append("관점 미산출 증가 " + ", ".join(f"{code}/{k}" for code, k in newly_none))
    if nan_b > nan_a:
        problems.append(f"NaN 값 {nan_a} → {nan_b}")
    missing = sorted(set(a["businesses"]) - set(b["businesses"]))
    if missing:
        problems.append(f"B 에 없는 업종 {missing}")
    if a["engine"] != b["engine"] or a["radius_m"] != b["radius_m"]:
        problems.append(f"엔진/반경이 다르다: {a['engine']}@{a['radius_m']} vs {b['engine']}@{b['radius_m']}")
    for code in C.CODE_NAME:
        va, vb = a["businesses"].get(code), b["businesses"].get(code)
        if va is None or vb is None:
            continue
        d = lambda x, y: (None if x is None or y is None else round(y - x, 1))  # noqa: E731
        rows.append({"code": code, "업종": vb["업종"], "종합_A": va["종합"], "종합_B": vb["종합"], "종합_Δ": d(va["종합"], vb["종합"]),
                     "순위_A": ra[code], "순위_B": rb[code],
                     "관점_Δ": {k: d(va["관점"].get(k), vb["관점"].get(k)) for k in PERSPECTIVES},
                     "동종점포_A": (va["raw"].get("competition") or {}).get("동종점포수"),
                     "동종점포_B": (vb["raw"].get("competition") or {}).get("동종점포수"),
                     "병목_A": va["병목"], "병목_B": vb["병목"]})
    return {"a": a["version"], "b": b["version"], "engine": b["engine"], "radius_m": b["radius_m"],
            "verdict": "fail" if problems else "pass", "problems": problems,
            "counts": {"errors": [len(a["errors"]), len(b["errors"])], "none": [none_a, none_b],
                       "persp_none": [len(pnone_a), len(pnone_b)], "newly_none": newly_none, "nan": [nan_a, nan_b]},
            "rows": rows}


def render_md(rep: dict) -> str:
    out = [f"# 데이터 버전 차이 보고서 — {rep['a']} → {rep['b']}", "",
           f"- 엔진 {rep['engine']}, 분석 반경 {rep['radius_m']}m, 지점 부평역(BUPYEONG_STATION, golden 과 같은 지점)",
           f"- 판정: **{rep['verdict'].upper()}**" + (" — " + "; ".join(rep["problems"]) if rep["problems"] else " (오류·종합/관점 미산출·NaN 증가 없음)"),
           f"- 오류 업종 {rep['counts']['errors'][0]} → {rep['counts']['errors'][1]}, 종합 미산출 {rep['counts']['none'][0]} → {rep['counts']['none'][1]}, "
           f"관점 미산출 {rep['counts']['persp_none'][0]} → {rep['counts']['persp_none'][1]}"
           + (" (새로 미산출: " + ", ".join(f"{c}/{k}" for c, k in rep["counts"]["newly_none"]) + ")" if rep["counts"]["newly_none"] else "")
           + f", NaN {rep['counts']['nan'][0]} → {rep['counts']['nan'][1]}", "",
           "| 업종 | 종합 A | 종합 B | Δ | 순위 A→B | 시장성 Δ | 고객성 Δ | 경쟁성 Δ | 입지성 Δ | 안정성 Δ | 동종점포 A→B | 병목 A→B |",
           "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    fmt = lambda x: "-" if x is None else (f"{x:+.1f}" if isinstance(x, (int, float)) and not isinstance(x, bool) else str(x))  # noqa: E731
    for r in sorted(rep["rows"], key=lambda r: r["순위_B"]):
        p = r["관점_Δ"]
        out.append(f"| {r['업종']} | {r['종합_A']} | {r['종합_B']} | {fmt(r['종합_Δ'])} | {r['순위_A']}→{r['순위_B']} | "
                   f"{fmt(p['market'])} | {fmt(p['customer'])} | {fmt(p['competition'])} | {fmt(p['location'])} | {fmt(p['stability'])} | "
                   f"{r['동종점포_A']}→{r['동종점포_B']} | {r['병목_A']}→{r['병목_B']} |")
    return "\n".join(out) + "\n"


def write_snapshot(b_dir: str, snap: dict) -> str:
    path = os.path.join(b_dir, SNAPSHOT_REL)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    import json
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(snap, f, ensure_ascii=False, indent=1)
        f.write("\n")
    m = CM.read_manifest(b_dir)
    if m is not None:
        m["snapshot"] = {"path": SNAPSHOT_REL.replace(os.sep, "/"), "sha256": CM.sha256_file(path), "engine": snap["engine"],
                         "radius_m": snap["radius_m"], "created": snap["created"]}
        CM.save_manifest(b_dir, m)
    return path


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("a")
    ap.add_argument("b")
    ap.add_argument("--out", default=None, help="보고서 markdown 경로 (없으면 콘솔)")
    ap.add_argument("--snapshot", action="store_true", help="B 스냅샷을 <B>/snapshot/ 에 쓰고 manifest.snapshot 기록")
    ap.add_argument("--radius", type=int, default=C.RADIUS_M)
    a = ap.parse_args(argv)
    if a.radius not in RADIUS_OPTIONS_M:
        print(f"엔진 {ENGINE_VERSION} 이 받는 반경이 아니다: {a.radius} (가능 {RADIUS_OPTIONS_M})", file=sys.stderr)
        return 2
    da, db = CM.version_dir(a.a), CM.version_dir(a.b)
    snap_a = compute(da, a.radius)
    snap_b = compute(db, a.radius)
    rep = compare(snap_a, snap_b)
    md = render_md(rep)
    if a.out:
        with open(a.out, "w", encoding="utf-8", newline="\n") as f:
            f.write(md)
        print(f"[out] {a.out}")
    else:
        print(md)
    if a.snapshot:
        print(f"[snapshot] {write_snapshot(db, snap_b)}")
    print(f"diff {rep['a']} → {rep['b']}: {rep['verdict'].upper()}")
    return 0 if rep["verdict"] == "pass" else 1


if __name__ == "__main__":
    sys.exit(main())
