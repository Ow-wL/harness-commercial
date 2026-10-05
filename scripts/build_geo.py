"""
data/geo 가공 파일 생성 — 원본 행정동 경계(geojson)에서 인천 158개 행정동 경계와 2024→2026 crosswalk 를 만든다.

  python scripts/build_geo.py            가공 파일 생성. 매니페스트가 있으면 결과가 매니페스트와 같은지 검사(재현성)
  python scripts/build_geo.py --manifest 매니페스트 최초 생성 (이미 있으면 거부 — 덮어쓰기 금지)

원본 (data/geo/raw/, git 제외 — 다운로드 URL·sha256 은 tests/manifests/geo.sha256.json):
  HangJeongDong_ver20241231.geojson   2024 최종 행정동 경계 (개편 전 코드)
  HangJeongDong_ver20260701.geojson   2026-07-01 인천 개편 반영 경계 (runtime panel 과 같은 코드)
  출처: github.com/vuski/admdongkor (원천 통계청 SGIS, 공공누리 1유형 / 가공 CC BY 4.0)

공식 경계 입력 (data/geo/, commit — SGIS 는 인증이 필요해 url 로 다시 받을 수 없으므로 geometry 를 저장한다):
  SGIS_행정동경계_2025_남동구_구월.geojson   통계청 SGIS OpenAPI boundary/hadmarea.geojson (year=2025, adm_cd=23050,
      low_search=1) 중 구월1동·구월3동. 좌표는 응답 그대로 UTM-K(EPSG:5179). scripts/fetch_sgis_boundary.py 로 받는다

가공 (data/geo/, commit):
  인천_행정동경계_2026.geojson   resolver 용. 2026 경계 158개, 동 이름은 runtime panel 표기.
      좌표는 원본 그대로이고, SGIS_CORRECTIONS 의 행정동만 SGIS 공식 경계로 교정한다 (D-017, 아래). 출처는 feature 의 `경계_출처`
  행정동_crosswalk_2024_2026.csv  검증용. 2024 행정동 → 2026 행정동 (면적 겹침 비율로 기계적으로 판정, 교정 전 원본끼리)

SGIS 교정 (docs/DECISIONS.md D-017): donor 행정동 영역 중 SGIS 공식 target polygon 안에 있는 부분만 target 으로 옮긴다.
  새 donor = donor − SGIS target,  새 target = target ∪ (donor ∩ SGIS target).
  두 동을 합친 바깥 경계는 그대로라 다른 행정동과 새 겹침·틈이 생기지 않는다. 반대 방향(target 영역이 SGIS donor 안)이
  있거나, 옮길 영역이 없거나, SGIS 이름이 panel 과 다르면 오류로 멈춘다. 좌표·bbox·점 기반 예외는 없다.

규칙 (docs/DECISIONS.md D-009): 추정 매핑 금지. 1:1(양방향 겹침 ≥ 0.995, 이름 동일) 또는 분동(2024 하나 → 2026 여럿,
2026 쪽 겹침 ≥ 0.995)만 허용하고, 그 밖의 경우(통합·경계 변경·이름 변경·panel 불일치)는 오류로 멈춘다.
"""
from __future__ import annotations

import csv
import hashlib
import json
import math
import os
import sys

import numpy as np
import pandas as pd
import shapely
from shapely import STRtree
from shapely.geometry import MultiPolygon, mapping, shape

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEO_DIR = os.path.join(ROOT, "data", "geo")
RAW_DIR = os.path.join(GEO_DIR, "raw")
PANEL = os.path.join(ROOT, "data", "runtime", "패널_통합.csv")
MANIFEST = os.path.join(ROOT, "tests", "manifests", "geo.sha256.json")

SIDO = "28"   # 인천광역시
RAW = {
    "2024": ("HangJeongDong_ver20241231.geojson",
             "https://raw.githubusercontent.com/vuski/admdongkor/master/ver20241231/HangJeongDong_ver20241231.geojson"),
    "2026": ("HangJeongDong_ver20260701.geojson",
             "https://raw.githubusercontent.com/vuski/admdongkor/master/ver20260701/HangJeongDong_ver20260701.geojson"),
}
BOUNDARY_OUT = "인천_행정동경계_2026.geojson"
CROSSWALK_OUT = "행정동_crosswalk_2024_2026.csv"
CROSSWALK_COLUMNS = ["구_행정동코드", "구_시군구명", "구_행정동명", "신_행정동코드", "신_시군구명", "신_행정동명",
                     "관계", "구기준_겹침비율", "신기준_겹침비율"]
