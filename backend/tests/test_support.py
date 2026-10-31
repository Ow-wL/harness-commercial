"""
TASKS 13-31 — 지원사업 공고 수집·캐시 (backend/app/support.py, D-039).

기업마당·K-Startup 은 부르지 않는다: SupportService 에 가짜 fetch 를 주입한다. 응답 모양은 2026-11-01 실측(SUPPORT_PROGRAMS 6절) —
기업마당 `jsonArray` 목록·`hashtags`(소문자)·신청기간 `YYYY-MM-DD ~ YYYY-MM-DD` 또는 글, K-Startup `data`·`YYYYMMDD`. 내용은 꾸민 것.
계약 = 인천·전국·마감 안 지난 공고만, 두 자료 중복은 기업마당 쪽 하나(sources 둘 다), 자료원별 실패는 지난 캐시 유지, 디스크 캐시 재사용,
키 없으면 꺼짐, /health support 광고, 로그·health 에 키 없음.
"""
import json
import logging
import types
from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from backend.app import main as M
from backend.app import support as S

KST = S.KST
BIZ_KEY, DG_KEY = "biz-secret-123", "dg-secret-456"
ALL_REGIONS = "서울,부산,대구,인천,전남광주,대전,울산,세종,경기,강원,충북,충남,전북,경북,경남,제주"


def biz_item(pid, title, period, tags, target="소상공인", agency="중소벤처기업부"):
    return {"pblancId": pid, "pblancNm": title, "pblancUrl": f"https://www.bizinfo.go.kr/view.do?pblancId={pid}",
            "jrsdInsttNm": agency, "excInsttNm": "수행기관", "trgetNm": target, "reqstBeginEndDe": period,
            "pldirSportRealmLclasCodeNm": "경영", "hashtags": tags, "rceptEngnHmpgUrl": "",
            "bsnsSumryCn": "<p>소상공인 &amp; 예비창업자 지원</p>", "creatPnttm": "2026-10-30 13:47:56"}


BIZ_ITEMS = [
    biz_item("PBLN_1", "2026년 소상공인 경영개선 지원사업", "2026-10-28 ~ 2026-11-11", f"경영,{ALL_REGIONS},2026,경영개선"),
    biz_item("PBLN_2", "[인천] 골목상권 활성화 지원", "예산 소진시까지", "경영,인천,골목상권", agency="인천광역시"),
    biz_item("PBLN_3", "서울 공유주방 입주 모집", "2026-10-01 ~ 2026-11-30", "창업,서울,공유주방"),          # 다른 지역만 → 뺀다
    biz_item("PBLN_4", "전국 소상공인 정책자금 안내", "상시 접수", "금융,정책자금"),                          # 지역 태그 없음 → 전국
    biz_item("PBLN_5", "(재공고) 예비창업 멘토링 프로그램", "2026-10-20 ~ 2026-11-20", f"창업,{ALL_REGIONS}", target="창업벤처"),
    biz_item("PBLN_6", "마감 지난 인천 공고", "2026-09-01 ~ 2026-10-31", "경영,인천"),                       # 마감 지남 → 뺀다
]


def ks_item(sn, title, region, start, end, trgt="일반인,일반기업"):
    return {"pbanc_sn": sn, "biz_pbanc_nm": title, "pbanc_ntrp_nm": "창업기관", "sprv_inst": "공공기관",
            "aply_trgt": trgt, "supt_biz_clsfc": "멘토링ㆍ컨설팅ㆍ교육", "supt_regin": region,
            "pbanc_rcpt_bgng_dt": start, "pbanc_rcpt_end_dt": end, "detl_pg_url": f"https://www.k-startup.go.kr/{sn}",
            "biz_aply_url": "", "pbanc_ctnt": "창업 멘토링", "biz_enyy": "예비창업자,1년미만", "biz_trgt_age": "만 20세 이상 ~ 만 39세 이하",
            "rcrt_prgs_yn": "Y"}


KS_ITEMS = [
    ks_item(101, "예비창업 멘토링 프로그램", "전국", "20261020", "20261120"),                 # 기업마당 PBLN_5 와 같은 공고
    ks_item(102, "인천중장년기술창업센터 입주기업 모집", "인천", "20261026", "20261106"),
    ks_item(103, "부산 창업카페 입주", "부산", "20261001", "20261130"),                       # 다른 지역 → 뺀다
]


class Clock:
    def __init__(self, t="2026-11-01T09:00:00+09:00"):
        self.now = datetime.fromisoformat(t)

    def __call__(self):
        return self.now


