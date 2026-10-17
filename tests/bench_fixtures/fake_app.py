"""
측정 스크립트 테스트용 가짜 서버 (tests/test_bench_scripts.py). 엔진을 부르지 않는다.
FAKE_BENCH_MODE: ok | warm_failed | stuck | http503 | engine_mismatch | exit

exit 모드(시간이 아니라 상태 전이로 고정): warm 은 첫 키만 끝난 상태(completed 1, done 아님)로 머문다. 측정 요청
(/analyze)을 EXIT_AFTER_ANALYZE 건(기본 6 = run_uvicorn_bench.py 의 hit 5 + cold 1) 모두 정상 처리한 뒤의 첫 /health 호출에서
프로세스를 끝낸다 → 측정기는 항상 "전체 warm 대기" 중에 서버 종료를 만난다.
"""
import os
import time

from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route

MODE = os.environ.get("FAKE_BENCH_MODE", "ok")
T0 = time.monotonic()
TOTAL = 4
EXIT_AFTER_ANALYZE = int(os.environ.get("FAKE_BENCH_EXIT_AFTER_ANALYZE", "6"))
analyze_count = 0


def warm_state():
    if MODE == "warm_failed":
        return {"completed": 0, "total": TOTAL, "done": False, "failed": True, "error": "G20405: RuntimeError"}
    if MODE == "stuck":
        return {"completed": 0, "total": TOTAL, "done": False, "failed": False, "error": None}
    if MODE == "exit":
        return {"completed": 1, "total": TOTAL, "done": False, "failed": False, "error": None}
    c = min(TOTAL, int((time.monotonic() - T0) / 0.3) + 1)
    return {"completed": c, "total": TOTAL, "done": c == TOTAL, "failed": False, "error": None}


async def health(request):
    if MODE == "exit" and analyze_count >= EXIT_AFTER_ANALYZE:
        os._exit(3)
    version = "mvp-0.3" if MODE == "engine_mismatch" else "mvp-0.4"
    return JSONResponse({"status": "ok", "service_ready": True,
                         "engine": {"version": version, "radius_options": [300, 500, 1000], "default_radius_m": 500},
                         "warm": warm_state()})


async def analyze(request):
    global analyze_count
    analyze_count += 1
    if MODE == "http503":
        return JSONResponse({"error": {"code": "internal_error", "message": "x"}}, status_code=503)
    return JSONResponse({"ok": True})


app = Starlette(routes=[Route("/health", health), Route("/analyze", analyze, methods=["POST"])])
