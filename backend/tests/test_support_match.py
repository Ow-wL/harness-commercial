"""
TASKS 13-32 — 지원사업 "조건에 맞는 공고" 규칙 (backend/app/support_match.py + support_rules.json, D-039) 과 POST /support/match.

공고는 꾸민 Program 이다(외부 호출 없음). 규칙 표를 바꾸면 이 테스트를 함께 고친다 — 표가 곧 계약이다.
"""
import types
from dataclasses import replace
from datetime import date, datetime

from fastapi.testclient import TestClient

from backend.app import main as M
from backend.app import support as S
from backend.app.support_match import MatchProfile, load_rules, match

TODAY = date(2026, 11, 1)


def prog(pid, title, source="bizinfo", nationwide=True, targets=("소상공인",), category="경영", end=None,
         keywords=(), summary=None, period=None, ages=None, regions=None):
    return S.Program(id=f"{source}:{pid}", source=source, title=title, agency="기관", operator=None, targets=list(targets),
                     category=category, regions=list(regions or ([] if nationwide else ["인천"])), nationwide=nationwide,
                     period_text="예산 소진시까지" if end is None else f"2026-10-01 ~ {end}", start=None, end=end,
                     url=f"https://example.test/{pid}", apply_url=None, summary=summary, keywords=list(keywords),
                     startup_period=period, ages=ages, sources=[source])


def titles(items):
    return [i["title"] for i in items]


def run(programs, biz="I21201", name="카페", gu=None, profile=None, limit=None):
    return match(programs, biz, name, gu, profile, TODAY, limit)


def test_rules_table_is_valid_and_limits():
    R = load_rules()
    assert R["limit_default"] == 5 and R["limit_max"] == 10 and R["deadline_soon_days"] == 7
    assert {f["prefix"] for f in R["families"]} == {"I2", "G2", "S2", "R1", "P1"}           # 29개 업종 코드 앞자리 전부
    from scoring_engine import config as C
    assert all(any(code.startswith(f["prefix"]) for f in R["families"]) for code in C.CODE_NAME)
    many = [prog(i, f"소상공인 지원 {i}") for i in range(15)]
    assert len(run(many)[1]) == 5 and len(run(many, limit=50)[1]) == 10 and run(many)[0] == 15


def test_excludes_manufacturing_export_other_regions_and_student_only():
    ps = [
        prog(1, "소상공인 경영안정자금"),
        prog(2, "소상공인 스마트공장 구축", category="경영"),                       # 공고명 제조·기술 계열
        prog(3, "소상공인 수출 바우처", category="수출"),                           # 분야 수출
        prog(4, "제조 소공인 지원", targets=("제조업",)),                           # 대상 제조업
        prog(5, "서울 소상공인 컨설팅"),                                           # 전국 공고인데 다른 시도 이름
        prog(6, "대학생 창업동아리", source="kstartup", targets=("대학생", "대학")),   # K-Startup 학생·기관만
        prog(7, "중소기업 우수 포상", targets=("중소기업",), category="기타"),        # 핵심 신호 없음
    ]
    assert titles(run(ps)[1]) == ["소상공인 경영안정자금"]


def test_incheon_and_same_gu_first_other_gu_excluded():
    ps = [
        prog(1, "전국 소상공인 자금"),
        prog(2, "[인천] 소상공인 특례보증", nationwide=False),
        prog(3, "[인천] 부평구 소상공인 협약보증", nationwide=False),
        prog(4, "[인천] 남동구 소상공인 보증", nationwide=False),                   # 다른 구 → 뺀다("동구"로 잘못 읽지 않는다)
    ]
    total, items = run(ps, gu="부평구")
    assert titles(items) == ["[인천] 부평구 소상공인 협약보증", "[인천] 소상공인 특례보증", "전국 소상공인 자금"]
    assert items[0]["reasons"][:3] == ["인천 공고", "부평구 공고", "소상공인 대상"]
    assert total == 3
    assert "[인천] 남동구 소상공인 보증" in titles(run(ps, gu="남동구")[1])
    assert "[인천] 남동구 소상공인 보증" not in titles(run(ps, gu="동구")[1])
    assert len(run(ps)[1]) == 4                                                       # 구를 모르면 구로 거르지 않는다


def test_business_name_and_family_signals():
    ps = [
        prog(1, "커피 전문점 바리스타 지원", targets=("중소기업",), category="기타"),
        prog(2, "외식업 위생 개선", targets=("중소기업",), category="기타"),
        prog(3, "미용업 디지털 전환", targets=("중소기업",), category="기타"),
    ]
    items = run(ps)[1]                                                                # 카페(I21201): 이름 3점 > 외식 계열 2점
    assert titles(items) == ["커피 전문점 바리스타 지원", "외식업 위생 개선"]
    assert items[0]["reasons"] == ["카페 관련"] and items[1]["reasons"] == ["외식업 관련"]
    assert titles(run(ps, "S20701", "미용실")[1]) == ["미용업 디지털 전환"]