def fake_fetch(calls, fail=()):
    def fetch(url, params):
        source = "bizinfo" if "bizinfo" in url else "kstartup"
        calls.append((source, dict(params)))
        if source in fail:
            raise TimeoutError("boom")
        if source == "bizinfo":
            return 200, json.dumps({"jsonArray": BIZ_ITEMS}, ensure_ascii=False).encode("utf-8")
        size, page = int(params["perPage"]), int(params["page"])
        rows = KS_ITEMS[(page - 1) * size: page * size]
        return 200, json.dumps({"currentCount": len(rows), "data": rows, "page": page},
                               ensure_ascii=False).encode("utf-8")
    return fetch


def service(tmp_path, calls=None, fail=(), clock=None, biz=BIZ_KEY, dg=DG_KEY):
    return S.SupportService(biz, dg, tmp_path, fetch=fake_fetch([] if calls is None else calls, fail), clock=clock or Clock())


def test_parse_bizinfo_real_shape():
    ps = {p.id: p for p in S.parse_bizinfo(json.dumps({"jsonArray": BIZ_ITEMS}, ensure_ascii=False).encode())}
    p1 = ps["bizinfo:PBLN_1"]
    assert (p1.start, p1.end, p1.nationwide, p1.regions) == ("2026-10-28", "2026-11-11", True, [])  # 17개 시도 태그 = 전국
    assert p1.keywords == ["경영", "경영개선"]                                               # 연도·지역 태그는 키워드에서 뺀다
    assert (ps["bizinfo:PBLN_2"].nationwide, ps["bizinfo:PBLN_2"].regions) == (False, ["인천"])
    assert p1.summary == "소상공인 & 예비창업자 지원" and p1.targets == ["소상공인"] and p1.apply_url is None
    p2 = ps["bizinfo:PBLN_2"]
    assert (p2.start, p2.end, p2.period_text) == (None, None, "예산 소진시까지")             # 날짜가 아닌 신청기간은 원문만
    assert ps["bizinfo:PBLN_4"].nationwide is True
    assert S.parse_period("20220727 ~ 20220930") == ("2022-07-27", "2022-09-30")              # 명세 예시 형식도 읽는다


def test_parse_errors_do_not_echo_message():
    for body in (b'{"reqErr":"\xec\x9d\xb8\xec\xa6\x9d\xed\x82\xa4 \xec\x98\xa4\xeb\xa5\x98"}', b"<html>", b'{"jsonArray": 3}'):
        try:
            S.parse_bizinfo(body)
        except S.SupportSourceError as e:
            assert str(e) in ("reqErr", "response not json", "response shape")
        else:
            raise AssertionError("expected SupportSourceError")


def test_refresh_filters_merges_and_caches(tmp_path):
    calls = []
    svc = service(tmp_path, calls)
    state = svc.refresh()
    ids = [p.id for p in svc.programs()]
    assert "bizinfo:PBLN_3" not in ids and "bizinfo:PBLN_6" not in ids and "kstartup:103" not in ids   # 다른 지역·마감 지남
    assert "kstartup:101" not in ids                                                                   # 기업마당 PBLN_5 와 같은 공고
    p5 = next(p for p in svc.programs() if p.id == "bizinfo:PBLN_5")
    assert p5.sources == ["bizinfo", "kstartup"]
    assert "kstartup:102" in ids and "bizinfo:PBLN_2" in ids and "bizinfo:PBLN_4" in ids
    assert [p.end for p in svc.programs()][:2] == ["2026-11-06", "2026-11-11"]                       # 마감 가까운 순, 날짜 없음은 뒤
    assert svc.programs()[-1].end is None
    assert state["sources"]["bizinfo"] == {"ok": True, "count": 4, "fetched_at": "2026-11-01T09:00:00+09:00", "error": None}
    assert state["sources"]["kstartup"]["count"] == 2
    # 요청: 기업마당 전체(searchCnt 0)·JSON, K-Startup 모집 중만 — 키는 파라미터로만
    assert calls[0] == ("bizinfo", {"crtfcKey": BIZ_KEY, "dataType": "json", "searchCnt": "0"})
    assert calls[1][1]["cond[rcrt_prgs_yn::EQ]"] == "Y" and calls[1][1]["serviceKey"] == DG_KEY
    # 디스크 캐시: 새 인스턴스가 받지 않고 같은 목록을 읽는다
    again = service(tmp_path, calls=[])
    assert [p.id for p in again.programs()] == ids and again.due() is False
    assert BIZ_KEY not in (tmp_path / S.CACHE_FILE).read_text(encoding="utf-8")


