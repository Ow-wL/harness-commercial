"""
배포 대상 API smoke (TASKS 5-3 A, D-035). 배포 때마다 쓰던 기대값 생성·원격 대조 스크립트를 저장소의 정식 도구로 옮겼다.

  python scripts/smoke_api.py expected <out.json>
      같은 소스·같은 엔진(환경변수 SCORING_ENGINE_VERSION — 대상 리비전과 같게)으로 로컬에서 기대값을 계산한다.
      4개 지점 × 4개 업종 × 엔진이 받는 반경(v0.4 이상 300·500·1,000) = 48건(v0.3 은 16건)의 /analyze·/nearby-stores 응답
      (데이터는 로컬 기본 data/runtime).
  python scripts/smoke_api.py check <base_url> <expected.json> [--out result.json] [--wait-warm 600] [--engine mvp-0.5.1]
                                    [--no-data-header 1]   (헤더를 싣기 전 리비전 — v0.0.12 이전)
      대상 주소(무트래픽 태그 주소·운영 주소)에 요청해 검사한다. 하나라도 어긋나면 종료 코드 1.

검사: 정적 경로(/·/health·/businesses 200, /docs·/redoc·/openapi.json·없는 asset 404, GET /analyze 405), 번들의 JS·CSS
immutable 캐시와 GeoJSON 해시(data/geo 원본과 같음), /health engine·data·warm(--wait-warm 동안 완료를 기다림),
48건 전체 응답 일치(숫자 상대·절대 1e-9), 성공 응답 헤더 X-Data-Version == /health data.version(9-C4), 부평역 PC방 반경별
동종 점포 수 == 점포 목록 수, 학교 50m PC방 학교구역 경고 첫 줄(엔진 v0.5 계열), 지원하지 않는 반경 422 invalid_radius.
서비스 주소는 인자로만 받는다 — 저장소 문서에 쓰지 않는다(D-031 공개 범위).
"""
from __future__ import annotations

import gzip
import hashlib
import json
import math
import re
import sys
import time
from pathlib import Path
from typing import Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]

# 기대값 대상 — 배포 검증(2026-10-25~)에서 쓰던 것과 같다
SITES = {"부평역": (37.4894, 126.7246), "학교50m": (37.502726, 126.727619), "송도": (37.392512, 126.639034)}
CENTROID_SITE = ("아라1동중심", "아라1동")          # 분동(v0.5.1 D-029)이 걸리는 지점 — 중심점은 런타임 데이터에서
BIZ = ["R10406", "I21201", "G20405", "P10501"]
BUPYEONG = {"lat": 37.4894, "lng": 126.7246, "biz_code": "R10406"}
SCHOOL_50M = {"lat": 37.502274 + 50 / 110_540, "lng": 126.727619, "biz_code": "R10406"}
GEOJSON = ["인천_행정동경계_2026.geojson", "인천_시군구경계_2026.geojson"]
DATA_VERSION_HEADER = "x-data-version"

# fetch(path, body=None, headers=None) -> (status, headers(소문자 키), body bytes, 초)
Fetch = Callable[..., tuple]
GZIP_MAGIC = b"\x1f\x8b"


def ungzip(body: bytes) -> bytes:
    """gzip 본문이면 푼다(원격 urlopen 은 풀지 않는다). TestClient 처럼 이미 풀린 본문은 그대로."""
    return gzip.decompress(body) if body[:2] == GZIP_MAGIC else body


def same(a, b) -> bool:
    """두 JSON 값이 같은지 — 숫자는 상대·절대 1e-9 (Linux/Windows 부동소수 마지막 자리 차이, D-018)."""
    if isinstance(a, dict):
        return isinstance(b, dict) and set(a) == set(b) and all(same(a[k], b[k]) for k in a)
    if isinstance(a, list):
        return isinstance(b, list) and len(a) == len(b) and all(same(x, y) for x, y in zip(a, b))
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        return math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-9)
    return a == b


def http_fetch(base_url: str, timeout: float = 120) -> Fetch:
    base = base_url.rstrip("/")

    def fetch(path, body=None, headers=None):
        r = Request(base + path, data=None if body is None else json.dumps(body).encode(),
                    headers={"Content-Type": "application/json", **(headers or {})})
        t = time.perf_counter()
        try:
            with urlopen(r, timeout=timeout) as resp:
                return resp.status, {k.lower(): v for k, v in resp.headers.items()}, resp.read(), time.perf_counter() - t
        except HTTPError as e:
            return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read(), time.perf_counter() - t
    return fetch


