"""
8-D2b 실제 서버 측정 — uvicorn 프로세스를 띄워 시작 직후 warm 중 hit·cold 응답과 warm 완료 시간을 HTTP 로 잰다.
TestClient(in-process) 측정과 다르다: 별도 프로세스, 실제 소켓, 측정 클라이언트는 다른 프로세스(이 스크립트).
check 에 넣지 않는 느린 실측. 조건·결과: docs/spikes/8-D2b/README.md

  python scripts/bench_uvicorn.py --label working --engine v0_4 --out docs/spikes/8-D2b/results/uvicorn_working_1.json
  python scripts/bench_uvicorn.py --label base --server-root <93b7031 worktree> --engine v0_4 --out ...

- 서버: `python -m uvicorn backend.app.main:app --port P` (cwd = --server-root, env SCORING_ENGINE_VERSION, 프런트 서빙 없음).
  시각 0 = 서버 프로세스 시작.
- /health 를 0.5초마다 기록(warm 진행·완료 시각). 서비스 준비(/health 200) 시각.
- 요청 부하(구현과 무관하게 같은 일정): warm 첫 키(첫 업종·500m)가 끝난 시각 S 부터 --duration 초 동안 --interval 초마다
  정해진 시각에 hit 요청(POST /analyze 부평역·첫 업종·500m)을 스레드로 보낸다(앞 요청을 기다리지 않음).
  S + --cold-at 초에 cold 요청(마지막 업종들·1,000m — warm 이 가장 늦게 하는 키)을 보낸다.
- warm 완료 뒤 경합 없는 hit 30회(순차).
지연 "상한"은 이 측정값으로 주장하지 않는다 — 한 기계·한 실행의 분포다.

실행 유효성(2026-10-18 보완): 아래 중 하나라도 있으면 valid=false 와 사유(invalid_reasons)를 결과에 남기고 종료 코드 1.
  서버가 기한 안에 준비되지 않음·첫 키/전체 warm 기한 초과·대기 중 서버 프로세스 종료·warm failed(/health)·
  /health 엔진 광고가 요청한 엔진과 다름·측정 요청(hit·cold·warm 뒤 30회)의 HTTP 오류·연결 오류.
  지연 통계(hit·cold·idle)는 200 응답만으로 내고, 오류 요청은 errors 에 따로 둔다.
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import statistics
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

BUPYEONG = {"lat": 37.4894, "lng": 126.7246}
APP = "backend.app.main:app"
READY_TIMEOUT_S = 120.0          # 서버 시작 → /health 200
FIRST_KEY_TIMEOUT_S = 600.0      # 준비 → warm 첫 키 완료
WARM_TIMEOUT_S = 1800.0          # 서버 시작 → warm 완료
ENGINE_VERSIONS = {"v0_3": "mvp-0.3", "v0_4": "mvp-0.4"}


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
    return {"n": len(ms), "median_ms": round(statistics.median(ms), 1), "p95_ms": round(pct(ms, 0.95), 1),
            "max_ms": round(max(ms), 1), "min_ms": round(min(ms), 1)}


def http(method, url, body=None, timeout=300):
    """(상태 코드 | None, JSON | None, 오류 문자열 | None)"""
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode("utf-8")), None
    except urllib.error.HTTPError as e:
        return e.code, None, f"HTTP {e.code}"
    except Exception as e:                                # noqa: BLE001 — 연결·시간 초과·응답 형식 오류를 기록한다
        return None, None, f"{type(e).__name__}: {e}"


class Invalid(RuntimeError):
    """측정을 계속할 수 없다 — 사유를 결과에 남긴다"""


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", required=True)
    ap.add_argument("--server-root", default=ROOT)
    ap.add_argument("--engine", default="v0_4")
    ap.add_argument("--port", type=int, default=8011)
    ap.add_argument("--duration", type=float, default=60.0)
    ap.add_argument("--interval", type=float, default=0.25)
    ap.add_argument("--cold-at", default="10,25,40")
    ap.add_argument("--out")
    args = ap.parse_args()

    from scoring_engine import config as C
    bizs = list(C.CODE_NAME)
    hit_biz = bizs[0]
    cold_bizs = bizs[::-1][: len(args.cold_at.split(","))]
    base = f"http://127.0.0.1:{args.port}"
    env = dict(os.environ, SCORING_ENGINE_VERSION=args.engine, PYTHONDONTWRITEBYTECODE="1", PYTHONIOENCODING="utf-8")
    env.pop("FRONTEND_DIST", None)
    log_path = (args.out or "uvicorn") + ".server.log"
    t0 = time.perf_counter()
    now = lambda: round(time.perf_counter() - t0, 4)          # noqa: E731
    with open(log_path, "w", encoding="utf-8") as log:
        proc = subprocess.Popen([sys.executable, "-m", "uvicorn", APP, "--port", str(args.port),
                                 "--log-level", "warning"], cwd=args.server_root, env=env, stdout=log, stderr=log)
    health: list[dict] = []
    probes: list[dict] = []
    idle: list[dict] = []
    reasons: list[str] = []
    lock = threading.Lock()
    stop = threading.Event()
    ready = S = warm_done = None
    advertised = None

    def server_alive():
        if proc.poll() is not None:
            raise Invalid(f"server_exited: 대기 중 서버 프로세스가 종료됐다(exit {proc.returncode})")

    def wait_until(cond, deadline_s, what):
        """cond(마지막 /health) 가 참이 될 때까지. 서버 종료·warm failed·기한 초과는 Invalid"""
        while True:
            server_alive()
            with lock:
                last = health[-1] if health else None
            if last and last.get("failed"):
                raise Invalid(f"warm_failed: /health warm.failed (error={last.get('error')!r})")
            if cond(last):
                return
            if now() > deadline_s:
                raise Invalid(f"timeout_{what}: 서버 시작 뒤 {deadline_s:.0f}s 안에 끝나지 않았다")
            time.sleep(0.05)

    try:
        while ready is None:
            server_alive()
            st, body, _ = http("GET", base + "/health", timeout=5)
            if st == 200 and body:
                ready = now()
                advertised = body.get("engine")
                health.append({"t": ready, **body["warm"]})
            elif now() > READY_TIMEOUT_S:
                raise Invalid(f"timeout_ready: {READY_TIMEOUT_S:.0f}s 안에 /health 200 이 아니다")
            else:
                time.sleep(0.1)
        want = ENGINE_VERSIONS.get(args.engine)
        if not advertised or advertised.get("version") != want:
            raise Invalid(f"engine_mismatch: 요청 {args.engine}({want}) / 광고 {advertised}")

        def poll_health():
            while not stop.is_set():
                st, body, err = http("GET", base + "/health", timeout=30)
                with lock:
                    health.append({"t": now(), **body["warm"]} if st == 200 and body else {"t": now(), "error": err or st})
                stop.wait(0.5)
        threading.Thread(target=poll_health, daemon=True).start()

        wait_until(lambda last: last and last.get("completed", 0) >= 1, ready + FIRST_KEY_TIMEOUT_S, "first_key")
        S = time.perf_counter() - t0

        def probe(kind, scheduled, body):
            d = scheduled - (time.perf_counter() - t0)
            if d > 0:
                time.sleep(d)
            s = now()
            st, _, err = http("POST", base + "/analyze", body)
            e = now()
            with lock:
                probes.append({"kind": kind, "scheduled": round(scheduled, 4), "start": s, "end": e, "status": st,
                               "error": err, "biz": body["biz_code"], "radius_m": body["radius_m"]})

        threads = []
        i = 0
        while i * args.interval <= args.duration:
            th = threading.Thread(target=probe, args=("hit", S + i * args.interval,
                                                       {**BUPYEONG, "biz_code": hit_biz, "radius_m": 500}), daemon=True)
            th.start()
            threads.append(th)
            i += 1
        for j, off in enumerate(float(x) for x in args.cold_at.split(",")):
            th = threading.Thread(target=probe, args=("cold", S + off, {**BUPYEONG, "biz_code": cold_bizs[j], "radius_m": 1000}),
                                  daemon=True)
            th.start()
            threads.append(th)
        for th in threads:
            th.join(600)
            if th.is_alive():
                raise Invalid("timeout_probe: 측정 요청이 600s 안에 끝나지 않았다")
        wait_until(lambda last: last and last.get("done"), WARM_TIMEOUT_S, "warm")
        with lock:
            warm_done = next(h["t"] for h in health if h.get("done"))
        for _ in range(30):
            s = time.perf_counter()
            st, _, err = http("POST", base + "/analyze", {**BUPYEONG, "biz_code": hit_biz, "radius_m": 500})
            idle.append({"s": round(time.perf_counter() - s, 4), "status": st, "error": err})
    except Invalid as e:
        reasons.append(str(e))
    finally:
        stop.set()
        proc.terminate()
        try:
            proc.wait(20)
        except subprocess.TimeoutExpired:
            proc.kill()

    bad = [p for p in probes if p["status"] != 200] + [dict(x, kind="idle") for x in idle if x["status"] != 200]
    if bad:
        reasons.append(f"http_errors: 측정 요청 {len(bad)}건이 200 이 아니다")
    hits = [p for p in probes if p["kind"] == "hit" and p["status"] == 200]
    out = {
        "label": args.label, "engine_env": args.engine, "server_root_is_repo": os.path.abspath(args.server_root) == ROOT,
        "valid": not reasons, "invalid_reasons": reasons,
        "conditions": {"python": platform.python_version(), "platform": platform.platform(), "cpu_count": os.cpu_count(),
                       "server": f"python -m uvicorn {APP} (1 worker, 프런트 서빙 없음)",
                       "client": "urllib (별도 프로세스), 요청마다 새 연결", "duration_s": args.duration,
                       "interval_s": args.interval, "cold_at_s_from_first_warm_key": args.cold_at,
                       "hit_key": [hit_biz, 500], "cold_keys": [[b, 1000] for b in cold_bizs],
                       "time_origin": "서버 프로세스 시작",
                       "timeouts_s": {"ready": READY_TIMEOUT_S, "first_key_after_ready": FIRST_KEY_TIMEOUT_S,
                                      "warm": WARM_TIMEOUT_S}},
        "engine_advertised": advertised,
        "service_ready_s": ready, "first_warm_key_done_s": None if S is None else round(S, 3), "warm_done_s": warm_done,
        "warm_final": health[-1] if health else None,
        "hit": summary([p["end"] - p["start"] for p in hits]),
        "cold": [{"key": [p["biz"], p["radius_m"]], "scheduled": p["scheduled"], "start": p["start"],
                  "s": round(p["end"] - p["start"], 3), "status": p["status"], "error": p["error"]}
                 for p in probes if p["kind"] == "cold"],
        "hit_idle_after_warm": summary([x["s"] for x in idle if x["status"] == 200]),
        "errors": bad,
        "raw": {"probes": sorted(probes, key=lambda p: p["scheduled"]), "idle": idle, "health": health},
    }
    if args.out:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        with open(args.out, "w", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    print(json.dumps({k: v for k, v in out.items() if k != "raw"}, ensure_ascii=False, indent=1))
    if reasons:
        print("측정 무효: " + " / ".join(reasons), file=sys.stderr)
    return 0 if not reasons else 1


if __name__ == "__main__":
    sys.exit(main())