SAME = 0.995          # 겹침 비율이 이 이상이면 같은 영역으로 본다
NOISE = 0.001         # 이 미만의 겹침은 경계선 공유로 보고 무시한다

# SGIS 공식 경계 교정 (D-017). SGIS 행정동은 이름(adm_nm)으로만 확인한다 — SGIS adm_cd(23050xxx)는 통계용 코드라
# runtime panel 코드(28200xxx)와 체계가 다르다.
SGIS_YEAR = 2025      # 2026-10-06 기준 hadmarea 최신 제공 연도 (2026 은 errCd=-200 "경계데이터 년도 정보를 확인해주세요")
SGIS_BOUNDARY = "SGIS_행정동경계_2025_남동구_구월.geojson"
SGIS_SOURCE = (f"통계청 SGIS OpenAPI /OpenAPI3/boundary/hadmarea.geojson year={SGIS_YEAR} adm_cd=23050 low_search=1 "
               "구월1동·구월3동, UTM-K(EPSG:5179) 응답 좌표 그대로")
SGIS_CORRECTIONS = [
    # 2015-07-31 구월1동 일부 → 구월3동 편입 (남동구 연혁). SGIS 역지오코딩으로 D-010 충돌 439좌표 전부 구월3동 확인
    {"donor": "28200510", "target": "28200521",
     "sgis_donor": "인천광역시 남동구 구월1동", "sgis_target": "인천광역시 남동구 구월3동"},
]
VUSKI_SOURCE = "vuski/admdongkor ver20260701"
SGIS_CORRECTED_SOURCE = f"{VUSKI_SOURCE} + SGIS hadmarea {SGIS_YEAR} 구월1동/구월3동 경계 교정 (D-017)"

# EPSG:5179 (Korea 2000 / Unified CS): GRS80, 원점 38°N 127.5°E, k0 0.9996, false E 1,000,000 / N 2,000,000.
# 역변환은 Karney(2011) Krüger 6차 급수 (nm 급). SGIS transcoord(5179→4326) 결과와의 일치는 tests/test_geo_data.py.
_A, _F = 6378137.0, 1 / 298.257222101
_LAT0, _LON0, _K0, _FE, _FN = 38.0, 127.5, 0.9996, 1_000_000.0, 2_000_000.0
_N = _F / (2 - _F)
_E = math.sqrt(_F * (2 - _F))
_AHAT = _A / (1 + _N) * (1 + _N ** 2 / 4 + _N ** 4 / 64 + _N ** 6 / 256)
_ALPHA = (
    _N / 2 - 2 * _N ** 2 / 3 + 5 * _N ** 3 / 16 + 41 * _N ** 4 / 180 - 127 * _N ** 5 / 288 + 7891 * _N ** 6 / 37800,
    13 * _N ** 2 / 48 - 3 * _N ** 3 / 5 + 557 * _N ** 4 / 1440 + 281 * _N ** 5 / 630 - 1983433 * _N ** 6 / 1935360,
    61 * _N ** 3 / 240 - 103 * _N ** 4 / 140 + 15061 * _N ** 5 / 26880 + 167603 * _N ** 6 / 181440,
    49561 * _N ** 4 / 161280 - 179 * _N ** 5 / 168 + 6601661 * _N ** 6 / 7257600,
    34729 * _N ** 5 / 80640 - 3418889 * _N ** 6 / 1995840,
    212378941 * _N ** 6 / 319334400,
)
_BETA = (
    _N / 2 - 2 * _N ** 2 / 3 + 37 * _N ** 3 / 96 - _N ** 4 / 360 - 81 * _N ** 5 / 512 + 96199 * _N ** 6 / 604800,
    _N ** 2 / 48 + _N ** 3 / 15 - 437 * _N ** 4 / 1440 + 46 * _N ** 5 / 105 - 1118711 * _N ** 6 / 3870720,
    17 * _N ** 3 / 480 - 37 * _N ** 4 / 840 - 209 * _N ** 5 / 4480 + 5569 * _N ** 6 / 90720,
    4397 * _N ** 4 / 161280 - 11 * _N ** 5 / 504 - 830251 * _N ** 6 / 7257600,
    4583 * _N ** 5 / 161280 - 108847 * _N ** 6 / 3991680,
    20648693 * _N ** 6 / 638668800,
)


def _meridian_arc(lat: float) -> float:
    phi = math.radians(lat)
    xi = math.atan(math.sinh(math.atanh(math.sin(phi)) - _E * math.atanh(_E * math.sin(phi))))
    return _AHAT * (xi + sum(a * math.sin(2 * j * xi) for j, a in enumerate(_ALPHA, 1)))


_M0 = _meridian_arc(_LAT0)


