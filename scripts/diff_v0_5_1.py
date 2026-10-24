"""
엔진 v0.5 → v0.5.1(분동 배분 결함 수정, D-029) 차이 보고 — 비교 분포와 점수.

  SCORING_ENGINE_VERSION=v0_5   python scripts/diff_v0_5_1.py dump  <out_v05.json>
  SCORING_ENGINE_VERSION=v0_5_1 python scripts/diff_v0_5_1.py dump  <out_v051.json>
  python scripts/diff_v0_5_1.py compare <out_v05.json> <out_v051.json> [--md <보고서.md>]

dump: 반경 300·500·1,000m × 29개 업종의 비교 분포(158개 중심점의 반경 거주·종사자·타겟·잠재수요)와,
      158개 중심점을 분석 지점으로 둔 웹 경로(ContextBuilder, rent=None) 점수(관점 5 + 종합). 엔진은 프로세스당 하나라 버전마다 따로 돈다.
      중심점 좌표의 면적 가중치는 RuntimeData.areas 가 재사용하므로 지점 분석도 빠르다.
compare: 두 dump 의 차이 요약(바뀐 중심점, 관점별 바뀐 수·최대 차이, 종합 차이 상위). 결과는 보고용이며 점수 기준이 아니다.
"""
from __future__ import annotations

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
RADII = (300, 500, 1000)
KEYS = ("market", "customer", "competition", "location", "stability")


def dump(out: str) -> None:
    import scoring_engine
    from scoring_engine import config as C
    from scoring_engine.location import ContextBuilder, LocationOutside, NoDataNearby
    from scoring_engine.reference import customer_cols
    from scoring_engine.service import AnalysisService
    svc = AnalysisService()
    cb = ContextBuilder(svc.rt)
    cent = svc.rt.centroids
    ctxs = {}
    for _, c in cent.iterrows():
        try:
            ctxs[f"{c['시군구명']} {c['행정동명']}"] = cb.build(float(c["위도"]), float(c["경도"]))
        except (LocationOutside, NoDataNearby) as e:              # 중심점이 경계 밖·점포 없음이면 기록만
            ctxs[f"{c['시군구명']} {c['행정동명']}"] = type(e).__name__
    data = {"engine": scoring_engine.ENGINE_VERSION, "ref": {}, "scores": {}}
    for r in RADII:
        for biz in C.CODE_NAME:
            ref, _ = svc.cache.competition(biz, r)
            cols = ["반경_" + c for c in customer_cols(biz)] + ["반경_수요"]
            data["ref"][f"{biz}@{r}"] = {f"{g} {d}": [None if v != v else float(v) for v in row]
                                        for g, d, *row in ref[["시군구명", "행정동명"] + cols].itertuples(index=False)}
            scores = {}
            for name, ctx in ctxs.items():
                if isinstance(ctx, str):
                    continue
                res = svc.analyze(ctx, biz, radius_m=r)
                scores[name] = [i["score"] for i in res["지표"]] + [res["종합"]["점수"]]
            data["scores"][f"{biz}@{r}"] = scores
            print(f"{biz}@{r}", flush=True)
    data["skipped"] = {k: v for k, v in ctxs.items() if isinstance(v, str)}
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


def _delta(a, b):
    if a is None or b is None:
        return None if a == b else float("inf")
    return b - a


