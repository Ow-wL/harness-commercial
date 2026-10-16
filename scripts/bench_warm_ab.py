"""
8-D2a warm 비용 A/B — 요청 없이, 같은 프로세스·같은 RuntimeData 에서 두 ReferenceCache 구현의 전체 cold warm 시간을 **순서를 교차해**
반복 측정한다 (A B, B A, A B, …). check 에 넣지 않는 느린 실측. 조건·결과: docs/spikes/8-D2a/README.md

  SCORING_ENGINE_VERSION=v0_3 python scripts/bench_warm_ab.py --a 93b7031 --b working --pairs 3 \
      --out docs/spikes/8-D2a/results/v2_warm_ab_v0_3.json

--a/--b  git 리비전 또는 working (scripts/ref_impl.py). 측정마다 새 캐시를 만든다. warm() 은 background 경로(양보 로직 포함)다.
차이를 원인과 연결하지 않는다 — 분포만 기록한다.
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import statistics
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "scripts"))


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--a", required=True)
    ap.add_argument("--b", required=True)
    ap.add_argument("--pairs", type=int, default=3)
    ap.add_argument("--out")
    args = ap.parse_args()

    import scoring_engine
    from scoring_engine.runtime import load_runtime
    from ref_impl import load_cache_class

    impls = {"a": load_cache_class(args.a), "b": load_cache_class(args.b)}
    t = time.perf_counter()
    rt = load_runtime()
    load_s = time.perf_counter() - t
    runs = []
    for i in range(args.pairs):
        order = ("a", "b") if i % 2 == 0 else ("b", "a")
        for name in order:
            cache = impls[name](rt)
            t = time.perf_counter()
            cache.warm()
            dt = time.perf_counter() - t
            runs.append({"pair": i, "impl": name, "rev": args.a if name == "a" else args.b, "s": round(dt, 2),
                         "stats": cache.stats()})
            print(f"pair {i} {name}({runs[-1]['rev']}) {dt:7.2f}s {cache.stats()}", flush=True)

    def stat(name):
        xs = [r["s"] for r in runs if r["impl"] == name]
        return {"n": len(xs), "mean_s": round(statistics.mean(xs), 2), "min_s": min(xs), "max_s": max(xs),
                "stdev_s": round(statistics.stdev(xs), 2) if len(xs) > 1 else None}
    pair_diff = []
    for i in range(args.pairs):
        a = next(r["s"] for r in runs if r["pair"] == i and r["impl"] == "a")
        b = next(r["s"] for r in runs if r["pair"] == i and r["impl"] == "b")
        pair_diff.append(round(b - a, 2))
    out = {"engine": scoring_engine.ENGINE_VERSION, "radius_options": list(scoring_engine.RADIUS_OPTIONS_M),
           "a": args.a, "b": args.b, "load_runtime_s": round(load_s, 2),
           "conditions": {"python": platform.python_version(), "platform": platform.platform(),
                          "cpu_count": os.cpu_count(), "requests": "없음", "order": "쌍마다 교차 (a b, b a, …)"},
           "a_stats": stat("a"), "b_stats": stat("b"), "pair_diff_b_minus_a_s": pair_diff, "runs": runs}
    text = json.dumps(out, ensure_ascii=False, indent=1)
    print(text)
    if args.out:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        with open(args.out, "w", encoding="utf-8", newline="\n") as f:
            f.write(text + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