def utmk_to_wgs84(x: float, y: float) -> tuple[float, float]:
    """EPSG:5179 (x, y) → WGS84 (경도, 위도). GRS80/ITRF2000 ≈ WGS84 로 보고 datum 변환은 하지 않는다 (SGIS 4326 과 같은 가정)."""
    xi = (y - _FN + _K0 * _M0) / (_K0 * _AHAT)
    eta = (x - _FE) / (_K0 * _AHAT)
    xi_ = xi - sum(b * math.sin(2 * j * xi) * math.cosh(2 * j * eta) for j, b in enumerate(_BETA, 1))
    eta_ = eta - sum(b * math.cos(2 * j * xi) * math.sinh(2 * j * eta) for j, b in enumerate(_BETA, 1))
    tau_ = math.sin(xi_) / math.hypot(math.sinh(eta_), math.cos(xi_))
    lam = math.atan2(math.sinh(eta_), math.cos(xi_))
    tau = tau_
    for _ in range(10):                                  # 등각위도 → 위도 (Newton, 2~3회에 수렴)
        sig = math.sinh(_E * math.atanh(_E * tau / math.sqrt(1 + tau ** 2)))
        t = tau * math.sqrt(1 + sig ** 2) - sig * math.sqrt(1 + tau ** 2)
        d = (tau_ - t) / math.sqrt(1 + t ** 2) * (1 + (1 - _E ** 2) * tau ** 2) / ((1 - _E ** 2) * math.sqrt(1 + tau ** 2))
        tau += d
        if abs(d) < 1e-14:
            break
    return _LON0 + math.degrees(lam), math.degrees(math.atan(tau))


def utmk_geometry_to_wgs84(geometry: dict):
    """SGIS GeoJSON geometry(UTM-K) → shapely geometry(WGS84 경도/위도)."""
    return shapely.transform(shape(geometry), lambda xy: np.array([utmk_to_wgs84(x, y) for x, y in xy]))


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def normalize_name(name: str) -> str:
    """경계 파일은 '·', runtime panel 은 '.' 을 쓴다 (예: 화수1·화평동 / 화수1.화평동). 비교 전용."""
    return name.replace("·", ".")


def load_incheon(version: str) -> list[dict]:
    fn, _ = RAW[version]
    with open(os.path.join(RAW_DIR, fn), encoding="utf-8") as f:
        fc = json.load(f)
    rows = []
    for feat in fc["features"]:
        p = feat["properties"]
        if p.get("sido") != SIDO:
            continue
        geom = shape(feat["geometry"])
        if not geom.is_valid:
            raise ValueError(f"{fn}: 유효하지 않은 geometry {p['adm_nm']}")
        rows.append({"code": p["adm_cd2"][:8], "code10": p["adm_cd2"], "sgg": p["sgg"], "gu": p["sggnm"],
                     "dong": p["adm_nm"].split()[-1], "geometry_json": feat["geometry"], "geom": geom})
    codes = [r["code"] for r in rows]
    if len(codes) != len(set(codes)):
        raise ValueError(f"{fn}: 인천 행정동코드 중복")
    return rows


def load_panel() -> pd.DataFrame:
    return pd.read_csv(PANEL, encoding="utf-8-sig", dtype={"행정동코드": str},
                       usecols=["행정동코드", "시군구명", "행정동명"])


def load_sgis() -> dict[str, dict]:
    """SGIS 공식 경계 입력 (adm_nm → feature). geometry 는 UTM-K 그대로."""
    with open(os.path.join(GEO_DIR, SGIS_BOUNDARY), encoding="utf-8") as f:
        fc = json.load(f)
    prov = fc.get("provenance", {})
    if prov.get("year") != SGIS_YEAR or prov.get("crs") != "EPSG:5179":
        raise ValueError(f"{SGIS_BOUNDARY}: provenance(year={SGIS_YEAR}, crs=EPSG:5179) 불일치")
    out = {ft["properties"]["adm_nm"]: ft for ft in fc["features"]}
    if len(out) != len(fc["features"]):
        raise ValueError(f"{SGIS_BOUNDARY}: adm_nm 중복")
    return out


def as_multipolygon(geom) -> dict:
    if geom.geom_type == "Polygon":
        geom = MultiPolygon([geom])
    if geom.geom_type != "MultiPolygon" or not geom.is_valid or geom.is_empty:
        raise ValueError(f"교정 결과가 유효한 (Multi)Polygon 이 아니다: {geom.geom_type}")
    return json.loads(json.dumps(mapping(geom)))          # tuple → list (원본 geojson 과 같은 모양)