def make_expected() -> dict:
    """로컬 같은 소스·같은 엔진으로 기대값 48건 (backend 를 TestClient 로 — 응답 형태가 원격과 같다)."""
    sys.path.insert(0, str(ROOT))
    from fastapi.testclient import TestClient
    from backend.app import main as M
    from scoring_engine.service import AnalysisService

    svc = AnalysisService()
    cent = svc.rt.centroids.set_index("행정동명")
    sites = dict(SITES)
    sites[CENTROID_SITE[0]] = (float(cent.loc[CENTROID_SITE[1], "위도"]), float(cent.loc[CENTROID_SITE[1], "경도"]))
    out = {"engine": None, "cases": []}
    with TestClient(M.create_app(service=svc, warm_biz=[])) as c:
        engine = c.get("/health").json()["engine"]
        out["engine"] = engine["version"]
        for name, (lat, lng) in sites.items():
            for biz in BIZ:
                for r in engine["radius_options"]:
                    body = {"lat": lat, "lng": lng, "biz_code": biz, "radius_m": r}
                    a, n = c.post("/analyze", json=body), c.post("/nearby-stores", json=body)
                    out["cases"].append({"site": name, "body": body, "status": [a.status_code, n.status_code],
                                         "analyze": a.json(), "nearby": n.json()})
    return out


def check_static(fetch: Fetch) -> list[str]:
    """정적 경로·캐시 헤더·GeoJSON 해시·gzip(12-1)·favicon/robots(12-5). 실패 설명 목록(비면 통과)."""
    fails = []
    html = ""
    for path, want in [("/", 200), ("/health", 200), ("/businesses", 200), ("/docs", 404), ("/redoc", 404),
                       ("/openapi.json", 404), ("/assets/missing-release.js", 404), ("/analyze", 405),
                       ("/favicon.svg", 200), ("/robots.txt", 200),
                       ("/places", 405)]:                       # 12-14: POST 전용(GET 405, 키 유무와 무관)
        s, _, d, _ = fetch(path)
        if s != want:
            fails.append(f"{path}: {s} (기대 {want})")
        if path == "/":
            html = d.decode("utf-8", errors="replace")
    want_geo = {hashlib.sha256((ROOT / "data" / "geo" / f).read_bytes()).hexdigest() for f in GEOJSON}
    got_geo = set()
    assets = re.findall(r'(?:src|href)="(/assets/[^" ]+)"', html)
    if not assets:
        fails.append("/ 의 index.html 에 /assets/ 참조가 없다")
    gz = {"Accept-Encoding": "gzip"}
    for asset in assets:
        s, h, d, _ = fetch(asset, None, gz)
        if s != 200 or "immutable" not in h.get("cache-control", ""):
            fails.append(f"{asset}: {s}, cache-control={h.get('cache-control')}")
        if s == 200 and h.get("content-encoding") != "gzip":                 # 12-1: JS·CSS 는 모두 1KB 를 넘는다
            fails.append(f"{asset}: gzip 아님(content-encoding={h.get('content-encoding')})")
        d = ungzip(d)
        if asset.endswith(".js"):
            for g in set(re.findall(r'/assets/[^"\s]+\.geojson', d.decode("utf-8", errors="replace"))):
                s2, h2, d2, _ = fetch(g, None, gz)
                if s2 == 200 and h2.get("content-encoding") != "gzip":
                    fails.append(f"{g}: gzip 아님(content-encoding={h2.get('content-encoding')})")
                got_geo.add(hashlib.sha256(ungzip(d2)).hexdigest() if s2 == 200 else f"status {s2}")
    if got_geo != want_geo:
        fails.append(f"GeoJSON 해시 불일치({len(got_geo)}개 받음, {len(want_geo)}개 기대)")
    return fails


