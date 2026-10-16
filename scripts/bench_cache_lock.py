"""
8-D2a 캐시 잠금 측정 (v2, 2026-10-17 Codex 검수 반영) — check 에 넣지 않는 느린 실측. 조건·결과: docs/spikes/8-D2a/README.md

  SCORING_ENGINE_VERSION=v0_4 python scripts/bench_cache_lock.py --impl working --out docs/spikes/8-D2a/results/v2_working_v0_4.json
  SCORING_ENGINE_VERSION=v0_4 python scripts/bench_cache_lock.py --impl 93b7031 --out docs/spikes/8-D2a/results/v2_base_v0_4.json

--impl  비교할 ReferenceCache: working(작업 트리) 또는 git 리비전(scripts/ref_impl.py — 작업 트리 파일을 바꾸지 않는다)

요청 부하 (변경 전·후 동일): 앱 시작(전체 background warm)부터 --duration 초 동안 --interval 초마다 **정해진 시각에** 측정 요청을
스레드로 하나씩 보낸다(앞 요청이 끝나기를 기다리지 않음 → 요청 수·도착 일정이 구현과 무관하게 같다). 짝수 번째는 cache 직접 조회
(ReferenceCache.competition, 미리 계산한 키 — 잠금 대기 + dict 조회), 홀수 번째는 API hit(POST /analyze 전체 응답, 같은 키).
정해진 시각(--cold-at)에 아직 warm 되지 않은 키의 API cold 요청을 보낸다.

각 요청 스레드는 자기 예정 시각까지 기다린 뒤 실행한다(2026-10-17 보완 — 그 전 v2 결과는 cold 요청이 예정보다 약 0.25초 일찍 시작됨).
원본 기록(raw): 요청마다 종류·예정 시각·시작·종료(앱 시작 기준 초), **그 요청의 시작 시점**의 build 진행 여부와 직전 build 시작 뒤
경과(since_start); build 마다 키·시작·종료. 요약은 "요청 구간 [시작, 종료]가 build 구간과 실제로 겹쳤는지"로 나눈다.
warm 전체 시간은 측정 구간 동안 요청 부하가 섞이므로 비용 비교에 쓰지 않는다 — 요청 없는 비교는 scripts/bench_warm_ab.py.
지연 "상한"은 이 측정값으로 주장하지 않는다 — 한 기계·한 실행의 분포다.
"""
from __future__ import annotations

import argparse
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

HIT_BIZ = "R10406"
BODY = {"lat": 37.4894, "lng": 126.7246, "biz_code": HIT_BIZ}