def apply_sgis_corrections(rows: list[dict], sgis: dict[str, dict], panel: pd.DataFrame) -> list[dict]:
    """SGIS_CORRECTIONS 적용 (D-017). 새 list 를 돌려주고 입력 rows 는 바꾸지 않는다 (crosswalk 는 원본으로 만든다)."""
    by_code = {r["code"]: dict(r, source=VUSKI_SOURCE) for r in rows}
    names = panel.set_index("행정동코드")["행정동명"]
    for c in SGIS_CORRECTIONS:
        donor, target = by_code[c["donor"]], by_code[c["target"]]
        for code, sgis_name in ((c["donor"], c["sgis_donor"]), (c["target"], c["sgis_target"])):
            if sgis_name not in sgis or sgis_name.split()[-1] != names[code]:
                raise ValueError(f"SGIS 행정동 {sgis_name} 이 없거나 panel {code} {names[code]} 와 이름이 다르다")
        s_donor = utmk_geometry_to_wgs84(sgis[c["sgis_donor"]]["geometry"])
        s_target = utmk_geometry_to_wgs84(sgis[c["sgis_target"]]["geometry"])
        if not (s_donor.is_valid and s_target.is_valid):
            raise ValueError("SGIS geometry 가 유효하지 않다")
        if target["geom"].intersection(s_donor).area > 1e-9 * target["geom"].area:
            raise ValueError(f"{c['target']} 영역 일부가 SGIS {c['sgis_donor']} 안에 있다 — 한 방향 교정 규칙으로 처리할 수 없다")
        moved = donor["geom"].intersection(s_target)
        if moved.area <= 0:
            raise ValueError(f"옮길 영역이 없다: {c['donor']} ∩ SGIS {c['sgis_target']}")
        new_donor = donor["geom"].difference(s_target)
        new_target = target["geom"].union(moved)
        before = donor["geom"].union(target["geom"])
        if new_donor.union(new_target).symmetric_difference(before).area > 1e-9 * before.area \
                or new_donor.intersection(new_target).area > 1e-9 * before.area:
            raise ValueError("교정 후 두 행정동 합집합이 바뀌었거나 서로 겹친다")
        for r, g in ((donor, new_donor), (target, new_target)):
            r["geometry_json"] = as_multipolygon(g)
            r["geom"] = shape(r["geometry_json"])
            r["source"] = SGIS_CORRECTED_SOURCE
    return [by_code[r["code"]] for r in rows]


def build_boundary(new: list[dict], panel: pd.DataFrame) -> dict:
    """2026 경계 ↔ panel: 코드 집합이 같아야 하고, 시군구명·행정동명은 구분자('·'/'.') 차이만 허용한다."""
    by_code = panel.set_index("행정동코드")
    if set(r["code"] for r in new) != set(by_code.index):
        raise ValueError("2026 경계 행정동코드 집합 != runtime panel 행정동코드 집합")
    features = []
    for r in sorted(new, key=lambda x: x["code"]):
        prow = by_code.loc[r["code"]]
        if r["gu"] != prow["시군구명"] or normalize_name(r["dong"]) != prow["행정동명"]:
            raise ValueError(f"이름 불일치 {r['code']}: 경계 {r['gu']} {r['dong']} / panel {prow['시군구명']} {prow['행정동명']}")
        if r["sgg"] != r["code"][:5]:
            raise ValueError(f"시군구코드 불일치 {r['code']}: {r['sgg']}")
        features.append({"type": "Feature",
                         "properties": {"행정동코드": r["code"], "행정기관코드": r["code10"], "시군구코드": r["sgg"],
                                        "시군구명": prow["시군구명"], "행정동명": prow["행정동명"],
                                        "경계_행정동명": r["dong"], "경계_출처": r.get("source", VUSKI_SOURCE)},
                         "geometry": r["geometry_json"]})
    return {"type": "FeatureCollection", "name": "인천_행정동경계_2026",
            "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
            "features": features}


