"""
엔진 v0.5(`mvp-0.5`, D-028) — 팀 전달 v0.5 + 웹 반경 선택(300·500·1,000m).

  V-team     팀 단위 테스트 4개 파일 29건이 웹 사본에서 그대로 통과한다
  V-golden   v0.5@500(부평역 legacy 지점, rent="부평") == 팀 전달 결과(tests/golden/v0.5). 순위표 CSV 는 바이트 동일.
             JSON 은 `종합.적용_가중치` 반올림 1칸 차이만 허용 — 팀 결과는 Python 3.12+ sum()(보정 합산)으로 만들어졌고
             이 저장소는 Python 3.10(D-008)이다. 그 칸은 "보정 합산이면 golden 값이 나온다"를 다시 계산해 확인한다.
  V-radius   v0.5@300·1,000 == golden v0.5 r300·r1000. 500 대비 바뀐 곳 ⊂ {고객성, 경쟁성, 종합, 경고, meta.분석반경_m}
             — 반경과 무관한 시장성·입지성·안정성·초보자 접근성은 그대로
  V-web500   웹 경로(ContextBuilder, rent=None)는 팀 결과와 안정성(임대료 S4 제외)·종합·경고·meta.query 만 다르다

fixture 를 새 출력으로 덮어써서 통과시키지 않는다 (tests/golden/README.md).
"""
import csv
import glob
import importlib
import io
import math
import os
import re

import pytest

import scoring_engine
import scoring_engine.config as C
from helpers import ROOT, deep_diff, load_json, normalize
from scoring_engine.context import BUPYEONG_STATION

BIZ = list(C.CODE_NAME)
GOLDEN_V05_DIR = os.path.join(ROOT, "tests", "golden", "v0.5")
TEAM_CSV = os.path.join(GOLDEN_V05_DIR, "부평역_업종별_적합도.csv")
TEAM_UNIT_MODULES = {"test_weights": 8, "test_access": 6, "test_agglomeration": 7, "test_v05": 8}


def golden_v05(radius: int) -> dict:
    sub = "json" if radius == 500 else os.path.join(f"r{radius}", "json")
    files = sorted(glob.glob(os.path.join(GOLDEN_V05_DIR, sub, "*.json")))
    return {g["meta"]["업종코드"]: g for g in map(load_json, files)}


GOLDEN_500 = golden_v05(500)


# ── 버전 ─────────────────────────────────────────────────
def test_engine_is_v0_5():
    assert scoring_engine.ENGINE_KEY == "v0_5" and scoring_engine.ENGINE_VERSION == "mvp-0.5"
    assert os.path.basename(scoring_engine.ENGINE_DIR) == "v0_5" and scoring_engine.AREA_WEIGHTED
    assert scoring_engine.RADIUS_OPTIONS_M == (300, 500, 1000) and C.RADIUS_M == 500


# ── V-team ───────────────────────────────────────────────
def _team_cases():
    for name, n in TEAM_UNIT_MODULES.items():
        mod = importlib.import_module(name)
        assert os.path.dirname(mod.__file__) == scoring_engine.ENGINE_DIR
        fns = [getattr(mod, f) for f in sorted(dir(mod)) if f.startswith("test_")]
        assert len(fns) == n, f"{name}: {len(fns)}건 (기대 {n}) — 줄면 누가 테스트를 지운 것이다"
        yield from (pytest.param(fn, id=f"{name}::{fn.__name__}") for fn in fns)


TEAM_CASES = list(_team_cases())


def test_team_unit_test_count():
    assert len(TEAM_CASES) == 29


@pytest.mark.parametrize("fn", TEAM_CASES)
def test_team_unit(fn):
    fn()


@pytest.mark.parametrize("bad", [0, 250, 499, 750, 2000])
def test_unsupported_radius_rejected(service, bad):
    with pytest.raises(ValueError, match="분석 반경"):
        service.analyze(BUPYEONG_STATION, "R10406", radius_m=bad)


