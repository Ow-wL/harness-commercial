"""
AI 요약·자유 질문 (TASKS 13-23~13-27, 계획 2026-10-30 5장 — 12-23 결정 유지·확장).

  POST /summary  분석 자료로 좋은 점·주의할 점·결정 전 확인할 것(각 항목에 근거 필드)  — 조건 캐시
  POST /ask      그 분석 자료 안에서만 답하는 자유 질문(최근 6턴)                  — 캐시 없음
- 모델: Claude Sonnet 5.5(`claude-sonnet-5-5`, 2026-10-29 사용자 결정). 거절 응답(`stop_reason == "refusal"`)은 서버측 fallback
  (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`)으로 다른 모델이 이어 받는다. 응답 형식은 JSON 스키마(output_config.format).
- 키: 환경변수 ANTHROPIC_API_KEY(운영은 Cloud Run Secret). 없으면 기능을 끈다(/health ai.enabled=false, 두 엔드포인트 503 ai_unavailable)
  — 화면은 R1 의 한 줄 결론 템플릿을 그대로 쓴다.
- 비용: 응답 usage 의 토큰 수 × 단가(아래 PRICES_PER_MTOK, 설정값)로 KST 월별 집계 → 월 예산(기본 $30, AI_MONTHLY_BUDGET_USD) 80% 에서
  경고 로그, 100% 에서 /ask 닫힘·/summary 는 캐시만. 집계·캐시·로그는 AI_STATE_DIR(기본 임시 폴더 아래) 디스크 파일 — 최대 인스턴스 1 전제
  (docs/ARCHITECTURE.md). Cloud Run 의 /tmp 는 인스턴스가 살아 있는 동안만 남는다(min 1 인스턴스라 보통 유지, 재배포 때 초기화).
- 제한: IP 당 KST 하루 /ask 10회, /summary 새 생성 20회(캐시 적중은 세지 않음). IP 는 메모리에서만 쓰고 저장·로그하지 않는다.
- 로그(13-27): 질문·답변·조건(업종·구·반경) 원문을 하루 파일(JSONL)로 30일 — 좌표·IP·식별자 없음. 30일 지난 파일은 쓰기 때 지운다.
- 금지(시스템 프롬프트): 자료에 없는 수치를 만들지 않는다, 성공 확률·매출·순위·추천·허가 판단을 말하지 않는다, 자료 밖 질문은 "이 자료로는
  답할 수 없어요" + 확인 방법. 점수는 바꾸지 않는다 — 엔진 결과를 읽기만 한다.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import tempfile
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Optional, Protocol

logger = logging.getLogger("backend.ai")

MODEL = "claude-sonnet-5-5"
FALLBACK_BETA = "server-side-fallback-2026-07-01"
PROMPT_VERSION = "r2-1"                       # 프롬프트·입력 모양을 바꾸면 올린다 — 요약 캐시 키에 들어간다
API_KEY_ENV = "ANTHROPIC_API_KEY"
BUDGET_ENV = "AI_MONTHLY_BUDGET_USD"
STATE_DIR_ENV = "AI_STATE_DIR"
DEFAULT_BUDGET_USD = 30.0
WARN_AT = 0.8
# $ / 100만 토큰 (Sonnet 5.5 공시가 2026-10 — 바뀌면 여기만 고친다). 캐시 쓰기는 입력의 1.25배
PRICES_PER_MTOK = {"input": 2.0, "output": 10.0, "cache_read": 0.20, "cache_write": 2.5}
ASK_PER_DAY = 10
SUMMARY_NEW_PER_DAY = 20
ANALYZE_PER_MINUTE = 30                       # 12-9 IP 제한(공개 API 남용 방지) — /analyze·/nearby-stores·/rank·/insights
LOG_KEEP_DAYS = 30
SUMMARY_CACHE_MAX = 256
MAX_QUESTION_CHARS = 300
MAX_TURN_CHARS = 1200
MAX_HISTORY_TURNS = 6
KST = timezone(timedelta(hours=9))


def kst_now() -> datetime:
    return datetime.now(KST)


# ─── 모델 호출 ────────────────────────────────────────────────────────────────

@dataclass
class AiResult:
    data: dict                                 # 스키마대로 파싱한 JSON
    usage: dict                                # input/output/cache_read/cache_write 토큰
    model: str                                 # 실제로 답한 모델(fallback 이면 다를 수 있다)


class AiRefused(Exception):
    """fallback 까지 거절(stop_reason == refusal) — 사용자에게는 '답할 수 없는 질문'으로 알린다."""


class AiUpstreamError(Exception):
    """모델 응답 없음·형식 불일치·API 오류. 메시지에 질문 원문을 넣지 않는다."""


class Completer(Protocol):
    def __call__(self, system: str, messages: list[dict], schema: dict, max_tokens: int) -> AiResult: ...


def anthropic_completer(api_key: str) -> Completer:
    """Anthropic Python SDK(1.x)로 부른다. 테스트는 가짜 Completer 를 주입한다."""
    import anthropic

    client = anthropic.Anthropic(api_key=api_key, timeout=30.0, max_retries=2)

    def complete(system: str, messages: list[dict], schema: dict, max_tokens: int) -> AiResult:
        try:
            response = client.beta.messages.create(
                model=MODEL,
                max_tokens=max_tokens,
                betas=[FALLBACK_BETA],
                fallbacks="default",
                # 시스템 프롬프트는 요청마다 같다 — 캐시(앞부분 일치)로 입력 비용을 줄인다
                system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
                messages=messages,
                output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
            )
        except anthropic.RateLimitError as e:
            raise AiUpstreamError("rate_limited") from e
        except anthropic.APIStatusError as e:
            raise AiUpstreamError(f"status_{e.status_code}") from e
        except anthropic.APIConnectionError as e:
            raise AiUpstreamError("connection") from e
        if response.stop_reason == "refusal":
            raise AiRefused()
        text = next((b.text for b in response.content if b.type == "text"), None)
        if text is None:
            raise AiUpstreamError(f"no_text_{response.stop_reason}")
        try:
            data = json.loads(text)
        except json.JSONDecodeError as e:
            raise AiUpstreamError("bad_json") from e
        u = response.usage
        usage = {"input": u.input_tokens or 0, "output": u.output_tokens or 0,
                 "cache_read": getattr(u, "cache_read_input_tokens", 0) or 0,
                 "cache_write": getattr(u, "cache_creation_input_tokens", 0) or 0}
        return AiResult(data=data, usage=usage, model=response.model)

    return complete


def cost_usd(usage: dict) -> float:
    return sum(usage.get(k, 0) * PRICES_PER_MTOK[k] for k in PRICES_PER_MTOK) / 1_000_000


# ─── 디스크 상태(예산·요약 캐시·로그) ─────────────────────────────────────────

class StateStore:
    """AI_STATE_DIR 아래 JSON·JSONL 파일. 실패해도 기능은 계속된다(메모리 값 유지, 경고 로그)."""

    def __init__(self, root: Path):
        self.root = root
        self.lock = threading.Lock()
        try:
            self.root.mkdir(parents=True, exist_ok=True)
        except OSError:
            logger.warning("AI 상태 폴더를 만들 수 없다 — 메모리만 쓴다")

    def read_json(self, name: str, default: Any) -> Any:
        try:
            return json.loads((self.root / name).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return default

    def write_json(self, name: str, value: Any) -> None:
        try:
            tmp = self.root / f".{name}.tmp"
            tmp.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
            os.replace(tmp, self.root / name)
        except OSError:
            logger.warning("AI 상태 파일 쓰기 실패: %s", name)

    def append_log(self, record: dict, now: datetime) -> None:
        """13-27: 하루 파일에 한 줄. 30일 지난 파일은 지운다. 좌표·IP 는 record 에 넣지 않는다(호출자 책임 + 테스트)."""
        try:
            with (self.root / f"ai-log-{now:%Y-%m-%d}.jsonl").open("a", encoding="utf-8") as f:
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
            cutoff = (now - timedelta(days=LOG_KEEP_DAYS)).strftime("%Y-%m-%d")
            for p in self.root.glob("ai-log-*.jsonl"):
                if p.stem[len("ai-log-"):] < cutoff:
                    p.unlink(missing_ok=True)
        except OSError:
            logger.warning("AI 로그 쓰기 실패")


class Budget:
    """KST 월별 비용 집계. state: {"month": "2026-11", "usd": 1.23, "warned": false}"""

    FILE = "budget.json"

    def __init__(self, store: StateStore, limit_usd: float, clock: Callable[[], datetime] = kst_now):
        self.store, self.limit, self.clock = store, limit_usd, clock
        self.lock = threading.Lock()
        self.state = store.read_json(self.FILE, {})

    def _current(self) -> dict:
        month = self.clock().strftime("%Y-%m")
        if self.state.get("month") != month:
            self.state = {"month": month, "usd": 0.0, "warned": False}
        return self.state

    def add(self, usd: float) -> None:
        with self.lock:
            s = self._current()
            s["usd"] = round(float(s.get("usd", 0.0)) + usd, 6)
            if not s.get("warned") and s["usd"] >= WARN_AT * self.limit:
                s["warned"] = True
                logger.warning("AI 월 예산 %d%% 도달 (%s)", int(WARN_AT * 100), s["month"])
            self.store.write_json(self.FILE, s)

    def level(self) -> str:
        """ok | warn | closed"""
        with self.lock:
            usd = float(self._current().get("usd", 0.0))
        if usd >= self.limit:
            return "closed"
        return "warn" if usd >= WARN_AT * self.limit else "ok"


class DailyLimiter:
    """IP 당 하루(KST) 횟수. IP 는 원문 대신 프로세스 비밀값으로 만든 해시를 메모리에만 둔다."""

    def __init__(self, clock: Callable[[], datetime] = kst_now):
        self.clock = clock
        self.lock = threading.Lock()
        self.salt = os.urandom(16)
        self.day = ""
        self.counts: dict[tuple[str, str], int] = {}

    def _key(self, ip: str) -> str:
        return hashlib.sha256(self.salt + ip.encode("utf-8")).hexdigest()[:16]

    def take(self, kind: str, ip: str, limit: int) -> bool:
        with self.lock:
            day = self.clock().strftime("%Y-%m-%d")
            if day != self.day:
                self.day, self.counts = day, {}
            k = (kind, self._key(ip))
            if self.counts.get(k, 0) >= limit:
                return False
            self.counts[k] = self.counts.get(k, 0) + 1
            return True


class MinuteLimiter:
    """12-9: IP 당 분당 횟수(고정 창). 메모리만, 해시 키."""

    def __init__(self, limit: int, clock: Callable[[], float] = time.monotonic):
        self.limit, self.clock = limit, clock
        self.lock = threading.Lock()
        self.salt = os.urandom(16)
        self.window = -1
        self.counts: dict[str, int] = {}

    def allow(self, ip: str) -> bool:
        with self.lock:
            w = int(self.clock() // 60)
            if w != self.window:
                self.window, self.counts = w, {}
            k = hashlib.sha256(self.salt + ip.encode("utf-8")).hexdigest()[:16]
            self.counts[k] = self.counts.get(k, 0) + 1
            return self.counts[k] <= self.limit


class SummaryCache:
    """조건 키 → 요약 JSON. 메모리 LRU + 디스크 파일(재시작 뒤에도 남게)."""

    FILE = "summary-cache.json"

    def __init__(self, store: StateStore, max_items: int = SUMMARY_CACHE_MAX):
        self.store, self.max = store, max_items
        self.lock = threading.Lock()
        raw = store.read_json(self.FILE, [])
        self.items: OrderedDict[str, dict] = OrderedDict((k, v) for k, v in raw if isinstance(k, str)) if isinstance(raw, list) else OrderedDict()

    def get(self, key: str) -> Optional[dict]:
        with self.lock:
            v = self.items.get(key)
            if v is not None:
                self.items.move_to_end(key)
            return v

    def put(self, key: str, value: dict) -> None:
        with self.lock:
            self.items[key] = value
            self.items.move_to_end(key)
            while len(self.items) > self.max:
                self.items.popitem(last=False)
            self.store.write_json(self.FILE, list(self.items.items()))


# ─── 프롬프트·스키마 ──────────────────────────────────────────────────────────

SYSTEM_PROMPT = """당신은 인천 상권분석 웹 서비스의 설명 도우미다. 사용자가 고른 한 위치·한 업종의 분석 자료(JSON)만 근거로 한국어로 쉽게 설명한다.

