"""
8-D2b warm 분해 측정 — 전체 cold warm 을 build(캐시 키) 단위로 나눠, 두 ReferenceCache 구현을 같은 조건에서 순서를 교차해
반복 비교한다. check 에 넣지 않는 느린 실측. 조건·결과: docs/spikes/8-D2b/README.md

  SCORING_ENGINE_VERSION=v0_4 python scripts/bench_warm_builds.py --a 93b7031 --b working --pairs 2 \
      --out docs/spikes/8-D2b/results/warm_builds_v0_4.json

- 요청 없음. 한 프로세스·같은 RuntimeData. 측정마다 새 캐시. 실행 순서는 쌍마다 교차(a b, b a, …).
- warm 은 --mode thread(기본, 앱과 같이 background thread 에서 cache.warm()) 또는 main.
- 키마다 기록: 종류(competition/location)·키·캐시 메서드 구간(벽시계·스레드 CPU)·실제 계산 구간(build_reference 또는
  site_profile 158회 합)·그 둘의 차이(잠금·캐시 처리 오버헤드)·동시에 진행 중이던 build 수.
- 엔진 함수는 감싸서 시간만 잰다(결과는 그대로 돌려준다). 차이를 원인과 연결하지 않는다 — 분포만 기록한다.
- 실패 처리(2026-10-18 보완): background warm 의 예외는 호출 측으로 다시 던지고, warm 뒤 캐시가 기대한 만큼 찼는지
  (competition = 업종 수 × 엔진 반경 수, location = 업종들의 유인시설 집합 수, 실제 build 수도 같음) 확인한다.
  하나라도 실패하면 결과 파일을 쓰지 않고 종료 코드 1 로 끝난다(부분 결과를 정상 결과로 남기지 않는다).
"""
from __future__ import annotations

import argparse
import gc
import json
import os
import platform
import statistics
import sys
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "scripts"))


class MeasurementError(RuntimeError):
    """측정을 믿을 수 없다(warm 예외·캐시 미완성) — 결과를 저장하지 않는다"""


def run_warm(warm, mode: str) -> None:
    """cache.warm 을 실행한다. thread 모드에서도 예외를 호출 측으로 다시 던진다(스레드 안에서 삼키지 않는다)."""
    if mode == "main":
        warm()
        return
    err: list[BaseException] = []

    def target():
        try:
            warm()
        except BaseException as e:                       # noqa: BLE001 — 호출 측에서 다시 던진다
            err.append(e)
    th = threading.Thread(target=target, name="reference-warm")
    th.start()
    th.join()
    if err:
        raise MeasurementError(f"background warm 실패: {type(err[0]).__name__}: {err[0]}") from err[0]