# ── V-golden (500m) ──────────────────────────────────────
WEIGHT_PATH = re.compile(r"^\$\.종합\.적용_가중치\.(\w+): ([\d.]+) != ([\d.]+)$")


def _explained_by_compensated_sum(diff: str, result: dict) -> bool:
    """`종합.적용_가중치.k` 차이가 sum() 방식 차이뿐인지: 산출 관점의 기본 가중치를 math.fsum(=3.12+ sum)으로 정규화하면
    golden 값, 3.10 sum 으로 정규화하면 이 결과 값이어야 한다. 점수·다른 필드는 이 예외에 들어오지 않는다."""
    m = WEIGHT_PATH.match(diff)
    if not m:
        return False
    key, got, want = m.group(1), float(m.group(2)), float(m.group(3))
    base = result["종합"]["기본_가중치"]
    used = [i["key"] for i in result["지표"] if i["score"] is not None]
    w = [base[k] for k in used]
    return (round(base[key] / math.fsum(w), 3) == want and round(base[key] / sum(w), 3) == got)


@pytest.mark.golden
@pytest.mark.parametrize("biz", BIZ, ids=[C.CODE_NAME[b] for b in BIZ])
def test_v_golden_500_equals_team_result(bupyeong_results, service, biz):
    got = normalize(bupyeong_results[biz])
    diffs = deep_diff(got, GOLDEN_500[biz])
    unexplained = [d for d in diffs if not _explained_by_compensated_sum(d, got)]
    assert not unexplained, "\n".join(unexplained[:10])
    explicit = service.analyze(BUPYEONG_STATION, biz, radius_m=500)          # 기본값과 명시 500 이 같다
    assert not deep_diff(normalize(explicit), got)


@pytest.mark.golden
def test_v_golden_weight_rounding_exceptions_are_the_known_seven(bupyeong_results):
    """예외 칸이 늘면(= 다른 원인) 위 테스트가 막지만, 어디서 생겼는지도 고정해 둔다: A 고객밀착형 7개 업종 × market·location."""
    hit = {(C.CODE_NAME[b], d.split(":")[0].rsplit(".", 1)[1]) for b in BIZ
           for d in deep_diff(normalize(bupyeong_results[b]), GOLDEN_500[b])}
    group_a = {n for c, n in C.CODE_NAME.items() if C.group_of(c) == "A_고객밀착형"}
    assert hit == {(n, k) for n in group_a for k in ("market", "location")}


def _team_rows(results: dict) -> list[dict]:
    """팀 run_all.py v0.5 순위표 한 행과 같은 열·순서(종합 내림차순, 동점은 CODE_NAME 순서)."""
    rows = []
    for biz in C.CODE_NAME:
        res = results[biz]
        d = {i["key"]: i for i in res["지표"]}
        acc = res["초보자_접근성"] or {}
        rows.append({"업종코드": biz, "업종명": C.CODE_NAME[biz], "업종그룹": res["meta"]["업종그룹"],
                     "시장성": d["market"]["score"], "고객성": d["customer"]["score"],
                     "경쟁성": d["competition"]["score"], "입지성": d["location"]["score"],
                     "안정성": d["stability"]["score"],
                     "종합": res["종합"]["점수"], "병목": res["종합"]["병목_지표"], "충족률": res["종합"]["데이터_충족률"],
                     "시간대_적합도": d["market"]["raw"].get("시간대_적합도"),
                     "역세권_강도": d["location"]["raw"].get("역세권_강도"),
                     "유인시설_근접도": d["location"]["raw"].get("유인시설_근접도"),
                     "반경내_동종점포": d["competition"]["raw"]["동종점포수"],
                     "집적유형": d["competition"]["raw"].get("업종_집적유형"),
                     "상권_집적도_백분위": d["competition"]["raw"].get("상권_집적도_백분위"),
                     "점포당_잠재수요": d["competition"]["raw"].get("점포당_잠재수요"),
                     "제도_진입장벽": acc.get("제도_진입장벽"), "인허가": acc.get("인허가"), "필요_면허": acc.get("필요_면허")})
    rows.sort(key=lambda x: -x["종합"])
    return rows


