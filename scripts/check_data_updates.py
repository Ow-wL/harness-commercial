"""
새 원본 자료 확인 (TASKS 9-C5) — 포털 자료 페이지의 최신 파일 기준일을 마지막 데이터 버전 매니페스트와 비교한다.

  python scripts/check_data_updates.py [--markdown 보고.md] [--exit-new]

- 읽기만 한다: 공개 자료 페이지(HTML) 4개를 한 번씩 GET 한다. 파일 다운로드·로그인은 하지 않는다(포털 약관·봇 차단 확인 전
  다운로드 자동화 없음 — 9-C5). 새 자료가 있으면 사람이 받아 `scripts/etl/build_version.py` 이후 단계(DATA_VERSIONING §6)를 돈다.
- 비교 기준: data/versions/<가장 최근 id>/manifest.json 의 각 출처 제목에 든 기준일(예: `_20260930`, 생활이동 `2026-09`).
- 종료 코드: 0 새 자료 없음(또는 --exit-new 없음) · 10 새 자료 있음(--exit-new) · 2 확인 실패만 있고 새 자료 없음(--exit-new).
  확인 실패(시간 초과·형식 변경)는 숨기지 않고 표에 "확인 실패"로 적는다.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSIONS = ROOT / "data" / "versions"
UA = "harness-commercial data-update-check (read-only, monthly)"

# (키, 이름, 자료 페이지, 매니페스트 출처 url 에 들어 있는 식별자, 파서 종류)
SOURCES = [
    ("shops", "상가(상권)정보", "https://www.data.go.kr/data/15083033/fileData.do", "15083033", "datagokr"),
    ("population", "주민등록 인구", "https://www.data.go.kr/data/15097972/fileData.do", "15097972", "datagokr"),
    ("sgis", "SGIS 행정구역 통계·경계", "https://www.data.go.kr/data/15129688/fileData.do", "15129688", "datagokr"),
    ("move", "수도권 생활이동", "https://data.seoul.go.kr/dataList/OA-22298/F/1/datasetView.do", "OA-22298", "seoul"),
]


def latest_version_dir(versions: Path | None = None) -> Path:
    versions = versions or VERSIONS
    ids = sorted(p.name for p in versions.iterdir() if p.is_dir() and (p / "manifest.json").is_file())
    if not ids:
        raise SystemExit(f"{versions}: 매니페스트가 있는 데이터 버전이 없다")
    return versions / ids[-1]


def norm_date(s: str) -> str:
    """'20260930' → '2026-09-30', '202609'·'2026-09' → '2026-09'."""
    s = s.replace("-", "")
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}" if len(s) == 8 else f"{s[:4]}-{s[4:6]}"


def manifest_dates(manifest: dict) -> dict[str, str]:
    """출처 식별자 → 매니페스트가 반영한 기준일(같은 출처가 여러 역할에 있으면 가장 늦은 값)."""
    out: dict[str, str] = {}
    for role in manifest["roles"].values():
        for src in role.get("sources", []):
            url, title = src.get("url") or "", src.get("title") or ""
            for _key, _name, _page, ident, kind in SOURCES:
                if ident not in url:
                    continue
                m = re.search(r"_(\d{8})", title) if kind == "datagokr" else re.search(r"(\d{4}-\d{2})\s*$", title)
                if m:
                    d = norm_date(m.group(1))
                    out[ident] = max(out.get(ident, d), d)
    return out


def parse_datagokr(html: str) -> dict:
    """공공데이터포털 파일데이터 페이지: 제목 끝 기준일(`_YYYYMMDD`), 등록일·수정일·차기 등록 예정일."""
    m = re.search(r'property="og:title"\s+content="([^"]+)"', html) or re.search(r"<title>([^<|]+)", html)
    if not m:
        raise ValueError("제목을 찾지 못했다")
    title = m.group(1).strip()
    d = re.search(r"_(\d{8})\b", title)
    if not d:
        raise ValueError(f"제목에 기준일이 없다: {title}")

    def field(key: str):
        f = re.search(rf'<strong class="key">{key}</strong>\s*<div class="value">\s*([^<]*?)\s*</div>', html)
        return f.group(1) if f else None

    return {"latest": norm_date(d.group(1)), "title": title,
            "registered": field("수정일") or field("등록일"), "next": field("차기 등록 예정일")}


def parse_seoul(html: str) -> dict:
    """서울 열린데이터광장 생활이동 페이지: 파일 목록 `seoul_purpose_admdong1_in_YYYYMM.zip` 중 가장 늦은 월."""
    months = re.findall(r"seoul_purpose_admdong1_in_(\d{6})\.zip", html)
    if not months:
        raise ValueError("월별 파일 목록을 찾지 못했다")
    latest = max(months)
    return {"latest": norm_date(latest), "title": f"seoul_purpose_admdong1_in_{latest}.zip", "registered": None, "next": None}


PARSERS = {"datagokr": parse_datagokr, "seoul": parse_seoul}


def fetch(url: str, timeout: float = 30.0) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


def check(manifest: dict, fetch=None) -> list[dict]:
    fetch = fetch or globals()["fetch"]
    have = manifest_dates(manifest)
    rows = []
    for key, name, page, ident, kind in SOURCES:
        row = {"key": key, "name": name, "page": page, "have": have.get(ident)}
        try:
            row.update(PARSERS[kind](fetch(page)))
            row["status"] = "new" if row["have"] is None or row["latest"] > row["have"] else "same"
        except Exception as e:                       # 확인 실패도 결과다 — 이유만 남기고 다음 자료로
            row.update(status="error", error=f"{type(e).__name__}: {e}"[:200])
        rows.append(row)
    return rows


STATUS_KO = {"new": "**새 자료**", "same": "그대로", "error": "확인 실패"}


def markdown(version_id: str, rows: list[dict]) -> str:
    lines = [f"기준 데이터 버전: `{version_id}`", "",
             "| 자료 | 반영본 | 포털 최신 | 포털 수정일 | 차기 예정 | 상태 |", "|---|---|---|---|---|---|"]
    for r in rows:
        latest = r.get("latest") or "-"
        note = f" ({r['error']})" if r["status"] == "error" else ""
        lines.append(f"| [{r['name']}]({r['page']}) | {r['have'] or '-'} | {latest} | {r.get('registered') or '-'} "
                     f"| {r.get('next') or '-'} | {STATUS_KO[r['status']]}{note} |")
    if any(r["status"] == "new" for r in rows):
        lines += ["", "다음(사람): 포털에서 새 파일을 받아 `data/versions/_raw/` 에 두고 → spec 작성 → "
                  "`python scripts/etl/build_version.py <spec>` → `validate_version.py <id> --write` → "
                  "`diff_report.py data/runtime <id> --snapshot`(엔진 v0.5.1) → 검토·배포 승인(`docs/DATA_VERSIONING.md` §6)."]
    return "\n".join(lines) + "\n"


def main(argv: list[str]) -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--markdown", help="결과 표를 이 파일에도 쓴다(GitHub 이슈 본문용)")
    ap.add_argument("--exit-new", action="store_true", help="새 자료 있으면 10, 확인 실패만 있으면 2로 끝낸다")
    a = ap.parse_args(argv)
    vdir = latest_version_dir()
    manifest = json.loads((vdir / "manifest.json").read_text(encoding="utf-8"))
    rows = check(manifest)
    text = markdown(vdir.name, rows)
    print(text, end="")
    if a.markdown:
        Path(a.markdown).write_text(text, encoding="utf-8")
    if not a.exit_new:
        return 0
    if any(r["status"] == "new" for r in rows):
        return 10
    return 2 if any(r["status"] == "error" for r in rows) else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