def check_api(fetch: Fetch, expected: dict, engine: str | None = None, wait_warm: float = 0,
              sleep: Callable[[float], None] = time.sleep, data_header: bool = True) -> tuple[list[str], dict]:
    """API 계약·기대값 대조. (실패 설명 목록, 요약)."""
    fails: list[str] = []
    summary: dict = {}
    deadline = time.monotonic() + wait_warm
    while True:
        health = json.loads(fetch("/health")[2])
        warm = health.get("warm", {})
        if warm.get("done") or warm.get("failed") or time.monotonic() >= deadline:
            break
        sleep(5)
    summary["health"] = {"engine": health.get("engine"), "data": (health.get("data") or {}).get("version"), "warm": warm}
    want_engine = engine or expected.get("engine")
    if want_engine and (health.get("engine") or {}).get("version") != want_engine:
        fails.append(f"/health engine {(health.get('engine') or {}).get('version')} (기대 {want_engine})")
    if not warm.get("done") or warm.get("failed"):
        fails.append(f"warm 미완료 {warm.get('completed')}/{warm.get('total')} failed={warm.get('failed')}")
    data_version = (health.get("data") or {}).get("version")

    mismatch, latency, header_bad = [], [], 0
    for c in expected["cases"]:
        s1, h1, a, t = fetch("/analyze", c["body"])
        s2, h2, n, _ = fetch("/nearby-stores", c["body"])
        latency.append(round(t * 1000))
        if [s1, s2] != c["status"] or not same(json.loads(a), c["analyze"]) or not same(json.loads(n), c["nearby"]):
            mismatch.append([c["site"], c["body"]["biz_code"], c["body"]["radius_m"]])
        if data_header and s1 == 200 and data_version is not None and h1.get(DATA_VERSION_HEADER) != data_version:
            header_bad += 1
    summary["cases"] = {"n": len(expected["cases"]), "mismatch": mismatch,
                        "latency_ms": {"min": min(latency), "median": sorted(latency)[len(latency) // 2],
                                       "max": max(latency)} if latency else None}
    if mismatch:
        fails.append(f"기대값 불일치 {len(mismatch)}/{len(expected['cases'])}건: {mismatch[:5]}")
    if header_bad:
        fails.append(f"X-Data-Version 헤더가 /health data.version({data_version})과 다른 응답 {header_bad}건")

    pc = {}
    for r in (health.get("engine") or {}).get("radius_options") or [500]:   # 서버가 받는 반경 (v0.3 은 500 하나)
        a = json.loads(fetch("/analyze", {**BUPYEONG, "radius_m": r})[2])
        n = json.loads(fetch("/nearby-stores", {**BUPYEONG, "radius_m": r})[2])
        competition = next(i for i in a["result"]["지표"] if i["key"] == "competition")
        pc[r] = {"overall": a["result"]["종합"]["점수"], "same": competition["raw"]["동종점포수"], "nearby": n["count"]}
        if pc[r]["same"] != pc[r]["nearby"]:
            fails.append(f"부평역 PC방 {r}m: 동종 점포 {pc[r]['same']} ≠ 목록 {pc[r]['nearby']}")
    summary["bupyeong_pc"] = pc
    school = json.loads(fetch("/analyze", SCHOOL_50M)[2])
    first = (school["result"].get("경고") or [""])[0]
    summary["school_warning"] = first[:45]
    engine_version = (health.get("engine") or {}).get("version") or ""
    if engine_version.startswith("mvp-0.5") and "학교" not in first:   # 학교구역 첫 줄은 엔진 v0.5 계열 기능(D-028)
        fails.append(f"학교 50m PC방 첫 경고에 학교구역이 없다: {first[:45]!r}")
    s, _, d, _ = fetch("/analyze", {**BUPYEONG, "radius_m": 750})
    code = json.loads(d).get("error", {}).get("code") if s == 422 else None
    summary["invalid_radius"] = [s, code]
    if [s, code] != [422, "invalid_radius"]:
        fails.append(f"반경 750m: {s} {code} (기대 422 invalid_radius)")
    return fails, summary


def main(argv: list[str]) -> int:
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")
    if len(argv) >= 2 and argv[0] == "expected":
        data = make_expected()
        Path(argv[1]).write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        print(f"기대값 {len(data['cases'])}건 (엔진 {data['engine']}) → {argv[1]}")
        return 0
    if len(argv) >= 3 and argv[0] == "check":
        opts = {argv[i]: argv[i + 1] for i in range(3, len(argv) - 1, 2)}
        expected = json.loads(Path(argv[2]).read_text(encoding="utf-8"))
        fetch = http_fetch(argv[1])
        try:
            fails = check_static(fetch)
            api_fails, summary = check_api(fetch, expected, engine=opts.get("--engine"),
                                           wait_warm=float(opts.get("--wait-warm", 0)),
                                           data_header="--no-data-header" not in opts)
        except URLError as e:
            print(f"대상에 연결하지 못했다: {e}")
            return 1
        fails += api_fails
        summary["fails"] = fails
        if "--out" in opts:
            Path(opts["--out"]).write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
        print(json.dumps(summary, ensure_ascii=False, indent=1))
        print("SMOKE", "FAILED" if fails else "PASSED", f"({len(fails)}건)" if fails else "")
        return 1 if fails else 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