@pytest.mark.golden
def test_v_golden_ranking_csv_byte_identical(bupyeong_results):
    buf = io.StringIO(newline="")
    rows = _team_rows(bupyeong_results)
    w = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
    w.writeheader()
    w.writerows(rows)
    with open(TEAM_CSV, encoding="utf-8-sig", newline="") as f:
        assert buf.getvalue() == f.read()


@pytest.mark.golden
def test_bupyeong_pc_bang_reference_values(bupyeong_results):
    """전달 보고서 기준값(임대료 '부평' 연결 조건): 시장 61.6 · 고객 77.5 · 경쟁 32.4 · 입지 66.4 · 안정 63.9 · 종합 60.7."""
    r = bupyeong_results["R10406"]
    assert [i["score"] for i in r["지표"]] == [61.6, 77.5, 32.4, 66.4, 63.9] and r["종합"]["점수"] == 60.7
    comp = r["지표"][2]["raw"]
    assert comp["동종점포수"] == comp["동종점포수_정확일치"] == 12 and comp["동종점포수_실효(대체업종_포함)"] == 15.6
    assert r["지표"][1]["raw"]["인구_기준"] == "반경 500m 배분"
    top = sorted(BIZ, key=lambda b: -bupyeong_results[b]["종합"]["점수"])[:3]
    assert [(C.CODE_NAME[b], bupyeong_results[b]["종합"]["점수"]) for b in top] == [
        ("노래방", 72.4), ("독서실/스터디 카페", 72.1), ("당구장", 71.1)]


# ── V-radius ─────────────────────────────────────────────
RADIUS_PREFIXES = ("$.지표[1].", "$.지표[2].", "$.종합.", "$.경고", "$.meta.분석반경_m")


@pytest.mark.golden
@pytest.mark.parametrize("radius", [300, 1000])
def test_v_radius_matches_golden_v0_5(service, radius):
    golden = golden_v05(radius)
    assert sorted(golden) == sorted(BIZ)
    bad = []
    for biz in BIZ:
        got = normalize(service.analyze(BUPYEONG_STATION, biz, radius_m=radius))
        diffs = deep_diff(got, golden[biz])
        if diffs:
            bad.append(f"{C.CODE_NAME[biz]}: " + "; ".join(diffs[:5]))
    assert not bad, f"golden v0.5 r{radius} 와 다름:\n" + "\n".join(bad)


@pytest.mark.parametrize("radius", [300, 500, 1000])
def test_radius_recorded_consistently(radius):
    """응답의 반경 표기(meta·경쟁성 raw·고객성 인구 기준)가 모두 같은 반경 — 500m 로 계산하고 다른 반경으로 표시하지 않는다."""
    for g in golden_v05(radius).values():
        assert g["meta"]["분석반경_m"] == radius
        assert g["지표"][2]["raw"]["반경m"] == radius
        assert g["지표"][1]["raw"]["인구_기준"] == f"반경 {radius}m 배분"


@pytest.mark.parametrize("radius", [300, 1000])
def test_v_radius_changes_only_radius_dependent_parts(radius):
    """반경은 고객성(반경 인구)·경쟁성(과 그 가중합인 종합·경고)만 바꾼다. 시장성·입지성·안정성·초보자 접근성은 그대로."""
    golden = golden_v05(radius)
    outside = [f"{C.CODE_NAME[b]}: {d}" for b in BIZ for d in deep_diff(golden[b], GOLDEN_500[b])
               if not d.startswith(RADIUS_PREFIXES)]
    assert not outside, "\n".join(outside[:30])


@pytest.mark.golden
def test_reference_cache_keys(service):
    service.cache.warm()                                       # 앞 테스트가 대부분 채웠다 — 빠진 키만 계산
    stats = service.cache.stats()
    assert stats["competition_entries"] == 29 * 3              # (업종, 반경)
    assert stats["location_entries"] == 18                     # (유인시설 집합 14, 학교구역 여부) — 반경과 무관
    assert service.rt.areas.stats() == {"entries": 158 * 3, "points": 158}   # 중심점 면적 가중치: (중심점, 반경)당 1회


