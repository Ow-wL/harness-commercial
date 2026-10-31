"""
지원사업 공고 수집·캐시 (TASKS 13-31, docs/SUPPORT_PROGRAMS.md, D-039).

자료원 두 개를 하루 1회 받아 같은 모양(Program)으로 바꾸고, 인천·전국 공고만 남겨 합친 뒤 디스크 캐시에 둔다.
  - 기업마당 지원사업정보 API(중소벤처기업부) — 환경변수 BIZINFO_API_KEY (운영 Secret bizinfo-api-key)
  - 창업진흥원 K-Startup 사업공고(공공데이터포털) — 환경변수 DATA_GO_KR_API_KEY (Secret data-go-kr-api-key, Decoding 키)
키가 없는 자료원은 건너뛴다. 둘 다 없으면 기능 꺼짐(/health support.enabled=false).

- 지역: 기업마당 해시태그의 시도 이름(전국 공고는 17개 모두 — 10개 이상이면 nationwide, regions 비움), K-Startup supt_regin.
- 실측(2026-11-01)에서 명세와 달랐던 점을 따른다: 기업마당 해시태그 필드는 `hashtags`, 신청기간은 `YYYY-MM-DD ~ YYYY-MM-DD`
  (72%는 "예산 소진시까지" 같은 글 — 날짜가 없으면 end=None, 원문 period_text 를 그대로 보인다).
- 이용 조건(SUPPORT_PROGRAMS 3절): 공고명·기관·대상·신청기간·링크는 원문 그대로, 사업개요는 태그만 지운 원문 발췌(앞 300자).
  출처(source)를 공고마다 남겨 화면이 "출처: 기업마당 / K-Startup"을 표기한다.
- 중복: 두 자료에 공통 ID 가 없다 → 공고명 정규화(괄호·연도·기호 제거)가 같거나 한쪽이 다른 쪽을 포함(8자 넘게)하면서
  마감일이 같거나 한쪽이 날짜 없음이면 같은 공고로 보고 기업마당 쪽을 남긴다(sources 에 둘 다).
- 실패: 자료원마다 따로. 받기 실패·형식 오류면 그 자료원의 지난 캐시 공고를 그대로 쓰고 sources[...].ok=false 로 광고한다.
  캐시는 SUPPORT_STATE_DIR(기본 임시 폴더 아래 harness-support/support-programs.json) — Cloud Run 은 인스턴스 수명 동안만 남는다
  (재시작 때 다시 받는다). 쓰기는 임시 파일 → 교체.
- 키는 URL 에 들어가므로 URL·응답 원문을 로그에 남기지 않는다. 로그는 자료원·상태 코드·건수·소요 시간뿐.
- 지난 공고(마감일 < 오늘 KST)는 모을 때와 읽을 때 모두 뺀다. 매칭(지역×대상×업종×마감)은 13-32.
"""
from __future__ import annotations

import html
import json
import logging
import os
import re
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Callable, Optional

from .ai import KST, kst_now

logger = logging.getLogger("backend.support")

BIZINFO_URL = "https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do"
KSTARTUP_URL = "https://apis.data.go.kr/B552735/kisedKstartupService01/getAnnouncementInformation01"
BIZINFO_KEY_ENV = "BIZINFO_API_KEY"
DATA_GO_KR_KEY_ENV = "DATA_GO_KR_API_KEY"
STATE_DIR_ENV = "SUPPORT_STATE_DIR"
CACHE_FILE = "support-programs.json"
CACHE_VERSION = 1
REFRESH_EVERY = timedelta(hours=24)
RETRY_AFTER_FAILURE = timedelta(hours=1)        # 성공한 뒤 다시 시도하지 않는 최소 간격(하루 1회 수집은 REFRESH_EVERY)
RETRY_BACKOFF = (timedelta(minutes=5), timedelta(minutes=15), timedelta(hours=1))   # 연속 실패 1·2·3회 이상(v0.3.1)
TIMEOUT_S = 60.0
KSTARTUP_PAGE = 500
KSTARTUP_MAX_PAGES = 10
SUMMARY_CHARS = 300
REGION = "인천"
REGIONS = ("서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원", "충북", "충남", "전북", "전남",
           "경북", "경남", "제주", "전남광주")
