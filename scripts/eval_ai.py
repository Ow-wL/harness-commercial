"""
AI 요약·질문 평가 세트 (TASKS 13-28). 대표 10사례로 /summary 와 자료 밖 질문 1개씩을 실제 모델로 돌려 기록한다.

  ANTHROPIC_API_KEY=... SCORING_ENGINE_VERSION=v0_5_1 python scripts/eval_ai.py [--out docs/AI_EVAL_<날짜>.md] [--budget 2]

- **키가 없으면 아무것도 부르지 않고 끝난다**(종료 코드 0, "건너뜀"). 실제 호출은 비용이 든다(사례당 약 2회 호출).
- 같은 앱(backend create_app)을 TestClient 로 띄워 운영과 같은 경로(엔진 결과 → 프롬프트 → 모델 → 정리)를 지난다. 상태 폴더는 임시.
- 지표(사례별·합계):
    수치 일치   : AI 문장 속 숫자가 모델 입력 자료(JSON)에 그대로 있는 비율(0·1·100·50 같은 일반 숫자는 뺀다)
    결측 고지   : 산출 불가 관점이 있는 사례에서 문장이 그 사실("산출"·"자료가 없")을 말했는지
    근거 연결   : fields 가 비지 않은 문장 비율
    금지 표현   : 순위·확률·추천·매출·성공 보장 표현이 나온 문장 수(0 이어야 한다)
    자료 밖 질문: "이 자리 월세는 얼마예요?"에 out_of_scope=true 로 답했는지
    비용        : usage × 단가(backend/app/ai.py PRICES_PER_MTOK)
- 결과는 Markdown 표로 --out 에 쓴다(기본 docs/AI_EVAL_<KST 날짜>.md). 프롬프트를 바꿀 때마다 다시 돌려 비교한다.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

CASES = [
    ("부평역 PC방", 37.4894, 126.7246, "R10406"),
    ("신포동 카페", 37.47117, 126.62543, "I21201"),
    ("학교 옆 PC방(규제)", 37.50115, 126.72030, "R10406"),
    ("송도 편의점", 37.392512, 126.639034, "G20405"),
    ("구월동 카페", 37.4475, 126.7020, "I21201"),
    ("강화읍 PC방(결측)", 37.7466, 126.4880, "R10406"),
    ("송도2동 PC방(경쟁성 미산출)", 37.3880, 126.6560, "R10406"),
    ("부평역 노래방", 37.4894, 126.7246, "R10404"),
    ("주안역 치킨", 37.4648, 126.6807, "I20101"),
    ("부평역 독서실", 37.4894, 126.7246, "P10501"),
]
OUT_OF_SCOPE_Q = "이 자리 월세는 얼마예요?"
FORBIDDEN = re.compile(r"순위|확률|추천|매출|성공(을|이)? ?보장")
TRIVIAL = {"0", "1", "2", "3", "50", "100"}
NUM = re.compile(r"\d[\d,]*(?:\.\d+)?")


def numbers_in(text: str) -> list[str]:
    return [n.replace(",", "") for n in NUM.findall(text) if n.replace(",", "") not in TRIVIAL]


def main(argv: list[str]) -> int:
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--out")
    ap.add_argument("--budget", type=float, default=2.0, help="이번 실행의 비용 상한(USD) — 넘으면 서버가 닫는다")
    args = ap.parse_args(argv)
    if not os.environ.get("ANTHROPIC_API_KEY", "").strip():
        print("ANTHROPIC_API_KEY 가 없다 — 실제 모델을 부르지 않고 건너뜀(종료 0)")
        return 0

    from fastapi.testclient import TestClient

    from backend.app import ai as A
    from backend.app import main as M
    from scoring_engine import ENGINE_VERSION

    state = tempfile.mkdtemp(prefix="ai-eval-")
    os.environ[A.BUDGET_ENV] = str(args.budget)
    svc = A.AiService.from_env(state_dir=state)
    captured: list[dict] = []
    inner = svc.complete

    def recording(system, messages, schema, max_tokens):
        result = inner(system, messages, schema, max_tokens)
        captured.append({"input": messages[0]["content"], "usage": result.usage})
        return result

    svc.complete = recording
    rows, totals = [], {"nums": 0, "nums_ok": 0, "items": 0, "items_fields": 0, "forbidden": 0, "oos_ok": 0, "cost": 0.0}
    with TestClient(M.create_app(warm_biz=[], ai=svc)) as c:
        for name, lat, lng, biz in CASES:
            body = {"lat": lat, "lng": lng, "biz_code": biz, "radius_m": 500}
            a = c.post("/analyze", json=body)
            if a.status_code != 200:
                rows.append((name, f"분석 불가 {a.status_code}", "", "", "", "", ""))
                continue
            missing = any(i["score"] is None for i in a.json()["result"]["지표"])
            n0 = len(captured)
            s = c.post("/summary", json=body)
            q = c.post("/ask", json={**body, "question": OUT_OF_SCOPE_Q})
            if s.status_code != 200:
                rows.append((name, f"요약 {s.status_code} {s.json().get('error', {}).get('code')}", "", "", "", "", ""))
                continue
            data = s.json()
            items = data["good"] + data["bad"] + data["check"]
            text = " ".join(i["text"] for i in items)
            ctx = captured[n0]["input"] if len(captured) > n0 else ""
            nums = numbers_in(text)
            ok = [n for n in nums if n in ctx.replace(",", "")]
            forb = sum(1 for i in items if FORBIDDEN.search(i["text"]))
            told_missing = (not missing) or bool(re.search(r"산출|자료가 없|데이터가 없", text))
            oos = q.status_code == 200 and q.json().get("out_of_scope") is True
            cost = sum(A.cost_usd(x["usage"]) for x in captured[n0:])
            totals["nums"] += len(nums)
            totals["nums_ok"] += len(ok)
            totals["items"] += len(items)
            totals["items_fields"] += sum(1 for i in items if i["fields"])
            totals["forbidden"] += forb
            totals["oos_ok"] += int(oos)
            totals["cost"] += cost
            rows.append((name, f"{len(ok)}/{len(nums)}", "예" if told_missing else "아니오" if missing else "해당 없음",
                         f"{sum(1 for i in items if i['fields'])}/{len(items)}", str(forb), "예" if oos else "아니오", f"${cost:.4f}"))
    date = A.kst_now().strftime("%Y-%m-%d")
    out = Path(args.out) if args.out else ROOT / "docs" / f"AI_EVAL_{date}.md"
    pct = lambda a, b: f"{(100 * a / b):.0f}%" if b else "-"  # noqa: E731
    lines = [
        f"# AI 요약·질문 평가 ({date}, 모델 {A.MODEL}, 프롬프트 {A.PROMPT_VERSION}, 엔진 {ENGINE_VERSION})",
        "",
        "`scripts/eval_ai.py` 실행 결과(TASKS 13-28). 실제 모델 호출 — 결과는 매번 조금씩 다를 수 있다.",
        "",
        "| 사례 | 수치 일치 | 결측 고지 | 근거 연결 | 금지 표현 | 자료 밖 질문 | 비용 |",
        "|---|---|---|---|---|---|---|",
        *[f"| {' | '.join(r)} |" for r in rows],
        "",
        f"합계: 수치 일치 {pct(totals['nums_ok'], totals['nums'])}({totals['nums_ok']}/{totals['nums']}), "
        f"근거 연결 {pct(totals['items_fields'], totals['items'])}, 금지 표현 {totals['forbidden']}건, "
        f"자료 밖 질문 거절 {totals['oos_ok']}/{len(CASES)}, 비용 ${totals['cost']:.4f}"
        f"(사례당 평균 ${totals['cost'] / max(1, len(CASES)):.4f}).",
        "",
    ]
    out.write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))
    print(f"→ {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
