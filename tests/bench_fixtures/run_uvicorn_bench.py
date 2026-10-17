"""
bench_uvicorn.py 를 가짜 서버(fake_app.py)로 돌린다 (tests/test_bench_scripts.py).
  python run_uvicorn_bench.py <bench_uvicorn.py 경로> <결과 json> <port>
서버 실행 명령의 앱만 fake_app:app 으로 바꾸고, 기한(모듈 상수가 있으면)을 짧게 한다. 스크립트 파일은 바꾸지 않는다.
"""
import importlib.util
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
script, out, port = sys.argv[1], sys.argv[2], sys.argv[3]
sys.path.insert(0, ROOT)
spec = importlib.util.spec_from_file_location("bench_uvicorn_under_test", script)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

real_popen = subprocess.Popen


def fake_popen(cmd, cwd=None, **kw):
    cmd = ["fake_app:app" if c == "backend.app.main:app" else c for c in cmd]
    proc = real_popen(cmd, cwd=HERE, **kw)
    with open(out + ".pid", "w", encoding="utf-8") as f:   # 테스트가 시간 초과 때 서버를 정리하려고 남긴다
        f.write(str(proc.pid))
    return proc


m.subprocess.Popen = fake_popen
for name, value in (("READY_TIMEOUT_S", 10.0), ("FIRST_KEY_TIMEOUT_S", 3.0), ("WARM_TIMEOUT_S", 20.0)):
    setattr(m, name, value)
sys.argv = ["bench_uvicorn", "--label", "test", "--engine", "v0_4", "--port", port, "--duration", "1",
            "--interval", "0.25", "--cold-at", "0.5", "--out", out]
sys.exit(m.main())
