"""
8-D2a — ReferenceCache 잠금 (docs/UX_REDESIGN.md 4.7, D-024).

가짜(느린) build 를 Event 로 멈춰 두고 경합을 **보장**한 뒤 검사한다 (시간에 기대지 않는다 — 대기하면 join 시간 초과로 실패).
  (A) 이미 계산된 키(hit)는 다른 키의 build 가 진행 중이어도 잠금을 기다리지 않는다 — 경쟁성·입지 모두
  같은 키는 동시에 여러 스레드가 요청해도 한 번만 계산하고 모두 같은 객체를 받는다 (Barrier 로 동시 출발)
  계산이 실패하면 아무것도 저장하지 않고 잠금을 놓는다 (다음 요청이 다시 계산)
  (D) warm(background)은 요청(foreground)이 build 를 기다리는 동안 다음 build 를 시작하지 않는다
  miss 계산은 지금처럼 한 번에 하나 (공유 DataFrame 동시 계산 없음)
엔진 함수는 monkeypatch 로만 바꾸고(테스트 끝나면 복원), 엔진 파일·golden 은 건드리지 않는다.
"""
import threading
import types

import pandas as pd
import pytest

from scoring_engine import etl_location, radius_demand
from scoring_engine.reference import ReferenceCache

T = 5.0           # 대기 상한(초) — 정상이면 즉시 끝난다. 넘으면 잠금을 기다린 것
RADIUS = 500


def fake_rt():
    return types.SimpleNamespace(
        shops=pd.DataFrame(), stations=None, anchors=None,
        panel=pd.DataFrame(columns=["시군구명", "행정동명", "총인구"]),
        centroids=pd.DataFrame({"위도": [37.5], "경도": [126.7]}))


class SlowEngine:
    """build_reference / site_profile 대역. gate 에 등록된 업종은 started 를 알리고 release 까지 멈춘다."""

    def __init__(self):
        self.calls: list[tuple[str, str]] = []
        self.gates: dict[str, tuple[threading.Event, threading.Event]] = {}
        self.active = 0
        self.max_active = 0
        self.fail_once: set[str] = set()
        self._lock = threading.Lock()

    def gate(self, biz):
        started, release = threading.Event(), threading.Event()
        self.gates[biz] = (started, release)
        return started, release

    def _run(self, kind, biz):
        with self._lock:
            self.calls.append((kind, biz))
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        try:
            if kind == "competition" and biz in self.gates:
                started, release = self.gates[biz]
                started.set()
                assert release.wait(T), "테스트가 build 를 풀지 않았다"
            if biz in self.fail_once:
                self.fail_once.discard(biz)
                raise RuntimeError("build 실패 (테스트)")
        finally:
            with self._lock:
                self.active -= 1

    def build_reference(self, shops, pop, biz, radius_m, *a, **k):
        self._run("competition", biz)
        return (pd.DataFrame({"biz": [biz], "r": [radius_m]}), pd.DataFrame())

    def site_profile(self, lat, lng, stations, anchors, biz):
        self._run("location", biz)
        return {"역세권_강도": 0.0, "유인시설_근접도": 0.0, "최근접역_거리m": 0.0, "유인시설_종류별": {}}


@pytest.fixture
def engine(monkeypatch):
    e = SlowEngine()
    monkeypatch.setattr(radius_demand, "build_reference", e.build_reference)
    monkeypatch.setattr(etl_location, "site_profile", e.site_profile)
    return e


def run(fn, *args):
    out = {}

    def target():
        try:
            out["value"] = fn(*args)
        except BaseException as exc:            # noqa: BLE001 — 스레드 예외를 본 스레드로 넘긴다
            out["error"] = exc
    t = threading.Thread(target=target, daemon=True)
    t.start()
    return t, out