def compare(path_a: str, path_b: str, md: str | None) -> dict:
    with open(path_a, encoding="utf-8") as f:
        a = json.load(f)
    with open(path_b, encoding="utf-8") as f:
        b = json.load(f)
    lines = [f"# {a['engine']} → {b['engine']} 차이 (scripts/diff_v0_5_1.py)", ""]
    summary = {"engines": [a["engine"], b["engine"]], "ref_changed": {}, "scores": {}}
    # 1) 비교 분포: 반경 인구가 바뀐 중심점 (업종과 무관 — 거주·종사자는 PC방 표로 대표)
    lines += ["## 1. 비교 분포(158개 중심점)에서 반경 인구가 바뀐 중심점", "",
              "| 반경 | 중심점 | 거주 v0.5 → v0.5.1 | 종사자 v0.5 → v0.5.1 | 잠재수요 v0.5 → v0.5.1 |", "|---|---|---|---|---|"]
    for r in RADII:
        ra, rb = a["ref"][f"R10406@{r}"], b["ref"][f"R10406@{r}"]
        changed = sorted(k for k in ra if any(abs((x or 0) - (y or 0)) > 1e-6 for x, y in zip(ra[k], rb[k])))
        summary["ref_changed"][r] = changed
        for k in changed:
            (t0, p0, w0, d0), (t1, p1, w1, d1) = ra[k], rb[k]
            lines.append(f"| {r}m | {k} | {p0:,.0f} → {p1:,.0f} | {w0:,.0f} → {w1:,.0f} | {d0:,.0f} → {d1:,.0f} |")
    # 2) 점수: 158개 중심점 × 29개 업종 (웹 경로)
    lines += ["", "## 2. 158개 중심점을 분석 지점으로 둔 점수(웹 경로, 29개 업종)", "",
              "| 반경 | 분석 수 | 하나라도 바뀐 결과 | 관점별 바뀐 수 (최대 절대 차이) | 종합 바뀐 수 · 최대 절대 차이 · 평균 절대 차이(바뀐 것) |",
              "|---|---|---|---|---|"]
    top = []
    for r in RADII:
        n = changed_any = 0
        per = {k: [0, 0.0] for k in KEYS}
        tot = []
        for biz in a["scores"]:
            if not biz.endswith(f"@{r}"):
                continue
            for site, sa in a["scores"][biz].items():
                sb = b["scores"][biz][site]
                n += 1
                ds = [_delta(x, y) for x, y in zip(sa, sb)]
                if any(d not in (None, 0) and abs(d) > 1e-9 for d in ds):
                    changed_any += 1
                for k, d in zip(KEYS, ds[:5]):
                    if d not in (None, 0) and abs(d) > 1e-9:
                        per[k][0] += 1
                        per[k][1] = max(per[k][1], abs(d))
                d = ds[5]
                if d not in (None, 0) and abs(d) > 1e-9:
                    tot.append(abs(d))
                    top.append((abs(d), r, site, biz.split("@")[0], sa[5], sb[5]))
        per_txt = " · ".join(f"{k} {c}({m:.1f})" for k, (c, m) in per.items() if c)
        mean = sum(tot) / len(tot) if tot else 0.0
        lines.append(f"| {r}m | {n:,} | {changed_any:,} | {per_txt or '없음'} | {len(tot):,} · {max(tot, default=0):.1f} · {mean:.2f} |")
        summary["scores"][r] = {"n": n, "changed_any": changed_any, "per": per, "total_changed": len(tot),
                                "total_max": max(tot, default=0.0), "total_mean": mean}
    top.sort(reverse=True)
    lines += ["", "## 3. 종합 점수 차이 상위 15", "", "| 반경 | 분석 지점(중심점) | 업종 | v0.5 → v0.5.1 |", "|---|---|---|---|"]
    from scoring_engine import config as C
    for d, r, site, biz, x, y in top[:15]:
        lines.append(f"| {r}m | {site} | {C.CODE_NAME.get(biz, biz)} | {x} → {y} |")
    summary["top"] = top[:15]
    if a.get("skipped"):
        lines += ["", f"분석에서 뺀 중심점(경계 밖·점포 없음): {a['skipped']}"]
    text = "\n".join(lines) + "\n"
    if md:
        with open(md, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
    print(text)
    return summary


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if len(sys.argv) == 3 and sys.argv[1] == "dump":
        dump(sys.argv[2])
    elif len(sys.argv) >= 4 and sys.argv[1] == "compare":
        compare(sys.argv[2], sys.argv[3], sys.argv[sys.argv.index("--md") + 1] if "--md" in sys.argv else None)
    else:
        sys.exit(__doc__)