# ── 학교구역 (입지 reference 캐시 분리 · 경고 순서) ─────────
def test_location_reference_split_by_school_zone(service):
    """PC방(학교구역 적용)과 분식(미적용)은 유인시설 집합이 같아도 다른 비교 분포를 쓴다(팀 run_all.loc_for 키)."""
    cache = service.cache
    pc, snack = cache.anchor_key("R10406"), cache.anchor_key("I21007")
    assert pc[0] == snack[0] == ("중학교", "고등학교", "학원") and pc[1] is True and snack[1] is False
    a, b = cache.location("R10406"), cache.location("I21007")
    for t in ("중학교", "고등학교"):
        assert a["유인시설_종류별"][t] != b["유인시설_종류별"][t]
        assert all(x <= y + 1e-12 for x, y in zip(a["유인시설_종류별"][t], b["유인시설_종류별"][t]))   # 빼기만 한다
    assert a["유인시설_종류별"]["학원"] == b["유인시설_종류별"]["학원"]


SCHOOL = (37.502274 + 50 / 110_540, 126.727619)                # 부평고등학교 북쪽 50m (전달 정리본 5장 3번과 같은 상황)


def test_school_zone_warning_first_for_regulated_business(service):
    from scoring_engine.location import ContextBuilder
    ctx = ContextBuilder(service.rt).build(*SCHOOL)
    pc = normalize(service.analyze(ctx, "R10406"))
    assert pc["경고"][0].startswith("⚠ PC방은(는) 학교 주변 영업 규제 업종인데, 이 지점 200m 안에")
    assert pc["초보자_접근성"]["학교구역_200m_학교수"] >= 1
    loc = pc["지표"][3]
    assert loc["raw"]["학교구역_제외_학교수"] >= 1 and "학교구역_학교_가점제외" in loc["flags"]
    assert any(w.startswith("PC방은(는) 학교 주변 입지 규제 업종이고, 이 지점 300m 안에") for w in pc["경고"][1:])
    snack = normalize(service.analyze(ctx, "I21007"))           # 같은 지점, 학교구역 미적용 업종
    assert not any(w.startswith("⚠") for w in snack["경고"])
    assert snack["지표"][3]["raw"]["학교구역_제외_학교수"] is None and "학교구역_200m_학교수" not in snack["초보자_접근성"]


# ── 대체업종 실효 수 · 동종 점포 목록 ─────────────────────
def test_effective_same_business_count_includes_substitutes(service):
    from scoring_engine import radius_demand
    from scoring_engine.nearby import NearbyStoreFinder
    shops = service.rt.shops
    d = radius_demand.haversine_m(BUPYEONG_STATION.lat, BUPYEONG_STATION.lng, shops["위도"].values, shops["경도"].values)
    near = shops["상권업종소분류코드"].values[d <= 500]
    for biz in ("R10406", "I21201", "I21103"):             # PC방(←게임장), 카페(←빵·아이스크림), 생맥주(←요리주점·치킨)
        raw = normalize(service.analyze(BUPYEONG_STATION, biz))["지표"][2]["raw"]
        exact = int((near == biz).sum())
        eff = exact + sum(k * int((near == c).sum()) for c, k in C.SUBSTITUTE[biz].items())
        assert raw["동종점포수"] == raw["동종점포수_정확일치"] == exact
        assert raw["동종점포수_실효(대체업종_포함)"] == pytest.approx(round(eff, 1)) and eff > exact
        # 지도 점포 목록 = 정확 일치 동종 점포 (실효 수가 아니다)
        assert len(NearbyStoreFinder(service.rt).find(BUPYEONG_STATION.lat, BUPYEONG_STATION.lng, biz)) == exact