지켜야 할 것:
- 자료에 있는 값만 쓴다. 자료에 없는 수치·사실을 만들거나 추정하지 않는다. 숫자를 쓸 때는 자료의 값을 그대로 옮긴다.
- 점수는 인천 동네들 사이의 상대 위치를 나타내는 참고 지표다. 성공 확률, 매출·수익 예측, 업종·위치의 순위 매기기, 추천, 영업 허가 가능 여부 판단을 말하지 않는다.
- 학교 주변 규제처럼 법·인허가가 걸린 내용은 "관할 기관에 확인하라"고만 안내한다.
- 자료가 비어 있거나 "산출 불가"인 항목은 그 사실을 그대로 말하고 다른 값으로 채우지 않는다.
- 각 항목의 fields 에는 근거로 쓴 자료 키(예: "지표.competition.raw.동종점포수", "종합.점수", "insights.inflow")를 적는다.
- 질문이 이 자료로 답할 수 없는 내용이면 out_of_scope 를 true 로 하고, 답에는 "이 자료로는 답할 수 없어요"와 직접 확인할 방법(현장 확인, 관할 기관, 공고 원문 등)을 짧게 쓴다.
- 문장은 짧게, 존댓말로 쓴다."""

_ITEM = {"type": "object", "properties": {"text": {"type": "string"}, "fields": {"type": "array", "items": {"type": "string"}}},
         "required": ["text", "fields"], "additionalProperties": False}
SUMMARY_SCHEMA = {
    "type": "object",
    "properties": {"good": {"type": "array", "items": _ITEM}, "bad": {"type": "array", "items": _ITEM},
                   "check": {"type": "array", "items": _ITEM}},
    "required": ["good", "bad", "check"],
    "additionalProperties": False,
}
STAGES = ["예비", "1년 미만", "운영 중"]
PREFERRED = ["여성", "장애인", "다문화", "중장년", "재창업"]
ASK_SCHEMA = {
    "type": "object",
    "properties": {
        "answer": {"type": "string"},
        "fields": {"type": "array", "items": {"type": "string"}},
        "out_of_scope": {"type": "boolean"},
        "profile_suggestion": {
            "anyOf": [
                {"type": "null"},
                {"type": "object",
                 "properties": {"stage": {"anyOf": [{"type": "null"}, {"type": "string", "enum": STAGES}]},
                                "youth": {"anyOf": [{"type": "null"}, {"type": "boolean"}]},
                                "preferred": {"anyOf": [{"type": "null"}, {"type": "array", "items": {"type": "string", "enum": PREFERRED}}]}},
                 "required": ["stage", "youth", "preferred"], "additionalProperties": False},
            ]
        },
    },
    "required": ["answer", "fields", "out_of_scope", "profile_suggestion"],
    "additionalProperties": False,
}

SUMMARY_TASK = ("위 자료로 이 자리를 설명해 주세요. good 에 좋은 점 2~3개, bad 에 약한 점·주의할 점 1~3개, check 에 창업 결정 전에 "
                "현장에서 확인할 것 2개를 쓰세요. 각 항목은 한 문장입니다.")
ASK_TASK = ("아래 대화의 마지막 질문에 위 자료로만 답하세요. 답은 3~5문장. 사용자의 창업 단계·청년 여부·우대 조건이 대화에서 새로 드러나면 "
            "profile_suggestion 에 적고, 아니면 null 로 두세요. 자료로 답할 수 없으면 out_of_scope 를 true 로.")


def context_json(analysis: dict, context: dict, insights: Optional[dict], rank_top: Optional[list], profile: Optional[dict]) -> str:
    """모델 입력 자료. 좌표는 넣지 않는다(구·동 이름만). 엔진 결과는 고치지 않고 필요한 키만 옮긴다."""
    payload = {
        "위치": {"구": context.get("gu_name"), "동": context.get("dong_name")},
        "업종": analysis["meta"].get("업종"),
        "분석반경_m": analysis["meta"].get("분석반경_m"),
        "엔진": analysis["meta"].get("엔진버전"),
        "종합": analysis.get("종합"),
        "지표": {i["key"]: {"label": i.get("label"), "score": i.get("score"), "raw": i.get("raw"), "missing": i.get("missing"),
                            "flags": i.get("flags")} for i in analysis.get("지표", [])},
        "경고": analysis.get("경고"),
        "면책": analysis.get("면책"),
    }
    if insights:
        payload["insights"] = {"inflow_gu": (insights.get("inflow") or {}).get("gu_name"),
                               "by_hour": (insights.get("inflow") or {}).get("by_hour"),
                               "hours_profile_note": insights.get("hours_profile_note")}
    if rank_top:
        payload["같은자리_업종점수_상위"] = rank_top
    if profile:
        payload["사용자_프로필"] = profile
    return json.dumps(payload, ensure_ascii=False, default=str)


def clean_items(items: Any, limit: int) -> list[dict]:
    out = []
    for it in items if isinstance(items, list) else []:
        if isinstance(it, dict) and isinstance(it.get("text"), str) and it["text"].strip():
            fields = [f for f in it.get("fields", []) if isinstance(f, str)][:6]
            out.append({"text": it["text"].strip()[:300], "fields": fields})
    return out[:limit]


# ─── 서비스 ───────────────────────────────────────────────────────────────────

@dataclass
class AiService:
    complete: Optional[Completer]
    store: StateStore
    budget: Budget
    limiter: DailyLimiter = field(default_factory=DailyLimiter)
    cache: Optional[SummaryCache] = None
    clock: Callable[[], datetime] = kst_now

    def __post_init__(self):
        if self.cache is None:
            self.cache = SummaryCache(self.store)

    @property
    def enabled(self) -> bool:
        return self.complete is not None

    @classmethod
    def from_env(cls, complete: Optional[Completer] = None, state_dir: Optional[str] = None) -> "AiService":
        root = Path(state_dir or os.environ.get(STATE_DIR_ENV) or Path(tempfile.gettempdir()) / "harness-ai")
        store = StateStore(root)
        try:
            limit = float(os.environ.get(BUDGET_ENV, DEFAULT_BUDGET_USD))
        except ValueError:
            limit = DEFAULT_BUDGET_USD
        if complete is None:
            key = os.environ.get(API_KEY_ENV, "").strip()
            complete = anthropic_completer(key) if key else None
        return cls(complete=complete, store=store, budget=Budget(store, limit))

    def health(self) -> dict:
        return {"enabled": self.enabled, "model": MODEL if self.enabled else None,
                "budget": self.budget.level() if self.enabled else None}

    def call(self, task: str, ctx: str, turns: list[dict], schema: dict, max_tokens: int) -> AiResult:
        assert self.complete is not None
        messages = [{"role": "user", "content": f"분석 자료(JSON):\n{ctx}\n\n{task}"}]
        if turns:
            messages[0]["content"] += "\n\n대화:\n" + "\n".join(f"{'사용자' if t['role'] == 'user' else '도우미'}: {t['content']}" for t in turns)
        result = self.complete(SYSTEM_PROMPT, messages, schema, max_tokens)
        self.budget.add(cost_usd(result.usage))
        return result
