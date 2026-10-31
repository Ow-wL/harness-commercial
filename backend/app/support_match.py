"""
지원사업 "조건에 맞는 공고" 규칙 매칭 (TASKS 13-32, D-039). 규칙 표 = support_rules.json.

입력: 수집된 공고(support.SupportService.programs — 이미 인천·전국·마감 전만), 업종 코드, 분석 위치의 구(선택), 프로필(선택).
1. 제외: 기업마당 분야 기술·수출 / 대상 제조업·사회적기업 등 / 공고명에 제조·R&D·수출 등 / K-Startup 대상이 학생·기관뿐 /
   전국 공고인데 공고명에 다른 시도 이름 / 인천 공고인데 공고명에 다른 구 이름(구를 줬을 때) /
   프로필을 준 칸만: 창업 단계가 맞지 않는 K-Startup 공고, 청년 아님인데 청년 전용, 고른 우대 조건과 다른 우대 전용 공고.
   (프로필 미입력 칸은 통과 — 계획 6.1)
2. 남은 공고 중 핵심 신호(소상공인·창업·업종·인천 공고+경영 계열 분야) 하나 이상인 것만.
3. 점수(규칙 표 points)를 더하고 행사·참관 공고(demote)는 깎아 높은 순 → 마감 가까운 순 → 공고명. 점수는 응답에 내보내지 않는다(순위·추천처럼 읽히지 않게) —
   대신 사람이 읽을 이유(reasons)를 준다. 마감 deadline_soon_days 일 이내는 deadline_soon.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

from .support import Program

RULES_PATH = Path(__file__).with_name("support_rules.json")
STAGE_REASON = {"예비": "예비창업자 대상", "1년 미만": "창업 1년 미만 대상", "운영 중": "운영 중 사업자 가능"}


@lru_cache(maxsize=1)
def load_rules(path: str = str(RULES_PATH)) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


@dataclass(frozen=True)
class MatchProfile:
    stage: Optional[str] = None
    youth: Optional[bool] = None
    preferred: tuple[str, ...] = ()


def biz_pattern(biz_code: str, biz_name: str, rules: dict[str, Any]) -> str:
    parts = [re.escape(t.strip()) for t in re.split(r"[/·]", biz_name) if len(t.strip()) >= 2]
    extra = rules.get("biz_extra_pattern", {}).get(biz_code)
    return "|".join(parts + ([extra] if extra else []))


def _gu_in(title: str, gus: list[str]) -> list[str]:
    alt = "|".join(sorted(map(re.escape, gus), key=len, reverse=True))     # 남동구가 동구보다 먼저
    return [m.group(0) for m in re.finditer(alt, title)]


def _other_place(title: str, names: str) -> bool:
    """괄호([ ]·( )·【 】) 안에 다른 지역 이름이 있거나, '서초구'·'수원시' 꼴로 쓰였는가"""
    brackets = " ".join(re.findall(r"[\[(（【]([^\])）】]*)[\])）】]", title))
    return bool(re.search(f"(?:{names})", brackets) or re.search(f"(?:{names})(?:시|구|군)(?![가-힣])", title))


def _youth_only(ages: Optional[str], y: dict[str, str]) -> bool:
    return bool(ages) and y["youth_only_age"] in ages and y["older_age"] not in ages


def match(programs: list[Program], biz_code: str, biz_name: str, gu: Optional[str], profile: Optional[MatchProfile],
          today: date, limit: Optional[int] = None, rules: Optional[dict[str, Any]] = None) -> tuple[int, list[dict[str, Any]]]:
    """(조건에 맞는 공고 수, 앞 limit 건). 각 건 = 공고 필드 + days_left·deadline_soon·reasons."""
    R = rules or load_rules()
    pts, ex = R["points"], R["exclude"]
    prof = profile or MatchProfile()
    limit = min(limit or R["limit_default"], R["limit_max"])
    biz_re = biz_pattern(biz_code, biz_name, R)
    family = next((f for f in R["families"] if biz_code.startswith(f["prefix"])), None)
    stage_rule = R["profile"]["stage"].get(prof.stage or "")
    y = R["profile"]["youth"]
    scored = []
    for p in programs:
        title = p.title
        text = " ".join([title, " ".join(p.keywords), p.summary or ""])
        # ── 1. 제외 ──
        if p.source == "bizinfo" and p.category in ex["bizinfo_categories"]:
            continue
        if any(t in ex["targets"] for t in p.targets) or re.search(ex["pattern"], title):
            continue
        if p.source == "kstartup" and p.targets and not any(t in ex["kstartup_need_any_target"] for t in p.targets):
            continue
        if p.nationwide and re.search(ex["other_region_in_title"], title):
            continue
        op = ex.get("other_place_in_title")
        if p.nationwide and op and _other_place(title, op["names"]):
            continue
        gus = _gu_in(title, R["incheon_gu"]) if not p.nationwide else []
        if gu and gus and gu not in gus:
            continue
        if stage_rule:
            periods = [s.strip() for s in (p.startup_period or "").split(",") if s.strip()]
            if "kstartup_enyy" in stage_rule and periods and stage_rule["kstartup_enyy"] not in periods:
                continue
            if "kstartup_enyy_not_only" in stage_rule and periods and not [s for s in periods if s != stage_rule["kstartup_enyy_not_only"]]:
                continue
            if "exclude_pattern" in stage_rule and re.search(stage_rule["exclude_pattern"], title):
                continue
        if prof.youth is False and (re.search(y["pattern"], title) or _youth_only(p.ages, y)):
            continue
        group_only = [g for g, r in R["profile"]["preferred"].items()
                      if any(t in r["targets"] for t in p.targets) or re.search(r["pattern"], title)]
        if prof.preferred and group_only and not set(group_only) & set(prof.preferred):
            continue
        # ── 2·3. 신호·점수 ──
        score, reasons, core = 0, [], False
        if not p.nationwide:
            score += pts["incheon_only"]
            reasons.append("인천 공고")
        if gu and gu in gus:
            score += pts["same_gu_in_title"]
            reasons.append(f"{gu} 공고")
        sb = R["small_business"]
        if any(t in sb["targets"] for t in p.targets) or re.search(sb["pattern"], text):
            score += pts["small_business"]
            core = True
            reasons.append("소상공인 대상" if any(t in sb["targets"] for t in p.targets) else "소상공인 관련")
        st = R["startup"]
        if (p.source == "kstartup" or any(t in st["targets"] for t in p.targets) or p.category in st["categories"]
                or re.search(st["pattern"], title)):
            score += pts["startup"]
            core = True
            reasons.append("창업 지원")
        if biz_re and re.search(biz_re, text):
            score += pts["biz_name"]
            core = True
            reasons.append(f"{biz_name} 관련")
        elif family and re.search(family["pattern"], text):
            score += pts["biz_family"]
            core = True
            reasons.append(f"{family['label']} 관련")
        cat = pts["category"].get(p.category or "", 0)
        score += cat
        if not p.nationwide and cat:
            core = True
        if stage_rule:
            periods = p.startup_period or ""
            if ("kstartup_enyy" in stage_rule and stage_rule["kstartup_enyy"] in periods) or \
                    ("pattern" in stage_rule and re.search(stage_rule["pattern"], title)):
                score += pts["profile"]
                reasons.append(STAGE_REASON[prof.stage or ""])
        if prof.youth and (re.search(y["pattern"], title) or _youth_only(p.ages, y)):
            score += pts["profile"]
            reasons.append("청년 대상")
        for g in group_only:
            if g in prof.preferred:
                score += pts["profile"]
                reasons.append(f"{g} 우대")
        if not core:
            continue
        dm = R.get("demote")
        if dm and (p.category in dm["categories"] or re.search(dm["pattern"], title)):
            score += dm["points"]                                     # 행사·참관 공고는 뒤로(빼지는 않는다)
        days_left = (date.fromisoformat(p.end) - today).days if p.end else None
        soon = days_left is not None and days_left <= R["deadline_soon_days"]
        if soon:
            reasons.append("오늘 마감" if days_left == 0 else f"마감 {days_left}일 남음")
        scored.append((score, p, days_left, soon, reasons))
    scored.sort(key=lambda s: (-s[0], s[1].end is None, s[1].end or "", s[1].title))
    items = [{"id": p.id, "source": p.source, "sources": p.sources or [p.source], "title": p.title, "agency": p.agency,
              "operator": p.operator, "targets": p.targets, "category": p.category, "nationwide": p.nationwide,
              "regions": p.regions, "period_text": p.period_text, "start": p.start, "end": p.end, "days_left": d,
              "deadline_soon": soon, "url": p.url, "apply_url": p.apply_url, "summary": p.summary, "reasons": rs}
             for _, p, d, soon, rs in scored[:limit]]
    return len(scored), items