def test_profile_stage_youth_preferred_filters_and_unset_passes():
    ps = [
        prog(1, "예비창업 패키지", source="kstartup", targets=("일반인",), period="예비창업자", category="사업화"),
        prog(2, "초기 창업 지원", source="kstartup", targets=("일반기업",), period="1년미만,2년미만,3년미만", category="사업화"),
        prog(3, "청년 소상공인 컨설팅"),
        prog(4, "여성 소상공인 판로 지원", targets=("여성기업",)),
        prog(5, "중장년 소상공인 재기 교육"),
        prog(6, "청년만 창업 공간", source="kstartup", targets=("일반인",), ages="만 20세 이상 ~ 만 39세 이하",
             period="예비창업자,1년미만", category="시설ㆍ공간ㆍ보육"),
    ]
    assert run(ps)[0] == 6                                                            # 프로필 없음 = 모두 통과
    pre = titles(run(ps, profile=MatchProfile(stage="예비"))[1])
    assert "초기 창업 지원" not in pre and "예비창업 패키지" in pre
    running = titles(run(ps, profile=MatchProfile(stage="운영 중"))[1])
    assert "예비창업 패키지" not in running and "초기 창업 지원" in running
    old = titles(run(ps, profile=MatchProfile(youth=False))[1])
    assert "청년 소상공인 컨설팅" not in old and "청년만 창업 공간" not in old
    young = run(ps, profile=MatchProfile(youth=True))[1]
    assert "청년 대상" in young[0]["reasons"]
    women = titles(run(ps, profile=MatchProfile(preferred=("여성",)))[1])
    assert "여성 소상공인 판로 지원" in women and "중장년 소상공인 재기 교육" not in women
    assert "여성 우대" in run(ps, profile=MatchProfile(preferred=("여성",)))[1][0]["reasons"]


def test_deadline_soon_and_order():
    ps = [prog(1, "소상공인 A", end="2026-11-30"), prog(2, "소상공인 B", end="2026-11-05"), prog(3, "소상공인 C"),
          prog(4, "소상공인 D", end="2026-11-01")]
    items = run(ps)[1]
    assert titles(items) == ["소상공인 D", "소상공인 B", "소상공인 A", "소상공인 C"]          # 같은 점수: 마감 가까운 순, 날짜 없음 뒤
    assert [(i["days_left"], i["deadline_soon"]) for i in items] == [(0, True), (4, True), (29, False), (None, False)]
    assert items[0]["reasons"][-1] == "오늘 마감" and items[1]["reasons"][-1] == "마감 4일 남음"
    assert "score" not in items[0]                                                    # 점수는 내보내지 않는다


class FixedSupport(S.SupportService):
    def __init__(self, programs, enabled=True):
        super().__init__("k" if enabled else None, None, "unused-dir",
                         clock=lambda: datetime(2026, 11, 1, 9, tzinfo=S.KST))
        self.state = {"as_of": "2026-11-01T06:00:00+09:00", "sources": {}, "programs": programs}

    def start(self):                                                                  # 테스트에서는 받지 않는다
        pass


def client(support):
    app = M.create_app(service=types.SimpleNamespace(cache=types.SimpleNamespace(warm=lambda b: None)), warm_biz=[],
                       support=support)
    return TestClient(app)


def test_endpoint_contract():
    ps = [prog(1, "[인천] 부평구 소상공인 보증", nationwide=False, end="2026-11-03"), prog(2, "소상공인 자금")]
    with client(FixedSupport(ps)) as c:
        r = c.post("/support/match", json={"biz_code": "I21201", "gu": "부평구",
                                           "profile": {"stage": "운영 중", "youth": None, "preferred": None}})
        assert r.status_code == 200
        body = r.json()
        assert body["as_of"] == "2026-11-01T06:00:00+09:00" and body["total"] == 2
        first = body["items"][0]
        assert first["title"] == "[인천] 부평구 소상공인 보증" and first["days_left"] == 2 and first["deadline_soon"] is True
        assert set(first) >= {"id", "source", "sources", "agency", "targets", "period_text", "url", "apply_url", "reasons"}
        assert c.post("/support/match", json={"biz_code": "NOPE"}).json()["error"]["code"] == "invalid_business"
        assert c.post("/support/match", json={"biz_code": "I21201", "gu": "강남구"}).status_code == 422
        assert c.post("/support/match", json={"biz_code": "I21201", "limit": 11}).status_code == 422
        assert len(c.post("/support/match", json={"biz_code": "I21201", "limit": 1}).json()["items"]) == 1
        assert c.get("/support/match").status_code == 405


def test_endpoint_disabled_is_503():
    with client(FixedSupport([], enabled=False)) as c:
        r = c.post("/support/match", json={"biz_code": "I21201"})
    assert r.status_code == 503 and r.json()["error"]["code"] == "support_unavailable"


def test_expired_program_never_matches():
    p = replace(prog(1, "[인천] 소상공인 지난 공고", nationwide=False), end="2026-10-31")
    with client(FixedSupport([p])) as c:
        assert c.post("/support/match", json={"biz_code": "I21201"}).json()["total"] == 0