def test_hit_does_not_wait_for_other_key_build(engine):
    c = ReferenceCache(fake_rt())
    hit_comp = c.competition("R10406", RADIUS)                 # 미리 계산(빠름)
    hit_loc = c.location("R10406")
    started, release = engine.gate("I21201")
    builder, _ = run(c.competition, "I21201", RADIUS)          # 다른 키 build — 풀 때까지 멈춤(잠금 쥔 채)
    assert started.wait(T)
    for fn, args, want in ((c.competition, ("R10406", RADIUS), hit_comp), (c.location, ("R10406",), hit_loc)):
        t, out = run(fn, *args)
        t.join(T)
        assert not t.is_alive(), "hit 이 다른 키의 build 잠금을 기다렸다"
        assert out["value"] is want
    assert builder.is_alive()                                  # 그동안 다른 키 build 는 계속 진행 중이었다
    release.set()
    builder.join(T)
    assert not builder.is_alive()


def test_same_key_built_once_under_concurrency(engine):
    c = ReferenceCache(fake_rt())
    n = 8
    barrier = threading.Barrier(n)
    started, release = engine.gate("R10406")

    def request():
        barrier.wait(T)                                        # 동시 출발
        return c.competition("R10406", RADIUS)
    threads = [run(request) for _ in range(n)]
    assert started.wait(T)
    release.set()
    for t, _ in threads:
        t.join(T)
        assert not t.is_alive()
    values = [out["value"] for _, out in threads]
    assert all(v is values[0] for v in values)
    assert engine.calls.count(("competition", "R10406")) == 1
    assert c.stats()["competition_entries"] == 1


def test_build_failure_stores_nothing_and_releases_lock(engine):
    c = ReferenceCache(fake_rt())
    engine.fail_once.add("R10406")
    with pytest.raises(RuntimeError):
        c.competition("R10406", RADIUS)
    assert c.stats()["competition_entries"] == 0
    t, out = run(c.competition, "R10406", RADIUS)             # 잠금이 남아 있으면 여기서 멈춘다
    t.join(T)
    assert not t.is_alive() and "value" in out
    assert engine.calls.count(("competition", "R10406")) == 2


def test_misses_are_built_one_at_a_time(engine):
    c = ReferenceCache(fake_rt())
    started, release = engine.gate("R10406")
    first, _ = run(c.competition, "R10406", RADIUS)
    assert started.wait(T)
    second, _ = run(c.competition, "I21201", RADIUS)          # 다른 키 miss — 첫 build 가 끝날 때까지 시작하지 않는다
    second.join(0.3)
    assert second.is_alive() and ("competition", "I21201") not in engine.calls
    release.set()
    for t in (first, second):
        t.join(T)
        assert not t.is_alive()
    assert engine.max_active == 1


def test_warm_yields_to_waiting_request(engine):
    """warm 이 R10406 을 계산하는 동안 요청이 S20701 을 기다리면, warm 의 다음 키(I21201)보다 요청이 먼저 계산된다."""
    c = ReferenceCache(fake_rt())
    started, release = engine.gate("R10406")
    warm, warm_out = run(lambda: c.warm(["R10406", "I21201"], radii=[RADIUS]))
    assert started.wait(T)
    req, req_out = run(c.competition, "S20701", RADIUS)
    deadline = threading.Event()
    for _ in range(100):                                       # 요청이 build 대기열에 들어갈 때까지(최대 1s)
        with c._state:
            if c._foreground_waiting == 1:
                break
        deadline.wait(0.01)
    with c._state:
        assert c._foreground_waiting == 1
    release.set()
    for t in (req, warm):
        t.join(T)
        assert not t.is_alive()
    assert "error" not in warm_out and "error" not in req_out
    order = [b for k, b in engine.calls if k == "competition"]
    assert order == ["R10406", "S20701", "I21201"]


def test_cache_values_unchanged_for_hits(engine):
    """잠금 변경 뒤에도 같은 키는 같은 객체를 돌려준다(재계산 없음)."""
    c = ReferenceCache(fake_rt())
    a = c.competition("R10406", RADIUS)
    b = c.competition("R10406", RADIUS)
    assert a is b and engine.calls == [("competition", "R10406")]