def check_complete(stats: dict, expected: dict, built: dict) -> None:
    """warm 뒤 캐시 항목 수와 실제 build 수가 기대와 같은지"""
    if stats != expected:
        raise MeasurementError(f"warm 뒤 캐시가 기대와 다르다: {stats} != {expected}")
    if built != expected:
        raise MeasurementError(f"warm 중 실제 build 수가 기대와 다르다: {built} != {expected}")


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--a", required=True)
    ap.add_argument("--b", required=True)
    ap.add_argument("--pairs", type=int, default=2)
    ap.add_argument("--mode", choices=["thread", "main"], default="thread")
    ap.add_argument("--limit", type=int, default=0, help="앞 N개 업종만 warm(점검용, 0 = 29개 전체)")
    ap.add_argument("--out")
    args = ap.parse_args()

    import scoring_engine
    from scoring_engine import config as C, etl_location, radius_demand
    from scoring_engine.runtime import load_runtime
    from ref_impl import load_cache_class

    impls = {"a": load_cache_class(args.a), "b": load_cache_class(args.b)}
    lock = threading.Lock()
    state = {"active": 0, "t0": 0.0, "records": None, "site_ns": 0}
    real_build, real_site = radius_demand.build_reference, etl_location.site_profile
    now = lambda: time.perf_counter() - state["t0"]          # noqa: E731

    def traced_build(shops, pop, biz, radius_m, *a, **k):
        with lock:
            state["active"] += 1
            conc = state["active"]
        s, cs = now(), time.thread_time()
        try:
            return real_build(shops, pop, biz, radius_m, *a, **k)
        finally:
            e, ce = now(), time.thread_time()
            with lock:
                state["active"] -= 1
                state["records"].append({"kind": "build_reference", "key": [biz, radius_m], "start": round(s, 4),
                                         "end": round(e, 4), "cpu_s": round(ce - cs, 4), "concurrent": conc})

    def traced_site(*a, **k):
        s = time.perf_counter_ns()
        try:
            return real_site(*a, **k)
        finally:
            state["site_ns"] += time.perf_counter_ns() - s

    radius_demand.build_reference = traced_build
    etl_location.site_profile = traced_site

    t = time.perf_counter()
    rt = load_runtime()
    load_s = time.perf_counter() - t

    def one_run(Cache) -> dict:
        gc.collect()
        cache = Cache(rt)
        records: list[dict] = []
        state["records"] = records
        orig_comp, orig_loc = cache.competition, cache.location

        def comp(biz, radius_m=None):
            s, cs = now(), time.thread_time()
            n = len(records)
            out = orig_comp(biz, radius_m)
            e, ce = now(), time.thread_time()
            inner = next((r for r in records[n:] if r["kind"] == "build_reference"), None)
            records.append({"kind": "competition", "key": [biz, radius_m], "start": round(s, 4), "end": round(e, 4),
                            "cpu_s": round(ce - cs, 4),
                            "build_s": None if inner is None else round(inner["end"] - inner["start"], 4),
                            "overhead_s": None if inner is None else round((e - s) - (inner["end"] - inner["start"]), 4)})
            return out

        def loc(biz):
            s, cs = now(), time.thread_time()
            site0 = state["site_ns"]
            out = orig_loc(biz)
            e, ce = now(), time.thread_time()
            site_s = (state["site_ns"] - site0) / 1e9
            records.append({"kind": "location", "key": [biz, list(Cache.anchor_key(biz))], "start": round(s, 4),
                            "end": round(e, 4), "cpu_s": round(ce - cs, 4),
                            "build_s": round(site_s, 4) if site_s > 0 else None,
                            "overhead_s": round((e - s) - site_s, 4) if site_s > 0 else None})
            return out
        cache.competition, cache.location = comp, loc

        state["t0"] = time.perf_counter()
        cpu0 = time.process_time()
        run_warm(lambda: cache.warm(bizs), args.mode)
        total = now()
        proc_cpu = time.process_time() - cpu0
        comp_recs = [r for r in records if r["kind"] == "competition" and r["build_s"] is not None]
        loc_recs = [r for r in records if r["kind"] == "location" and r["build_s"] is not None]
        b_recs = [r for r in records if r["kind"] == "build_reference"]
        check_complete(cache.stats(), expected,
                       {"competition_entries": len(comp_recs), "location_entries": len(loc_recs)})
        return {
            "total_s": round(total, 2), "process_cpu_s": round(proc_cpu, 2), "stats": cache.stats(),
            "competition_builds": len(comp_recs), "location_builds": len(loc_recs),
            "sum_build_reference_s": round(sum(r["end"] - r["start"] for r in b_recs), 2),
            "sum_build_reference_cpu_s": round(sum(r["cpu_s"] for r in b_recs), 2),
            "sum_location_build_s": round(sum(r["build_s"] for r in loc_recs), 2),
            "sum_overhead_s": round(sum(r["overhead_s"] for r in comp_recs + loc_recs), 4),
            "max_concurrent_builds": max((r["concurrent"] for r in b_recs), default=0),
            "records": records,
        }

    bizs = list(C.CODE_NAME)[: args.limit] if args.limit else list(C.CODE_NAME)
    radii = tuple(scoring_engine.RADIUS_OPTIONS_M)
    runs = []
    try:
        for i in range(args.pairs):
            order = ("a", "b") if i % 2 == 0 else ("b", "a")
            for name in order:
                Cache = impls[name]
                expected = {"competition_entries": len(bizs) * len(radii),
                            "location_entries": len({Cache.anchor_key(b) for b in bizs})}
                r = one_run(Cache)
                r.update({"pair": i, "impl": name, "rev": args.a if name == "a" else args.b, "expected": expected})
                runs.append(r)
                print(f"pair {i} {name}({r['rev']}) total {r['total_s']}s  build_reference {r['sum_build_reference_s']}s "
                      f"(cpu {r['sum_build_reference_cpu_s']}s)  location {r['sum_location_build_s']}s  "
                      f"overhead {r['sum_overhead_s']}s  proc_cpu {r['process_cpu_s']}s", flush=True)
    except MeasurementError as e:
        print(f"측정 실패 — 결과를 저장하지 않는다: {e}", file=sys.stderr)
        return 1
    finally:
        radius_demand.build_reference, etl_location.site_profile = real_build, real_site

    def per_key(name):
        """키별 build_reference 시간 평균(그 구현의 모든 실행)"""
        acc: dict[str, list[float]] = {}
        for r in runs:
            if r["impl"] != name:
                continue
            for rec in r["records"]:
                if rec["kind"] == "build_reference":
                    acc.setdefault(f"{rec['key'][0]}@{rec['key'][1]}", []).append(rec["end"] - rec["start"])
        return {k: round(statistics.mean(v), 4) for k, v in acc.items()}
    ka, kb = per_key("a"), per_key("b")
    ratios = sorted(kb[k] / ka[k] for k in ka if k in kb and ka[k] > 0)
    out = {
        "engine": scoring_engine.ENGINE_VERSION, "radius_options": list(scoring_engine.RADIUS_OPTIONS_M),
        "a": args.a, "b": args.b, "mode": args.mode, "businesses": len(bizs), "load_runtime_s": round(load_s, 2),
        "conditions": {"python": platform.python_version(), "platform": platform.platform(), "cpu_count": os.cpu_count(),
                       "requests": "없음", "order": "쌍마다 교차 (a b, b a, …)", "same_process_runtime": True},
        "summary": [{k: r[k] for k in ("pair", "impl", "rev", "total_s", "process_cpu_s", "sum_build_reference_s",
                                       "sum_build_reference_cpu_s", "sum_location_build_s", "sum_overhead_s",
                                       "max_concurrent_builds", "competition_builds", "location_builds")} for r in runs],
        "per_key_build_ratio_b_over_a": {"n": len(ratios), "median": round(statistics.median(ratios), 4) if ratios else None,
                                         "min": round(ratios[0], 4) if ratios else None,
                                         "max": round(ratios[-1], 4) if ratios else None},
        "runs": runs,
    }
    text = json.dumps(out, ensure_ascii=False, indent=1)
    if args.out:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        with open(args.out, "w", encoding="utf-8", newline="\n") as f:
            f.write(text + "\n")
    print(json.dumps({k: v for k, v in out.items() if k != "runs"}, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
