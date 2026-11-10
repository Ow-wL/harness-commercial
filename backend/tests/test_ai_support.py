"""
TASKS 13-34 — AI 요약·질문과 지원사업 연결 (backend/app/ai.py support_candidates·support_violations·guard_*, main.py ai_support).

계약: 지원사업 자료가 켜져 있으면 모델 입력에 "지원사업_후보"(S1…, /support/match 와 같은 규칙 — 요약은 업종·구 3건, 질문은 내 상황까지 5건),
모델이 목록 밖 공고(「」 안 이름·없는 후보 id)를 말하면 요약 항목은 빼고 답변은 안내 문구로 바꾼다. 꺼져 있으면 키 자체가 없다.
실제 모델·외부 자료는 부르지 않는다(가짜 completer·고정 공고).
"""
import json
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from backend.app import ai as A
from backend.app import main as M
from backend.app import support as S
from backend.tests.test_ai import BUPYEONG, FakeCompleter, ai_service

LISTED = "[인천] 부평구 소상공인 특례보증 지원사업"


def prog(pid, title, nationwide=False, period=None, source="bizinfo", targets=("소상공인",)):
    return S.Program(id=f"{source}:{pid}", source=source, title=title, agency="인천광역시", operator=None, targets=list(targets),
                     category="금융", regions=[] if nationwide else ["인천"], nationwide=nationwide, period_text="예산 소진시까지",
                     start=None, end=None, url=f"https://example.test/{pid}", apply_url=None, summary=None, keywords=[],
                     startup_period=period, sources=[source])


PROGRAMS = [
    prog(1, LISTED),
    prog(2, "예비창업 소상공인 멘토링", nationwide=True, period="예비창업자", source="kstartup", targets=("일반인",)),
]


class FixedSupport(S.SupportService):
    def __init__(self, programs, enabled=True):
        super().__init__("k" if enabled else None, None, "unused-dir", clock=lambda: datetime(2026, 11, 2, 10, tzinfo=S.KST))
        self.state = {"as_of": "2026-11-02T06:00:00+09:00", "sources": {}, "programs": programs}

    def start(self):
        pass


@pytest.fixture()
def client(real_service, tmp_path):
    made = []

    def make(completer, support):
        c = TestClient(M.create_app(service=real_service, warm_biz=[], ai=ai_service(tmp_path / str(len(made)), completer),
                                    support=support))
        c.__enter__()
        made.append(c)
        return c

    yield make
    for c in made:
        c.__exit__(None, None, None)


def model_input(fake):
    """메시지 = '분석 자료(JSON):' 줄 + JSON 한 줄 + 빈 줄 + 할 일 — JSON 부분만"""
    content = fake.calls[-1]["messages"][0]["content"]
    return json.loads(content.split("\n", 1)[1].split("\n\n", 1)[0])


def test_violation_rules():
    cands = A.support_candidates([{"title": LISTED, "agency": "인천광역시", "targets": ["소상공인"], "nationwide": False,
                                   "period_text": "예산 소진시까지", "days_left": None}])
    assert cands[0]["id"] == "S1" and "url" not in json.dumps(cands, ensure_ascii=False)
    assert A.support_violations(f"「{LISTED}」를 확인하세요.", ["지원사업_후보.S1"], cands) == []
    assert A.support_violations("「부평구 소상공인 특례보증」도 있어요.", [], cands) == []           # 목록 공고명의 일부(6자 이상)
    # 실제 모델 확인(2026-11-01)에서 머리말·연도를 빼고 인용한 목록 공고를 잘못 막았다 → 괄호 머리말·연도는 비교에서 뺀다
    long = A.support_candidates([{"title": "[인천] 2026년 신개념 세대융합 청년창업 지원 멘티 상시모집 공고", "agency": "센터",
                                  "targets": [], "nationwide": False, "period_text": "", "days_left": None}])
    assert A.support_violations("「신개념 세대융합 청년창업 지원 멘티 상시모집 공고」", [], long) == []
    assert A.support_violations("「2026 신개념 세대융합 청년창업 지원 멘티 상시모집」", [], long) == []
    assert A.support_violations("「희망리턴패키지」를 신청하세요.", [], cands) == ["희망리턴패키지"]  # 목록 밖
    assert A.support_violations("근거", ["지원사업_후보.S7"], cands) == ["지원사업_후보.S7"]       # 없는 id
    assert A.support_violations("\"현장\"을 보세요. 「저녁」 유동도요.", [], cands) == []          # 공고 같은 이름이 아니면 무관
    assert A.support_violations("「청년창업 지원사업」", [], None) == ["청년창업 지원사업"]          # 후보 없음 = 어떤 공고도 안 됨