# ── 경계 · 면적 배분 ─────────────────────────────────────
def test_boundary_links_all_158_dongs(service):
    from scoring_engine.boundary import linked_dongs
    linked = linked_dongs(service.rt.areas)
    panel = service.rt.panel
    assert sorted(linked) == sorted(zip(panel["시군구명"], panel["행정동명"])) and len(linked) == 158
    ratios = {dong: ratio for _, dong, *_, ratio in service.rt.areas.items}
    assert {d for d, r in ratios.items() if r != 1.0} == {"아라1동", "아라2동", "운서1동", "운서2동"}
    assert math.isclose(ratios["아라1동"] + ratios["아라2동"], 1.0) and math.isclose(ratios["운서1동"] + ratios["운서2동"], 1.0)


def test_reused_area_weights_equal_engine_weights(service):
    areas = service.rt.areas
    c = service.rt.centroids.iloc[0]
    for lat, lng in [(c["위도"], c["경도"]), (BUPYEONG_STATION.lat, BUPYEONG_STATION.lng)]:
        for r in (300, 500, 1000):
            a, b = areas.weights(lat, lng, r), areas.areas.weights(lat, lng, r)
            assert a.equals(b)
    before = areas.stats()["entries"]
    areas.weights(37.4894, 126.7246, 500)                      # 중심점이 아닌 요청 좌표는 저장하지 않는다
    assert areas.stats()["entries"] == before


def test_boundary_loads_without_utf8_mode(tmp_path):
    """엔진 DongAreas 는 open(path) 에 인코딩을 주지 않는다 — Windows 기본(cp949)에서도 어댑터 로드는 성공해야 한다."""
    import subprocess
    import sys
    code = ("from scoring_engine.boundary import load_dong_areas, POP_BOUNDARY_PATH\n"
            "from scoring_engine.runtime import load_runtime, resolve_data_version\n"
            "import pandas as pd\n"
            "panel = pd.read_csv(resolve_data_version().path('panel'), encoding='utf-8-sig')\n"
            "a = load_dong_areas(panel)\n"
            "import etl_boundary\n"
            "assert 'open' not in vars(etl_boundary)\n"
            "print('linked', len(a.items))\n")
    env = dict(os.environ, SCORING_ENGINE_VERSION="v0_5", PYTHONUTF8="0", PYTHONDONTWRITEBYTECODE="1")
    env.pop("PYTHONIOENCODING", None)
    out = subprocess.run([sys.executable, "-c", code], cwd=ROOT, env=env, capture_output=True)
    assert out.returncode == 0, out.stderr.decode("utf-8", "replace")[-1500:]
    assert b"linked 158" in out.stdout


# 2026 경계(지도·행정동 판정) ↔ SGIS 2025 2분기(인구 배분)는 같은 이름이면 대체로 같은 땅이다. 확인된 예외를 고정한다.
KNOWN_AREA_MISMATCH = {("검단구", "당하동")}    # 2026 당하동(6.10㎢) 중 SGIS 당하동(2.32㎢)이 덮는 부분 37.7% — 나머지는 SGIS 검암경서동


def test_boundary_names_point_to_overlapping_polygons(service):
    """이름으로 연결한 SGIS polygon 이 2026 행정동 polygon 과 실제로 겹치고, 가장 많이 겹치는 SGIS 동인지(예외는 위 목록뿐)."""
    import json
    from functools import reduce

    from shapely.geometry import Polygon, shape
    from scoring_engine.boundary import POP_BOUNDARY_PATH
    from scoring_engine.location import DEFAULT_BOUNDARY_PATH as BOUNDARY_PATH
    with open(POP_BOUNDARY_PATH, encoding="utf-8") as f:
        sgis = {ft["properties"]["ADM_NM"]: reduce(lambda a, b: a.symmetric_difference(b),
                                                   [Polygon(r).buffer(0) for r in ft["geometry"]["coordinates"]])
                for ft in json.load(f)["features"]}                  # 엔진과 같은 even-odd 규칙(여러 링 = 섬·구멍)
    with open(BOUNDARY_PATH, encoding="utf-8") as f:
        b26 = {(ft["properties"]["시군구명"], ft["properties"]["행정동명"]): shape(ft["geometry"]).buffer(0)
               for ft in json.load(f)["features"]}
    from scoring_engine.etl_sgis import SPLIT_PARENT, norm_dong
    by_norm = {norm_dong(k): k for k in sgis}
    mismatch, low = set(), []
    for gu, dong in b26:
        name = by_norm[norm_dong(SPLIT_PARENT.get(dong, dong))]
        g26 = b26[(gu, dong)]
        inter = sgis[name].intersection(g26).area
        assert inter > 0, (gu, dong)
        best = max(sgis, key=lambda k: sgis[k].intersection(g26).area)
        if best != name:
            mismatch.add((gu, dong))
        low.append((inter / g26.area, gu, dong))
    assert mismatch == KNOWN_AREA_MISMATCH
    assert min(low)[1:] == ("검단구", "당하동")


