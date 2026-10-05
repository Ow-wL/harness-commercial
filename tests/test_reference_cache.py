"""
ReferenceCache warm-up — 캐시 정확성(entry 수·재계산 없음)과 cold warm 성능 상한 (TASKS 2-1, docs/DECISIONS.md D-013).

  정확성  build_reference / site_profile 을 가짜(빠른) 함수로 바꿔 호출 횟수를 센다 — 29개 전체 warm 규칙을 ms 단위로 검사
  성능    실제 계산으로 업종 1개 cold warm 시간 상한. 29개 전체 cold warm(약 60s)은 check 에 넣지 않고
          scripts/bench_reference.py 로 측정한다 (상한과 근거는 D-013)
매번 새 ReferenceCache 를 만든다 (세션 공유 서비스의 캐시는 건드리지 않는다).
"""
import time

import pandas as pd
import pytest

from scoring_engine import config as C, etl_location, radius_demand
from scoring_engine.reference import ReferenceCache

ONE_BIZ_COLD_WARM_MAX_S = 15.0       # 측정 2.47~2.69s (D-013). 느린 PC·CI 를 위해 약 6배 여유
SECOND_WARM_MAX_S = 0.5              # 측정 0.0000s — 재계산하면 업종당 수 초가 걸린다
ALL_ANCHOR_KEYS = {ReferenceCache.anchor_key(b) for b in C.CODE_NAME}


@pytest.fixture(scope="module")
def rt(service):
    return service.rt


@pytest.fixture
def fake_engine(monkeypatch, rt):
    """비교 모집단 계산을 빠른 가짜로 바꾸고 호출을 기록한다 (엔진 파일은 바꾸지 않는다, 테스트 끝나면 복원)."""
    calls = {"build_reference": [], "site_profile": 0}
    ref = pd.DataFrame({"반경_동종비중": [0.0], "반경_동종점포": [0], "반경_점포당수요": [None]})
    total = pd.DataFrame({"시군구명": [], "행정동명": [], "전체점포수": []})

    def build_reference(shops, pop, biz, radius_m, *a, **k):
        calls["build_reference"].append(biz)
        return ref, total

    def site_profile(lat, lng, stations, anchors, biz):
        calls["site_profile"] += 1
        return {"역세권_강도": 0.0, "유인시설_근접도": 0.0, "최근접역_거리m": 0.0, "유인시설_종류별": {}}

    monkeypatch.setattr(radius_demand, "build_reference", build_reference)
    monkeypatch.setattr(etl_location, "site_profile", site_profile)
    return calls


# ── 정확성 ───────────────────────────────────────────────
def test_stats_before_warm(rt):
    assert ReferenceCache(rt).stats() == {"competition_entries": 0, "location_entries": 0}


def test_partial_warm_counts(rt, fake_engine):
    bizs = ["R10406", "I21201", "I21001"]
    c = ReferenceCache(rt)
    c.warm(bizs)
    keys = {ReferenceCache.anchor_key(b) for b in bizs}
    assert c.stats() == {"competition_entries": 3, "location_entries": len(keys)}
    assert sorted(fake_engine["build_reference"]) == sorted(bizs)
    assert fake_engine["site_profile"] == len(keys) * len(rt.centroids)        # anchor key 당 1회만


def test_full_warm_counts_and_anchor_sharing(rt, fake_engine):
    c = ReferenceCache(rt)
    c.warm()
    assert len(C.CODE_NAME) == 29 and len(ALL_ANCHOR_KEYS) == 14
    assert c.stats() == {"competition_entries": 29, "location_entries": 14}
    assert sorted(fake_engine["build_reference"]) == sorted(C.CODE_NAME)       # 업종마다 정확히 1회
    assert fake_engine["site_profile"] == 14 * len(rt.centroids)              # 같은 anchor key 업종끼리 공유


def test_second_warm_recomputes_nothing(rt, fake_engine):
    c = ReferenceCache(rt)
    c.warm()
    before = (len(fake_engine["build_reference"]), fake_engine["site_profile"])
    c.warm()
    for b in C.CODE_NAME:
        c.competition(b)
        c.location(b)
    assert (len(fake_engine["build_reference"]), fake_engine["site_profile"]) == before
    assert c.stats() == {"competition_entries": 29, "location_entries": 14}


# ── 성능 (실제 계산) ─────────────────────────────────────
def test_one_biz_cold_warm_within_limit(rt, monkeypatch):
    calls = []
    real = radius_demand.build_reference

    def spy(*a, **k):
        calls.append(a[2])
        return real(*a, **k)
    monkeypatch.setattr(radius_demand, "build_reference", spy)

    c = ReferenceCache(rt)
    t = time.perf_counter()
    c.warm(["R10406"])
    cold = time.perf_counter() - t
    assert c.stats() == {"competition_entries": 1, "location_entries": 1}
    assert cold <= ONE_BIZ_COLD_WARM_MAX_S, f"업종 1개 cold warm {cold:.2f}s > {ONE_BIZ_COLD_WARM_MAX_S}s (D-013)"

    t = time.perf_counter()
    c.warm(["R10406"])
    again = time.perf_counter() - t
    assert calls == ["R10406"], "두 번째 warm 에서 build_reference 가 다시 호출됐다"
    assert again <= SECOND_WARM_MAX_S, f"두 번째 warm {again:.3f}s"