def test_summary_gets_three_candidates_and_drops_unlisted_program(client):
    out = {
        "good": [{"text": "주요 손님층이 많이 사는 편이에요.", "fields": ["지표.customer.score"]}],
        "bad": [{"text": "같은 업종이 많아요.", "fields": ["지표.competition.raw.동종점포수"]}],
        "check": [{"text": f"경쟁이 세니 「{LISTED}」 공고 원문에서 자격을 확인해 보세요.", "fields": ["지원사업_후보.S1"]},
                  {"text": "「희망리턴패키지」도 신청해 보세요.", "fields": []}],
    }
    fake = FakeCompleter(out)
    c = client(fake, FixedSupport(PROGRAMS))
    r = c.post("/summary", json=BUPYEONG)
    assert r.status_code == 200
    data = model_input(fake)
    assert [x["공고명"] for x in data["지원사업_후보"]] == [LISTED, "예비창업 소상공인 멘토링"]
    assert "목록에 있는 공고만" not in data and "지원사업_후보" in fake.calls[-1]["system"]
    check = [i["text"] for i in r.json()["check"]]
    assert check == [f"경쟁이 세니 「{LISTED}」 공고 원문에서 자격을 확인해 보세요."]                 # 목록 밖 항목은 빠진다
    assert r.json()["prompt_version"] == "r4-1"


def test_summary_cache_key_follows_candidates(client):
    fake = FakeCompleter()
    sup = FixedSupport(PROGRAMS)
    c = client(fake, sup)
    assert c.post("/summary", json=BUPYEONG).json()["cached"] is False
    assert c.post("/summary", json=BUPYEONG).json()["cached"] is True
    sup.state = {**sup.state, "programs": [prog(3, "[인천] 새 소상공인 경영안정자금")]}
    assert c.post("/summary", json=BUPYEONG).json()["cached"] is False                              # 후보가 바뀌면 다시 만든다
    assert len(fake.calls) == 2


def test_ask_uses_profile_candidates_and_rewrites_unlisted_name(client):
    fake = FakeCompleter({"answer": "「청년 창업 바우처」를 신청해 보세요.", "fields": ["지원사업_후보.S9", "종합.점수"],
                          "out_of_scope": False, "profile_suggestion": None})
    c = client(fake, FixedSupport(PROGRAMS))
    r = c.post("/ask", json={**BUPYEONG, "question": "받을 수 있는 지원사업이 있어요?",
                             "profile": {"stage": "운영 중", "youth": None, "preferred": None}})
    assert r.status_code == 200
    names = [x["공고명"] for x in model_input(fake)["지원사업_후보"]]
    assert names == [LISTED]                                                                       # 운영 중 → 예비창업 공고 제외
    body = r.json()
    assert "청년 창업 바우처" not in body["answer"] and "조건에 맞는 지원사업" in body["answer"]
    assert body["fields"] == ["종합.점수"]


def test_without_support_no_candidates_key(client):
    fake = FakeCompleter()
    c = client(fake, FixedSupport([], enabled=False))
    assert c.post("/summary", json=BUPYEONG).status_code == 200
    assert "지원사업_후보" not in model_input(fake)