def pct(xs, q):
    xs = sorted(xs)
    if not xs:
        return None
    k = (len(xs) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def summary(xs_s):
    ms = [x * 1000 for x in xs_s]
    if not ms:
        return {"n": 0}
    return {"n": len(ms), "median_ms": round(statistics.median(ms), 3), "p95_ms": round(pct(ms, 0.95), 3),
            "max_ms": round(max(ms), 3), "min_ms": round(min(ms), 3)}


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--impl", default="working")
    ap.add_argument("--duration", type=float, default=60.0)
    ap.add_argument("--interval", type=float, default=0.25)
    ap.add_argument("--cold-at", default="10,25,40")
    ap.add_argument("--out")
    args = ap.parse_args()

    import scoring_engine
    from scoring_engine import config as C, radius_demand
    from scoring_engine.service import AnalysisService
    from scoring_engine.runtime import load_runtime
    from fastapi.testclient import TestClient
    from backend.app import main as M
    from ref_impl import load_cache_class

    Cache = load_cache_class(args.impl)
    clock = {"t0": time.perf_counter()}
    now = lambda: time.perf_counter() - clock["t0"]          # noqa: E731
    lock = threading.Lock()
    builds: list[dict] = []                                   # {key, start, end}
    active = {"n": 0, "last_start": None}
    real_build = radius_demand.build_reference

    def traced_build(shops, pop, biz, radius_m, *a, **k):
        with lock:
            rec = {"key": [biz, radius_m], "start": round(now(), 4), "end": None}
            builds.append(rec)
            active["n"] += 1
            active["last_start"] = rec["start"]
        try:
            return real_build(shops, pop, biz, radius_m, *a, **k)
        finally:
            with lock:
                rec["end"] = round(now(), 4)
                active["n"] -= 1
    radius_demand.build_reference = traced_build

    t = time.perf_counter()
    rt = load_runtime()
    load_s = time.perf_counter() - t
    svc = AnalysisService(rt=rt, cache=Cache(rt))
    svc.cache.competition(HIT_BIZ, C.RADIUS_M)                # 측정용 hit 키를 미리 계산
    svc.cache.location(HIT_BIZ)
    hit_radius = C.RADIUS_M
    tasks = M.warm_tasks(list(C.CODE_NAME))
    late = [(b, r) for b, r in tasks[::-1] if b != HIT_BIZ]
    cold_at = [float(x) for x in args.cold_at.split(",") if x]

    probes: list[dict] = []
    threads: list[threading.Thread] = []

    def state_at_start():
        with lock:
            return active["n"] > 0, (None if active["last_start"] is None else round(now() - active["last_start"], 4))

    def probe(kind, scheduled, client, body=None):
        delay = scheduled - now()                             # 예정 시각 전에는 실행하지 않는다(cold 는 일찍 띄운다)
        if delay > 0:
            time.sleep(delay)
        building, since = state_at_start()                    # 상태·시작 시각은 실제 실행 직전에 기록
        rec = {"kind": kind, "scheduled": round(scheduled, 4), "start": round(now(), 4),
               "build_active_at_start": building, "since_build_start_at_start": since}
        try:
            if kind == "cache":
                svc.cache.competition(HIT_BIZ, hit_radius)
                rec["status"] = "ok"
            else:
                rec["status"] = client.post("/analyze", json=body).status_code
        finally:
            rec["end"] = round(now(), 4)
            if body and body.get("biz_code") != HIT_BIZ:
                rec["key"] = [body["biz_code"], body.get("radius_m")]
            with lock:
                probes.append(rec)

    app = M.create_app(service=svc)
    with lock:                                                # 미리 계산한 hit 키의 build 는 측정 구간 밖 — 기록에서 뺀다
        builds.clear()
        active["last_start"] = None
        clock["t0"] = time.perf_counter()                     # 앱 시작(background warm 시작) 직전을 0 으로
    with TestClient(app) as client:
        i = 0
        cold_i = 0
        while True:
            scheduled = i * args.interval
            if scheduled > args.duration:
                break
            if cold_i < len(cold_at) and cold_at[cold_i] <= scheduled:
                biz, radius = late[cold_i]
                body = {**BODY, "biz_code": biz, **({"radius_m": radius} if radius is not None else {})}
                th = threading.Thread(target=probe, args=("api_cold", cold_at[cold_i], client, body), daemon=True)
                th.start()
                threads.append(th)
                cold_i += 1
            delay = scheduled - now()
            if delay > 0:
                time.sleep(delay)
            kind = "cache" if i % 2 == 0 else "api_hit"
            body = None if kind == "cache" else {**BODY, "radius_m": hit_radius}
            th = threading.Thread(target=probe, args=(kind, scheduled, client, body), daemon=True)
            th.start()
            threads.append(th)
            i += 1
        for th in threads:
            th.join(600)
        warm_done = None
        while True:
            s = client.get("/health").json()["warm"]
            if s["done"] or s["failed"]:
                warm_done = round(now(), 1)
                break
            time.sleep(0.5)
        idle = []
        for _ in range(30):
            t = time.perf_counter()
            assert client.post("/analyze", json={**BODY, "radius_m": hit_radius}).status_code == 200
            idle.append(time.perf_counter() - t)
    radius_demand.build_reference = real_build

    def overlaps(p):
        return any(b["start"] <= p["end"] and (b["end"] if b["end"] is not None else 1e18) >= p["start"] for b in builds)

    def dur(p):
        return p["end"] - p["start"]

    groups = {}
    for kind in ("cache", "api_hit"):
        ps = [p for p in probes if p["kind"] == kind]
        groups[kind] = {
            "all": summary([dur(p) for p in ps]),
            "overlapping_build": summary([dur(p) for p in ps if overlaps(p)]),
            "not_overlapping_build": summary([dur(p) for p in ps if not overlaps(p)]),
            "build_active_at_start": summary([dur(p) for p in ps if p["build_active_at_start"]]),
            "errors": [p for p in ps if p["status"] not in ("ok", 200)],
        }
    out = {
        "version": 2, "impl": args.impl, "engine": scoring_engine.ENGINE_VERSION,
        "radius_options": list(scoring_engine.RADIUS_OPTIONS_M),
        "conditions": {"python": platform.python_version(), "platform": platform.platform(),
                       "cpu_count": os.cpu_count(), "duration_s": args.duration, "interval_s": args.interval,
                       "cold_at_s": cold_at, "client": "fastapi.testclient (in-process, uvicorn 없음)",
                       "hit_key": [HIT_BIZ, hit_radius], "time_origin": "앱 시작(background warm 시작) 직전"},
        "load_runtime_s": round(load_s, 2),
        "summary": groups,
        "api_cold": [{"key": p.get("key"), "scheduled": p["scheduled"], "s": round(dur(p), 3), "status": p["status"],
                      "overlapping_build": overlaps(p)} for p in probes if p["kind"] == "api_cold"],
        "api_hit_idle_after_warm": summary(idle),
        "warm_done_s_with_load_in_first_window": warm_done,
        "raw": {"probes": sorted(probes, key=lambda p: (p["scheduled"], p["kind"])), "builds": builds},
    }
    text = json.dumps(out, ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in out.items() if k != "raw"}, ensure_ascii=False, indent=1))
    if args.out:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        with open(args.out, "w", encoding="utf-8", newline="\n") as f:
            f.write(text + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