def test_source_failure_keeps_previous_programs(tmp_path, caplog):
    clock = Clock()
    service(tmp_path, clock=clock).refresh()
    clock.now += timedelta(days=1, hours=1)
    svc = service(tmp_path, fail=("kstartup",), clock=clock)
    assert svc.due() is True
    with caplog.at_level(logging.INFO, logger="backend.support"):
        state = svc.refresh()
    assert state["sources"]["kstartup"]["ok"] is False and state["sources"]["kstartup"]["count"] == 1   # 102 그대로(101 은 합쳐짐)
    assert state["sources"]["kstartup"]["fetched_at"] == "2026-11-01T09:00:00+09:00"                    # 마지막 성공 시각
    assert state["sources"]["bizinfo"]["ok"] is True
    assert "kstartup:102" in [p.id for p in svc.programs()]
    assert BIZ_KEY not in caplog.text and DG_KEY not in caplog.text
    # 실패가 이어지면 5분 → 15분 → 1시간 뒤 다시 받는다(v0.3.1), 그 안에는 아니다
    assert svc.due() is False
    clock.now += timedelta(minutes=5)
    assert svc.due() is True
    svc.refresh()                                                                          # 두 번째 실패
    clock.now += timedelta(minutes=14)
    assert svc.due() is False
    clock.now += timedelta(minutes=1)
    assert svc.due() is True
    svc.refresh()
    svc.refresh()                                                                          # 네 번째 실패 → 1시간
    clock.now += timedelta(minutes=59)
    assert svc.due() is False
    clock.now += timedelta(minutes=1)
    assert svc.due() is True
    assert "kstartup request failed TimeoutError: boom" in caplog.text                     # 원인은 남기되 키는 없다


def test_success_resets_backoff(tmp_path):
    clock = Clock()
    calls = []
    svc = service(tmp_path, calls, fail=("kstartup",), clock=clock)
    svc.refresh()
    assert svc.failures == 1
    svc.fetch = fake_fetch(calls)                                                          # 연결이 돌아왔다
    clock.now += timedelta(minutes=5)
    assert svc.due() is True
    svc.refresh()
    assert svc.failures == 0 and svc.state["sources"]["kstartup"]["ok"] is True
    clock.now += timedelta(minutes=30)
    assert svc.due() is False                                                              # 성공 뒤에는 하루 1회


def test_expired_programs_drop_on_read_and_daily_refresh_due(tmp_path):
    clock = Clock()
    svc = service(tmp_path, clock=clock)
    svc.refresh()
    clock.now += timedelta(days=7)                                                            # 2026-11-08
    ids = [p.id for p in svc.programs()]
    assert "kstartup:102" not in ids and "bizinfo:PBLN_2" in ids                              # 11-06 마감 지남, 날짜 없음 남음
    assert svc.due() is True


def test_kstartup_pages_until_short_page(tmp_path, monkeypatch):
    monkeypatch.setattr(S, "KSTARTUP_PAGE", 2)
    calls = []
    service(tmp_path, calls, biz=None).refresh()
    assert [c[1]["page"] for c in calls] == [1, 2]                                            # 3건 → 2 + 1
    assert all(c[0] == "kstartup" for c in calls)


def test_no_keys_disabled(tmp_path):
    calls = []
    svc = service(tmp_path, calls, biz=None, dg=" ")
    assert svc.enabled is False and svc.due() is False
    svc.start()
    assert svc.thread is None and calls == []
    assert svc.health() == {"enabled": False, "as_of": None, "count": 0,
                            "sources": {"bizinfo": {"enabled": False, "ok": None, "count": 0},
                                        "kstartup": {"enabled": False, "ok": None, "count": 0}}}


def test_health_advertises_support_without_secrets(tmp_path):
    svc = service(tmp_path, fail=("bizinfo",))
    svc.refresh()
    app = M.create_app(service=types.SimpleNamespace(cache=types.SimpleNamespace(warm=lambda b: None)), warm_biz=[],
                       support=svc)
    with TestClient(app) as c:
        h = c.get("/health").json()["support"]
    assert h == {"enabled": True, "as_of": "2026-11-01T09:00:00+09:00", "count": 2,          # 기업마당 실패 → K-Startup 101·102
                 "sources": {"bizinfo": {"enabled": True, "ok": False, "count": 0},
                             "kstartup": {"enabled": True, "ok": True, "count": 2}}}
    assert BIZ_KEY not in json.dumps(h) and "boom" not in json.dumps(h)


def test_background_thread_refreshes_once_and_stops(tmp_path):
    calls = []
    svc = service(tmp_path, calls)
    svc.thread = None
    import threading
    t = threading.Thread(target=svc.run, kwargs={"check_every_s": 0.01})
    t.start()
    for _ in range(200):
        if svc.state["as_of"]:
            break
        threading.Event().wait(0.01)
    svc.stop.set()
    t.join(timeout=2)
    assert not t.is_alive() and svc.state["as_of"] and [c[0] for c in calls] == ["bizinfo", "kstartup"]
