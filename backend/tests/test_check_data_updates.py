"""scripts/check_data_updates.py (TASKS 9-C5) — 포털 페이지 파싱·매니페스트 비교·종료 코드. 네트워크는 쓰지 않는다(가짜 fetch)."""
import importlib.util
import json
import os
import urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_spec = importlib.util.spec_from_file_location("check_data_updates", os.path.join(ROOT, "scripts", "check_data_updates.py"))
U = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(U)


def datagokr_page(title, modified="2026-10-30", nxt="2027-01-31"):
    return f"""<meta name="title" property="og:title" content="{title}">
<title>{title} | 공공데이터포털</title>
<li class="half"><strong class="key">차기 등록 예정일</strong>
          <div class="value">{nxt}</div></li>
<li class="half"><strong class="key">등록일</strong>
          <div class="value">2026-01-01</div></li>
<li class="half"><strong class="key">수정일</strong>
          <div class="value">{modified}</div></li>"""


def seoul_page(*months):
    return "".join(f'<a>seoul_purpose_admdong1_in_{m}.zip</a> <span>seoul_purpose_admdong1_in_{m}.zip 다운로드</span>'
                   for m in months)


MANIFEST = {"roles": {
    "shops": {"sources": [{"title": "소상공인시장진흥공단_상가(상권)정보_20260930",
                           "url": "https://www.data.go.kr/data/15083033/fileData.do"}]},
    "panel": {"sources": [
        {"title": "행정안전부_지역별(행정동) 성별 연령별 주민등록 인구수_20260930",
         "url": "https://www.data.go.kr/data/15097972/fileData.do"},
        {"title": "국가데이터처_SGIS 행정구역 통계 및 경계_20250630 (2024년 통계·2025 2Q 경계)",
         "url": "https://www.data.go.kr/data/15129688/fileData.do"}]},
    "market_panel": {"sources": [{"title": "서울시 수도권 생활이동 (행정동 단위 이동목적) 2026-09",
                                  "url": "https://data.seoul.go.kr/dataList/OA-22298/F/1/datasetView.do"}]},
    "rent": {"sources": [{"title": "sources/team_v0.3/07_가공데이터", "url": None}]},
}}


def pages(**over):
    base = {
        "15083033": datagokr_page("소상공인시장진흥공단_상가(상권)정보_20260930"),
        "15097972": datagokr_page("행정안전부_지역별(행정동) 성별 연령별 주민등록 인구수_20260930", "2026-10-02", "2026-11-10"),
        "15129688": datagokr_page("국가데이터처_SGIS 행정구역 통계 및 경계_20250630", "2026-07-23", "2027-02-01"),
        "OA-22298": seoul_page("202301", "202608", "202609"),
    }
    base.update(over)

    def fetch(url):
        for ident, html in base.items():
            if ident in url:
                if isinstance(html, Exception):
                    raise html
                return html
        raise AssertionError(url)
    return fetch


def by_key(rows):
    return {r["key"]: r for r in rows}


def test_manifest_dates_from_source_titles():
    assert U.manifest_dates(MANIFEST) == {"15083033": "2026-09-30", "15097972": "2026-09-30",
                                          "15129688": "2025-06-30", "OA-22298": "2026-09"}


def test_parsers_read_date_and_fields():
    p = U.parse_datagokr(datagokr_page("행정안전부_인구수_20261031", "2026-11-10", "2026-12-10"))
    assert p == {"latest": "2026-10-31", "title": "행정안전부_인구수_20261031", "registered": "2026-11-10", "next": "2026-12-10"}
    assert U.parse_seoul(seoul_page("202609", "202610", "202512"))["latest"] == "2026-10"


def test_all_same():
    rows = U.check(MANIFEST, fetch=pages())
    assert {r["status"] for r in rows} == {"same"}
    assert "새 자료" not in U.markdown("2026-09", rows)


def test_new_population_and_move_are_flagged():
    rows = by_key(U.check(MANIFEST, fetch=pages(
        **{"15097972": datagokr_page("행정안전부_인구수_20261031"), "OA-22298": seoul_page("202609", "202610")})))
    assert rows["population"]["status"] == "new" and rows["population"]["latest"] == "2026-10-31"
    assert rows["move"]["status"] == "new" and rows["move"]["latest"] == "2026-10"
    assert rows["shops"]["status"] == "same"
    md = U.markdown("2026-09", list(rows.values()))
    assert "**새 자료**" in md and "build_version.py" in md


def test_fetch_failure_and_format_change_are_reported_not_hidden():
    rows = by_key(U.check(MANIFEST, fetch=pages(
        **{"15083033": urllib.error.URLError("timed out"), "15129688": "<html>점검 중</html>"})))
    assert rows["shops"]["status"] == "error" and "timed out" in rows["shops"]["error"]
    assert rows["sgis"]["status"] == "error" and "제목" in rows["sgis"]["error"]
    assert rows["population"]["status"] == "same"
    assert "확인 실패" in U.markdown("2026-09", list(rows.values()))


def _run_main(monkeypatch, tmp_path, fetch, *args):
    vdir = tmp_path / "versions" / "2026-09"
    vdir.mkdir(parents=True)
    (vdir / "manifest.json").write_text(json.dumps(MANIFEST, ensure_ascii=False), encoding="utf-8")
    (tmp_path / "versions" / "_raw").mkdir()                     # 매니페스트 없는 폴더는 버전이 아니다
    monkeypatch.setattr(U, "VERSIONS", tmp_path / "versions")
    monkeypatch.setattr(U, "fetch", fetch)
    return U.main(list(args))


def test_latest_version_dir_skips_folders_without_manifest(tmp_path):
    for name in ("2026-06", "2026-09", "_raw"):
        (tmp_path / name).mkdir()
    for name in ("2026-06", "2026-09"):
        (tmp_path / name / "manifest.json").write_text("{}", encoding="utf-8")
    assert U.latest_version_dir(tmp_path).name == "2026-09"


def test_exit_codes(monkeypatch, tmp_path):
    out = tmp_path / "report.md"
    assert _run_main(monkeypatch, tmp_path, pages(), "--exit-new", "--markdown", str(out)) == 0
    assert "그대로" in out.read_text(encoding="utf-8")


def test_exit_codes_new_and_error(monkeypatch, tmp_path):
    new = pages(**{"OA-22298": seoul_page("202610")})
    assert _run_main(monkeypatch, tmp_path / "a", new, "--exit-new") == 10
    assert _run_main(monkeypatch, tmp_path / "b", new) == 0                        # --exit-new 없으면 항상 0
    err = pages(**{"OA-22298": urllib.error.URLError("timed out")})
    assert _run_main(monkeypatch, tmp_path / "c", err, "--exit-new") == 2
