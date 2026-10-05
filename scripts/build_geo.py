"""
data/geo 가공 파일 생성 — 원본 행정동 경계(geojson)에서 인천 158개 행정동 경계와 2024→2026 crosswalk 를 만든다.

  python scripts/build_geo.py            가공 파일 생성. 매니페스트가 있으면 결과가 매니페스트와 같은지 검사(재현성)
  python scripts/build_geo.py --manifest 매니페스트 최초 생성 (이미 있으면 거부 — 덮어쓰기 금지)

원본 (data/geo/raw/, git 제외 — 다운로드 URL·sha256 은 tests/manifests/geo.sha256.json):
  HangJeongDong_ver20241231.geojson   2024 최종 행정동 경계 (개편 전 코드)
  HangJeongDong_ver20260701.geojson   2026-07-01 인천 개편 반영 경계 (runtime panel 과 같은 코드)
  출처: github.com/vuski/admdongkor (원천 통계청 SGIS, 공공누리 1유형 / 가공 CC BY 4.0)

가공 (data/geo/, commit):
  인천_행정동경계_2026.geojson   resolver 용. 2026 경계 158개, 좌표는 원본 그대로. 동 이름은 runtime panel 표기
  행정동_crosswalk_2024_2026.csv  검증용. 2024 행정동 → 2026 행정동 (면적 겹침 비율로 기계적으로 판정)

규칙 (docs/DECISIONS.md D-009): 추정 매핑 금지. 1:1(양방향 겹침 ≥ 0.995, 이름 동일) 또는 분동(2024 하나 → 2026 여럿,
2026 쪽 겹침 ≥ 0.995)만 허용하고, 그 밖의 경우(통합·경계 변경·이름 변경·panel 불일치)는 오류로 멈춘다.
"""
from __future__ import annotations

import csv
import hashlib
import json
import os
import sys

import pandas as pd
from shapely import STRtree
from shapely.geometry import shape

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
                                        "경계_행정동명": r["dong"]},
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
    for fn in (BOUNDARY_OUT, CROSSWALK_OUT):
        files[fn] = {"sha256": sha256(os.path.join(GEO_DIR, fn)), "git": True}
    return {"description": "data/geo 원본(raw, git 제외)과 가공 파일 해시. scripts/build_geo.py 로 재생성",
            "source": "github.com/vuski/admdongkor (원천 통계청 SGIS, 공공누리 1유형 / 가공 CC BY 4.0)",
            "files": files}


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")
    old, new = load_incheon("2024"), load_incheon("2026")
    panel = load_panel()
    boundary = build_boundary(new, panel)
    crosswalk = build_crosswalk(old, new)
    write_outputs(boundary, crosswalk)
    rel = pd.Series([r["관계"] for r in crosswalk]).value_counts().to_dict()
    print(f"2024 {len(old)}개 → 2026 {len(new)}개, crosswalk {len(crosswalk)}행 {rel}")

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