class PausingCondition:
    """ReferenceCache._state 대역. 이름이 pause_thread 인 스레드가 이 잠금 블록을 **처음 빠져나올 때** 멈춘다.
    warm 의 첫 miss 에서 그 순간은 — 수정 전: 대기 요청 확인(wait_for) 직후·build 잠금 획득 전 / 수정 후: 확인과 실행권 예약 직후."""

    def __init__(self, real, pause_thread):
        self.real, self.pause_thread = real, pause_thread
        self.paused, self.go = threading.Event(), threading.Event()
        self._done = False

    def __enter__(self):
        return self.real.__enter__()

    def __exit__(self, *exc):
        out = self.real.__exit__(*exc)
        if not self._done and threading.current_thread().name == self.pause_thread:
            self._done = True
            self.paused.set()
            assert self.go.wait(T), "테스트가 warm 을 재개하지 않았다"
        return out

    def wait(self, *a, **k):
        return self.real.wait(*a, **k)

    def wait_for(self, *a, **k):
        return self.real.wait_for(*a, **k)

    def notify_all(self):
        return self.real.notify_all()


def test_warm_check_and_reservation_have_no_gap(engine):
    """Codex 재현(8-D2a 검수): warm 이 대기 요청 0 을 확인한 뒤 실행권을 얻기 전에 멈추고, 그 사이 요청이 도착한다.
    수정 전에는 확인과 획득 사이에 틈이 있어 요청이 끼어들고(이후 warm 을 먼저 재개하면 대기 요청이 있는데도 warm build 가
    시작될 수 있다), 수정 후에는 warm 이 이미 실행권을 예약했으므로 요청은 그 build 1개만 기다린 뒤 warm 의 **다음** build
    보다 먼저 계산된다."""
    c = ReferenceCache(fake_rt())
    c._state = PausingCondition(c._state, "warm")
    warm = threading.Thread(target=lambda: c.warm(["R10406", "I21201"], radii=[RADIUS]), name="warm", daemon=True)
    warm.start()
    assert c._state.paused.wait(T)                             # warm: 첫 miss 의 대기 확인을 마치고 멈춤
    req, req_out = run(c.competition, "S20701", RADIUS)        # 그 사이 도착한 요청
    for _ in range(100):
        if ("competition", "S20701") in engine.calls or c._foreground_waiting == 1:
            break
        threading.Event().wait(0.01)
    assert ("competition", "S20701") not in engine.calls, \
        "warm 의 대기 확인과 실행권 예약 사이에 요청이 끼어들었다 — 확인·예약이 한 번에 일어나지 않는다"
    assert c._foreground_waiting == 1                          # 요청은 실행권을 기다리는 중
    c._state.go.set()                                          # warm 을 먼저 재개
    for t in (req, warm):
        t.join(T)
        assert not t.is_alive()
    assert "error" not in req_out
    order = engine.calls[:3]
    assert order == [("competition", "R10406"), ("competition", "S20701"), ("location", "R10406")], \
        f"요청이 warm 의 다음 build 보다 먼저 계산돼야 한다: {engine.calls}"
    assert c._foreground_waiting == 0 and not c._building


def test_failed_build_releases_waiters(engine):
    """build 가 실패해도 실행권을 돌려줘 기다리던 요청이 이어서 진행한다(미저장). 1차 구현도 지키던 동작 — 유지 확인용."""
    c = ReferenceCache(fake_rt())
    started, release = engine.gate("R10406")
    engine.fail_once.add("R10406")
    first, first_out = run(c.competition, "R10406", RADIUS)
    assert started.wait(T)
    second, second_out = run(c.competition, "I21201", RADIUS)
    second.join(0.3)
    assert second.is_alive() and ("competition", "I21201") not in engine.calls   # 첫 build 를 기다리는 중
    release.set()                                              # 첫 build 실패
    for t in (first, second):
        t.join(T)
        assert not t.is_alive(), "실패한 build 뒤 기다리던 요청이 풀리지 않았다"
    assert isinstance(first_out.get("error"), RuntimeError) and "value" in second_out
    assert c.stats()["competition_entries"] == 1               # 실패한 키는 저장하지 않았다
    third, third_out = run(c.competition, "S20701", RADIUS)   # 실행권이 남아 있지 않다
    third.join(T)
    assert not third.is_alive() and "value" in third_out
