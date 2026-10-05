"""
ReferenceCache warm-up 벤치마크 — check 에 넣지 않는 느린 실측 (약 1~4분). 기준·근거는 docs/DECISIONS.md D-013.

  python scripts/bench_reference.py            전체 cold warm 2회
  python scripts/bench_reference.py --runs 3   반복 횟수 지정

측정마다 새 ReferenceCache 를 만들고, 같은 RuntimeData 를 쓴다 (I/O 시간 분리).
상한을 넘으면 exit 1. 엔진 계산·캐시 구현을 바꾼 뒤(2-2 디스크 캐시 판단 포함) 돌린다.
"""
from __future__ import annotations

import os
import statistics
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scoring_engine import config as C  # noqa: E402
from scoring_engine.reference import ReferenceCache  # noqa: E402
from scoring_engine.runtime import load_runtime  # noqa: E402

FULL_COLD_WARM_MAX_S = 180.0     # 측정 평균 60.75s (58.05~65.08s, 3회). 약 3배 여유 (D-013)
LOAD_RUNTIME_MAX_S = 15.0        # 측정 3.81~3.95s


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")
    runs = int(sys.argv[sys.argv.index("--runs") + 1]) if "--runs" in sys.argv else 2

    t = time.perf_counter()
    rt = load_runtime()
    load_s = time.perf_counter() - t
    print(f"load_runtime                 {load_s:7.2f}s")

    c = ReferenceCache(rt)
    t = time.perf_counter()
    c.warm(["R10406"])
    print(f"cold warm 1 biz (R10406)     {time.perf_counter() - t:7.2f}s  {c.stats()}")

    full = []
    for i in range(runs):
        c = ReferenceCache(rt)
        t = time.perf_counter()
        c.warm()
        full.append(time.perf_counter() - t)
        print(f"cold warm 29 biz #{i + 1}          {full[-1]:7.2f}s  {c.stats()}")
    t = time.perf_counter()
    c.warm()
    print(f"second warm (same cache)     {time.perf_counter() - t:7.4f}s  {c.stats()}")
    spread = f", stdev {statistics.stdev(full):.2f}s" if len(full) > 1 else ""
    print(f"full cold warm mean {statistics.mean(full):.2f}s (min {min(full):.2f}, max {max(full):.2f}{spread})")

    keys = {ReferenceCache.anchor_key(b) for b in C.CODE_NAME}
    ok = (max(full) <= FULL_COLD_WARM_MAX_S and load_s <= LOAD_RUNTIME_MAX_S
          and c.stats() == {"competition_entries": len(C.CODE_NAME), "location_entries": len(keys)})
    print("BENCH", "PASSED" if ok else "FAILED",
          f"(limits: full ≤ {FULL_COLD_WARM_MAX_S:.0f}s, load ≤ {LOAD_RUNTIME_MAX_S:.0f}s)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