def build_crosswalk(old: list[dict], new: list[dict]) -> list[dict]:
    tree = STRtree([r["geom"] for r in new])
    out, covered = [], {}
    for o in sorted(old, key=lambda x: x["code"]):
        hits = []
        for i in tree.query(o["geom"]):
            n = new[i]
            inter = o["geom"].intersection(n["geom"]).area
            a, b = inter / o["geom"].area, inter / n["geom"].area
            if a >= NOISE or b >= NOISE:
                hits.append((n, a, b))
        if len(hits) == 1 and hits[0][1] >= SAME and hits[0][2] >= SAME:
            n = hits[0][0]
            if normalize_name(n["dong"]) != normalize_name(o["dong"]):
                raise ValueError(f"1:1 영역인데 이름이 다름: {o['code']} {o['dong']} → {n['code']} {n['dong']}")
            rel = "1:1"
        elif len(hits) > 1 and all(b >= SAME for _, _, b in hits) and sum(a for _, a, _ in hits) >= SAME:
            rel = "분동"
        else:
            raise ValueError(f"허용되지 않은 관계(통합/경계 변경): {o['code']} {o['gu']} {o['dong']} → "
                             + ", ".join(f"{n['code']} {n['dong']} ({a:.4f}/{b:.4f})" for n, a, b in hits))
        for n, a, b in sorted(hits, key=lambda h: h[0]["code"]):
            if n["code"] in covered:
                raise ValueError(f"2026 행정동 {n['code']} 이 여러 2024 행정동에서 옴 (통합)")
            covered[n["code"]] = o["code"]
            out.append({"구_행정동코드": o["code"], "구_시군구명": o["gu"], "구_행정동명": o["dong"],
                        "신_행정동코드": n["code"], "신_시군구명": n["gu"], "신_행정동명": n["dong"],
                        "관계": rel, "구기준_겹침비율": f"{a:.4f}", "신기준_겹침비율": f"{b:.4f}"})
    missing = set(r["code"] for r in new) - set(covered)
    if missing:
        raise ValueError(f"2024 경계에서 오지 않은 2026 행정동: {sorted(missing)}")
    return out


def write_outputs(boundary: dict, crosswalk: list[dict]) -> list[str]:
    os.makedirs(GEO_DIR, exist_ok=True)
    bpath = os.path.join(GEO_DIR, BOUNDARY_OUT)
    with open(bpath, "w", encoding="utf-8", newline="\n") as f:
        json.dump(boundary, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    cpath = os.path.join(GEO_DIR, CROSSWALK_OUT)
    with open(cpath, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=CROSSWALK_COLUMNS, lineterminator="\n")
        w.writeheader()
        w.writerows(crosswalk)
    return [bpath, cpath]


def manifest_entries() -> dict:
    files = {}
    for version, (fn, url) in RAW.items():
        files[f"raw/{fn}"] = {"sha256": sha256(os.path.join(RAW_DIR, fn)), "url": url, "git": False}
    files[SGIS_BOUNDARY] = {"sha256": sha256(os.path.join(GEO_DIR, SGIS_BOUNDARY)), "source": SGIS_SOURCE, "git": True}
    for fn in (BOUNDARY_OUT, CROSSWALK_OUT):
        files[fn] = {"sha256": sha256(os.path.join(GEO_DIR, fn)), "git": True}
    return {"description": "data/geo 원본(raw, git 제외)·SGIS 공식 경계 입력·가공 파일 해시. scripts/build_geo.py 로 재생성",
            "source": "github.com/vuski/admdongkor (원천 통계청 SGIS, 공공누리 1유형 / 가공 CC BY 4.0) "
                      f"+ 통계청 SGIS OpenAPI 행정경계 {SGIS_YEAR} (구월1동·구월3동 교정, D-017)",
            "files": files}


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")
    old, new = load_incheon("2024"), load_incheon("2026")
    panel = load_panel()
    boundary = build_boundary(apply_sgis_corrections(new, load_sgis(), panel), panel)
    crosswalk = build_crosswalk(old, new)          # 2024 ↔ 2026 원본끼리 (개편 관계 기록용, 교정 전)
    write_outputs(boundary, crosswalk)
    rel = pd.Series([r["관계"] for r in crosswalk]).value_counts().to_dict()
    print(f"2024 {len(old)}개 → 2026 {len(new)}개, crosswalk {len(crosswalk)}행 {rel}, SGIS 교정 {len(SGIS_CORRECTIONS)}쌍")

    entries = manifest_entries()
    if "--manifest" in sys.argv:
        if os.path.exists(MANIFEST):
            print(f"거부: {MANIFEST} 이미 있음 (덮어쓰기 금지)", file=sys.stderr)
            return 1
        with open(MANIFEST, "w", encoding="utf-8", newline="\n") as f:
            json.dump(entries, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"매니페스트 생성: {MANIFEST}")
        return 0
    if os.path.exists(MANIFEST):
        with open(MANIFEST, encoding="utf-8") as f:
            want = json.load(f)["files"]
        diff = [k for k, v in entries["files"].items() if want.get(k, {}).get("sha256") != v["sha256"]]
        if diff:
            print("매니페스트와 다름: " + ", ".join(diff), file=sys.stderr)
            return 1
        print("매니페스트와 일치 (재현됨)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
