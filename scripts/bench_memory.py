"""
8-D2b 메모리 측정 (Windows 전용) — RuntimeData 로드 뒤·전체 warm 뒤 이 프로세스의 working set 과 최대 working set.
psutil 없이 Windows psapi(GetProcessMemoryInfo)를 ctypes 로 부른다. Linux 컨테이너(Cloud Run)의 메모리와 같은 값이 아니다.

  SCORING_ENGINE_VERSION=v0_4 python scripts/bench_memory.py --out docs/spikes/8-D2b/results/memory_v0_4.json
"""
from __future__ import annotations

import argparse
import ctypes
import json
import os
import platform
import sys
import time
from ctypes import wintypes

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)


class PMC(ctypes.Structure):
    _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD),
                ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t)]


def mem_mib() -> dict:
    pmc = PMC()
    pmc.cb = ctypes.sizeof(PMC)
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.GetCurrentProcess.restype = wintypes.HANDLE                      # 64비트 핸들 — 타입을 지정하지 않으면 잘린다
    k32.K32GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(PMC), wintypes.DWORD]
    k32.K32GetProcessMemoryInfo.restype = wintypes.BOOL
    if not k32.K32GetProcessMemoryInfo(k32.GetCurrentProcess(), ctypes.byref(pmc), pmc.cb):
        raise OSError(ctypes.get_last_error(), "GetProcessMemoryInfo 실패")
    mib = 1024 * 1024
    return {"working_set_mib": round(pmc.WorkingSetSize / mib, 1), "peak_working_set_mib": round(pmc.PeakWorkingSetSize / mib, 1),
            "private_mib": round(pmc.PagefileUsage / mib, 1), "peak_private_mib": round(pmc.PeakPagefileUsage / mib, 1)}


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--out")
    args = ap.parse_args()
    if os.name != "nt":
        print("Windows 전용", file=sys.stderr)
        return 2
    start = mem_mib()
    import scoring_engine
    from scoring_engine.service import AnalysisService
    t = time.perf_counter()
    svc = AnalysisService()
    loaded = mem_mib()
    load_s = time.perf_counter() - t
    t = time.perf_counter()
    svc.cache.warm()
    warm_s = time.perf_counter() - t
    warmed = mem_mib()
    out = {"engine": scoring_engine.ENGINE_VERSION, "radius_options": list(scoring_engine.RADIUS_OPTIONS_M),
           "conditions": {"python": platform.python_version(), "platform": platform.platform(),
                          "measure": "Windows psapi GetProcessMemoryInfo (이 프로세스)", "requests": "없음"},
           "start": start, "after_load_runtime": loaded, "after_full_warm": warmed,
           "load_runtime_s": round(load_s, 2), "warm_s": round(warm_s, 1), "cache_stats": svc.cache.stats()}
    text = json.dumps(out, ensure_ascii=False, indent=1)
    if args.out:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        with open(args.out, "w", encoding="utf-8", newline="\n") as f:
            f.write(text + "\n")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