# ── V-web500 (웹 경로 vs 팀 결과) ─────────────────────────
WEB_ALLOWED = ("$.지표[4].", "$.종합.", "$.경고", "$.meta.query")


@pytest.mark.golden
def test_v_web500_differs_from_team_only_by_rent_policy(service):
    """웹 일반 좌표는 임대료 상권을 연결하지 않는다(D-015, rent_area=None). 부평역 좌표의 웹 결과는 팀 결과와
    안정성(S4 제외)·그 가중합(종합)·경고·질의 문구만 다르다 — 임대료를 붙여 숫자를 맞추지 않는다."""
    from scoring_engine.location import ContextBuilder
    ctx = ContextBuilder(service.rt).build(BUPYEONG_STATION.lat, BUPYEONG_STATION.lng)
    assert (ctx.gu_name, ctx.dong_name, ctx.rent_area) == ("부평구", "부평1동", None)
    bad, changed = [], 0
    for biz in BIZ:
        got = normalize(service.analyze(ctx, biz))
        diffs = [d for d in deep_diff(got, GOLDEN_500[biz]) if not _explained_by_compensated_sum(d, got)]
        bad += [f"{C.CODE_NAME[biz]}: {d}" for d in diffs if not d.startswith(WEB_ALLOWED)]
        changed += got["종합"]["점수"] != GOLDEN_500[biz]["종합"]["점수"]
    assert not bad, "\n".join(bad[:20])
    assert changed == 13                                         # 안정성이 산출되는 13개 업종(PC방 + 음식 12)
    pc = normalize(service.analyze(ctx, "R10406"))
    assert [i["score"] for i in pc["지표"][:4]] == [61.6, 77.5, 32.4, 66.4]


# ── 분동 배분 결함 재현 (팀 엔진 유래, D-029) ──────────────
@pytest.mark.parametrize("radius", [500, 1000])
def test_split_dong_allocation_defect_reproduced(tmp_path, radius):
    """같은 모체 경계·같은 총량인데 분동 패널(아라1·2동)의 반경 배분이 분동 전(아라동 1행)보다 작다 — 팀 v0.5 의 인구비 이중 적용.
    v0.5 는 팀 결과(golden)를 보존하므로 결함을 그대로 둔다(고정). 수정은 엔진 v0.5.1(tests/engine_v0_5_1)."""
    import split_dong_case as S
    geo = tmp_path / "parent.geojson"
    S.write_parent_geojson(geo)
    before = S.allocate(geo, S.UNSPLIT, radius)
    after = S.allocate(geo, S.SPLIT, radius)
    pops = {d: v[0] for d, *v in S.SPLIT}
    ratio = {d: pops[d] / sum(pops.values()) for d in pops}
    assert after["ratios"] == pytest.approx(ratio) and before["ratios"] == {"아라동": 1.0}
    for i, col in enumerate(S.COLS):
        vals = {d: v[i] for d, *v in S.SPLIT}
        expected_shrink = sum(ratio[d] * vals[d] for d in vals) / sum(vals.values())   # Σ r·x ÷ Σ x
        assert after[col] == pytest.approx(before[col] * expected_shrink, rel=1e-9)
        assert after[col] < 0.55 * before[col]                                          # 보존되지 않는다(약 절반)
    assert after["반경수요"] < 0.55 * before["반경수요"]