SOURCES = ("bizinfo", "kstartup")
NATIONWIDE_MIN_REGIONS = 10              # 기업마당 전국 공고는 17개 시도 해시태그를 모두 단다(실측) — 10개 이상이면 전국으로 본다

_TAG = re.compile(r"<[^>]+>")
_SPACE = re.compile(r"\s+")
_RANGE_DASH = re.compile(r"(\d{4})-?(\d{2})-?(\d{2})\s*~\s*(\d{4})-?(\d{2})-?(\d{2})")


@dataclass
class Program:
    """정규화한 공고 한 건. 값은 원문 그대로(공백·태그 정리만)."""
    id: str                                 # "<source>:<원 ID>"
    source: str                             # bizinfo | kstartup
    title: str
    agency: str                             # 소관·공고 기관
    operator: Optional[str]                 # 수행기관
    targets: list[str]                      # 지원대상(기업마당 trgetNm 한 값 / K-Startup aply_trgt 목록)
    category: Optional[str]                 # 지원분야(기업마당 대분류 / K-Startup 지원사업 분류)
    regions: list[str]                      # 지역(인천·전국 등)
    nationwide: bool
    period_text: str                        # 신청기간 원문
    start: Optional[str]                    # YYYY-MM-DD (날짜가 있을 때만)
    end: Optional[str]
    url: str                                # 공고 상세
    apply_url: Optional[str]
    summary: Optional[str]                  # 사업개요 원문 발췌(태그 제거, 앞 SUMMARY_CHARS 자)
    keywords: list[str] = field(default_factory=list)      # 기업마당 해시태그(지역 제외)
    startup_period: Optional[str] = None    # K-Startup 창업 기간(biz_enyy)
    ages: Optional[str] = None              # K-Startup 대상 연령(biz_trgt_age)
    sources: list[str] = field(default_factory=list)       # 중복 합칠 때 모든 출처


class SupportSourceError(Exception):
    """자료원 받기·형식 오류. 메시지에 키·URL 을 넣지 않는다."""


# fetch(url, params) -> (status, body_bytes). 테스트는 가짜를 주입한다
Fetch = Callable[[str, dict[str, Any]], tuple[int, bytes]]


def urllib_fetch(url: str, params: dict[str, Any]) -> tuple[int, bytes]:
    req = urllib.request.Request(f"{url}?{urllib.parse.urlencode(params)}", headers={"User-Agent": "harness-commercial"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as res:   # noqa: S310 — 고정 https 주소
            return res.status, res.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def clean(text: Any) -> str:
    return _SPACE.sub(" ", html.unescape(_TAG.sub(" ", str(text or "")))).strip()


def _iso(y: str, m: str, d: str) -> Optional[str]:
    try:
        return date(int(y), int(m), int(d)).isoformat()
    except ValueError:
        return None


def parse_period(text: str) -> tuple[Optional[str], Optional[str]]:
    """"2026-10-28 ~ 2026-11-11"·"20261028 ~ 20261111" → (시작, 끝). 날짜 범위가 아니면 (None, None)."""
    m = _RANGE_DASH.search(text or "")
    if not m:
        return None, None
    return _iso(*m.group(1, 2, 3)), _iso(*m.group(4, 5, 6))


def _ymd(value: Any) -> Optional[str]:
    s = re.sub(r"\D", "", str(value or ""))
    return _iso(s[:4], s[4:6], s[6:8]) if len(s) >= 8 else None


def _summary(text: Any) -> Optional[str]:
    s = clean(text)
    return (s[:SUMMARY_CHARS] + "…" if len(s) > SUMMARY_CHARS else s) or None


def _json(body: bytes) -> Any:
    try:
        return json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as e:
        raise SupportSourceError("response not json") from e


def parse_bizinfo(body: bytes) -> list[Program]:
    data = _json(body)
    if not isinstance(data, dict):
        raise SupportSourceError("response shape")
    if "reqErr" in data:
        raise SupportSourceError("reqErr")                     # 메시지(키 오류 등)는 그대로 옮기지 않는다
    arr = data.get("jsonArray")
    items = arr if isinstance(arr, list) else (arr or {}).get("item") if isinstance(arr, dict) else None
    if not isinstance(items, list):
        raise SupportSourceError("response shape")
    out = []
    for it in items:
        if not isinstance(it, dict) or not it.get("pblancId") or not it.get("pblancNm"):
            continue
        tags = [t.strip() for t in str(it.get("hashtags") or it.get("hashTags") or "").split(",") if t.strip()]
        regions = [t for t in tags if t in REGIONS]
        nationwide = not regions or len(set(regions)) >= NATIONWIDE_MIN_REGIONS
        period = clean(it.get("reqstBeginEndDe") or it.get("reqstDt"))
        start, end = parse_period(period)
        target = clean(it.get("trgetNm"))
        out.append(Program(
            id=f"bizinfo:{it['pblancId']}", source="bizinfo", title=clean(it["pblancNm"]),
            agency=clean(it.get("jrsdInsttNm")), operator=clean(it.get("excInsttNm")) or None,
            targets=[target] if target else [], category=clean(it.get("pldirSportRealmLclasCodeNm")) or None,
            regions=[] if nationwide else regions, nationwide=nationwide, period_text=period, start=start, end=end,
            url=clean(it.get("pblancUrl")), apply_url=clean(it.get("rceptEngnHmpgUrl")) or None,
            summary=_summary(it.get("bsnsSumryCn")),
            keywords=[t for t in tags if t not in REGIONS and not re.fullmatch(r"\d{4}", t)]))
    return out


def parse_kstartup(items: list[Any]) -> list[Program]:
    out = []
    for it in items:
        if not isinstance(it, dict) or not it.get("pbanc_sn") or not it.get("biz_pbanc_nm"):
            continue
        region = clean(it.get("supt_regin"))
        start, end = _ymd(it.get("pbanc_rcpt_bgng_dt")), _ymd(it.get("pbanc_rcpt_end_dt"))
        raw_start, raw_end = clean(it.get("pbanc_rcpt_bgng_dt")), clean(it.get("pbanc_rcpt_end_dt"))
        out.append(Program(
            id=f"kstartup:{it['pbanc_sn']}", source="kstartup", title=clean(it["biz_pbanc_nm"]),
            agency=clean(it.get("pbanc_ntrp_nm")), operator=clean(it.get("sprv_inst")) or None,
            targets=[t.strip() for t in clean(it.get("aply_trgt")).split(",") if t.strip()],
            category=clean(it.get("supt_biz_clsfc")) or None,
            regions=[] if region in ("", "전국") else [region], nationwide=region in ("", "전국"),
            period_text=f"{raw_start} ~ {raw_end}".strip(" ~"), start=start, end=end,
            url=clean(it.get("detl_pg_url")), apply_url=clean(it.get("biz_aply_url")) or None,
            summary=_summary(it.get("pbanc_ctnt")),
            startup_period=clean(it.get("biz_enyy")) or None, ages=clean(it.get("biz_trgt_age")) or None))
    return out


def relevant(p: Program, today: date) -> bool:
    """인천 또는 전국 공고이고 마감이 지나지 않았다(날짜 없는 공고는 남긴다)."""
    if not (p.nationwide or REGION in p.regions):
        return False
    return p.end is None or p.end >= today.isoformat()


def norm_title(title: str) -> str:
    s = re.sub(r"\[[^\]]*\]|\([^)]*\)|<[^>]*>|20\d\d\s*년?\s*도?", " ", title or "")
    return re.sub(r"[^0-9A-Za-z가-힣]", "", s)


def _same(a: Program, b: Program) -> bool:
    x, y = norm_title(a.title), norm_title(b.title)
    if not x or not y:
        return False
    if x != y and not (min(len(x), len(y)) > 8 and (x in y or y in x)):
        return False
    return a.end is None or b.end is None or a.end == b.end


def merge(groups: dict[str, list[Program]]) -> list[Program]:
    """자료원 순서(SOURCES)대로 합친다. 뒤 자료원의 같은 공고는 앞 공고의 sources 에만 더한다."""
    out: list[Program] = []
    for source in SOURCES:
        for p in groups.get(source, []):
            p.sources = sorted(set(p.sources) | {p.source})
            dup = next((q for q in out if q.source != p.source and _same(q, p)), None)
            if dup is not None:
                dup.sources = sorted(set(dup.sources) | {p.source})
            else:
                out.append(p)
    # 마감 가까운 날짜 공고 먼저, 날짜 없는 공고는 뒤(같으면 제목순) — 화면·매칭이 다시 정렬할 수 있다
    out.sort(key=lambda p: (p.end is None, p.end or "", p.title))
    return out


class SupportService:
    """자료원별 수집 → 합치기 → 디스크 캐시. 읽기(programs·health)는 메모리 스냅샷만 본다."""

    def __init__(self, bizinfo_key: Optional[str], data_go_kr_key: Optional[str], state_dir: Path,
                 fetch: Fetch = urllib_fetch, clock: Callable[[], datetime] = kst_now):
        self.keys = {"bizinfo": (bizinfo_key or "").strip() or None, "kstartup": (data_go_kr_key or "").strip() or None}
        self.path = Path(state_dir) / CACHE_FILE
        self.fetch = fetch
        self.clock = clock
        self.lock = threading.Lock()
        self.refresh_lock = threading.Lock()
        self.stop = threading.Event()
        self.thread: Optional[threading.Thread] = None
        self.state: dict[str, Any] = {"as_of": None, "sources": {}, "programs": []}
        self.last_attempt: Optional[datetime] = None
        self.failures = 0                           # 자료원 하나라도 실패한 연속 수집 횟수(성공하면 0)
        if self.enabled:                            # 키가 없는 앱은 예전 캐시가 있어도 광고하지 않는다
            self._load()

    @classmethod
    def from_env(cls, state_dir: Optional[str] = None, **kw) -> "SupportService":
        root = Path(state_dir or os.environ.get(STATE_DIR_ENV) or Path(tempfile.gettempdir()) / "harness-support")
        return cls(os.environ.get(BIZINFO_KEY_ENV), os.environ.get(DATA_GO_KR_KEY_ENV), root, **kw)

    @property
    def enabled(self) -> bool:
        return any(self.keys.values())

    # ── 캐시 ──
    def _load(self) -> None:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            if data.get("version") != CACHE_VERSION:
                return
            data["programs"] = [Program(**p) for p in data.get("programs", [])]
            self.state = {"as_of": data.get("as_of"), "sources": data.get("sources", {}), "programs": data["programs"]}
        except FileNotFoundError:
            return
        except (OSError, ValueError, TypeError, KeyError):
            logger.warning("support cache unreadable — ignored")

    def _save(self, state: dict[str, Any]) -> None:
        payload = {"version": CACHE_VERSION, "as_of": state["as_of"], "sources": state["sources"],
                   "programs": [asdict(p) for p in state["programs"]]}
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            os.replace(tmp, self.path)
        except OSError:
            logger.warning("support cache write failed — memory only")

    # ── 수집 ──
    def _get(self, source: str, url: str, params: dict[str, Any]) -> bytes:
        started = time.perf_counter()
        try:
            status, body = self.fetch(url, params)
        except Exception as e:                      # noqa: BLE001 — 네트워크·타임아웃 종류를 가리지 않는다
            reason = str(getattr(e, "reason", "") or e)[:120]          # 예: timed out — URL(키 포함)은 넣지 않는다
            logger.warning("support %s request failed %s: %s", source, type(e).__name__, reason)
            raise SupportSourceError("request failed") from e
        logger.info("support %s status %s %d bytes (%.0fms)", source, status, len(body), (time.perf_counter() - started) * 1000)
        if status != 200:
            raise SupportSourceError(f"status {status}")
        return body

    def _collect_bizinfo(self) -> list[Program]:
        body = self._get("bizinfo", BIZINFO_URL, {"crtfcKey": self.keys["bizinfo"], "dataType": "json", "searchCnt": "0"})
        return parse_bizinfo(body)

    def _collect_kstartup(self) -> list[Program]:
        items: list[Any] = []
        for page in range(1, KSTARTUP_MAX_PAGES + 1):
            body = self._get("kstartup", KSTARTUP_URL, {"serviceKey": self.keys["kstartup"], "page": page,
                                                        "perPage": KSTARTUP_PAGE, "returnType": "json",
                                                        "cond[rcrt_prgs_yn::EQ]": "Y"})
            data = _json(body)
            rows = data.get("data") if isinstance(data, dict) else None
            if not isinstance(rows, list):
                raise SupportSourceError("response shape")
            items += rows
            if len(rows) < KSTARTUP_PAGE:
                break
        return parse_kstartup(items)

    def refresh(self) -> dict[str, Any]:
        """모든 자료원을 다시 받는다. 실패한 자료원은 지난 공고를 그대로 쓴다. 동시에 한 번만."""
        with self.refresh_lock:
            now = self.clock()
            self.last_attempt = now
            today = now.astimezone(KST).date()
            prev = self.programs_by_source()
            prev_sources = dict(self.state.get("sources", {}))
            groups: dict[str, list[Program]] = {}
            sources: dict[str, Any] = {}
            collectors = {"bizinfo": self._collect_bizinfo, "kstartup": self._collect_kstartup}
            for source in SOURCES:
                if not self.keys[source]:
                    continue
                try:
                    got = [p for p in collectors[source]() if relevant(p, today)]
                    groups[source] = got
                    sources[source] = {"ok": True, "count": len(got), "fetched_at": now.isoformat(timespec="seconds"), "error": None}
                except SupportSourceError as e:
                    groups[source] = [p for p in prev.get(source, []) if relevant(p, today)]
                    old = prev_sources.get(source) or {}
                    sources[source] = {"ok": False, "count": len(groups[source]), "fetched_at": old.get("fetched_at"),
                                       "error": str(e)}
                    logger.warning("support %s failed (%s) — keeping %d cached", source, e, len(groups[source]))
            state = {"as_of": now.isoformat(timespec="seconds"), "sources": sources, "programs": merge(groups)}
            self.failures = self.failures + 1 if any(not v["ok"] for v in sources.values()) else 0
            with self.lock:
                self.state = state
            self._save(state)
            return state

    def programs_by_source(self) -> dict[str, list[Program]]:
        out: dict[str, list[Program]] = {}
        for p in self.state.get("programs", []):
            # 합쳐진 공고는 원래 자료원 쪽에 둔다(다른 자료원 실패 때 그 공고는 남은 쪽 결과로만 보인다)
            out.setdefault(p.source, []).append(Program(**{**asdict(p), "sources": [p.source]}))
        return out

    def programs(self) -> list[Program]:
        """지금 쓸 공고(마감 지난 것 제외). 매칭(13-32)이 이 목록을 거른다."""
        today = self.clock().astimezone(KST).date()
        with self.lock:
            return [p for p in self.state.get("programs", []) if relevant(p, today)]

    def due(self) -> bool:
        """다시 받을 때인가: 캐시가 없거나 하루 지났거나 실패한 자료원이 있다. 마지막 시도 뒤 간격은 성공이면 1시간,
        실패가 이어지면 5분 → 15분 → 1시간(v0.3.1 — 인스턴스 시작 때 외부 연결이 잠깐 안 돼도 카드가 오래 비지 않게)."""
        if not self.enabled:
            return False
        now = self.clock()
        gap = RETRY_BACKOFF[min(self.failures, len(RETRY_BACKOFF)) - 1] if self.failures else RETRY_AFTER_FAILURE
        if self.last_attempt is not None and now - self.last_attempt < gap:
            return False
        as_of = self.state.get("as_of")
        if not as_of:
            return True
        try:
            age = now - datetime.fromisoformat(as_of)
        except ValueError:
            return True
        failed = any(not s.get("ok") for s in self.state.get("sources", {}).values())
        missing = any(self.keys[s] and s not in self.state.get("sources", {}) for s in SOURCES)
        return age >= REFRESH_EVERY or failed or missing

    def health(self) -> dict[str, Any]:
        with self.lock:
            src = self.state.get("sources", {})
            return {"enabled": self.enabled, "as_of": self.state.get("as_of"), "count": len(self.state.get("programs", [])),
                    "sources": {s: {"enabled": bool(self.keys[s]), "ok": (src.get(s) or {}).get("ok"),
                                    "count": (src.get(s) or {}).get("count", 0)} for s in SOURCES}}

    # ── 백그라운드 ──
    def run(self, check_every_s: float = 60.0) -> None:
        while not self.stop.is_set():
            if self.due():
                try:
                    self.refresh()
                except Exception:                    # noqa: BLE001 — 수집 실패가 앱을 멈추지 않게
                    logger.exception("support refresh crashed")
            self.stop.wait(check_every_s)

    def start(self) -> None:
        if not self.enabled or self.thread is not None:
            return
        self.thread = threading.Thread(target=self.run, name="support-refresh", daemon=True)
        self.thread.start()

    def shutdown(self, timeout_s: float = 5.0) -> None:
        self.stop.set()
        if self.thread is not None:
            self.thread.join(timeout=timeout_s)
