"""
SGIS 공식 행정동 경계(구월1동·구월3동) 받기 — scripts/build_geo.py 의 SGIS 교정 입력 (docs/DECISIONS.md D-017).

  python scripts/fetch_sgis_boundary.py

네트워크·인증(.env 의 SGIS_CONSUMER_KEY / SGIS_CONSUMER_SECRET)이 필요하다. runtime·check 에서는 실행하지 않는다.
저장하는 것: data/geo/SGIS_행정동경계_2025_남동구_구월.geojson — feature 의 adm_cd·adm_nm 과 geometry(UTM-K 응답 좌표 그대로),
provenance(API·연도·요청 인자·CRS). 인증값·access token·응답 메타(trId 등)는 저장·출력하지 않는다.
파일이 이미 있으면 새로 받은 내용과 바이트 비교만 하고 덮어쓰지 않는다 (다르면 실패 — 경계 교체는 새 결정과 함께).

검사 (하나라도 어긋나면 저장하지 않고 중단):
  1. 최신 제공 연도 == build_geo.SGIS_YEAR (다음 연도가 열렸으면 결정을 다시 해야 한다)
  2. 남동구 하위 행정동 = data/geo 남동구 20개 행정동과 이름 집합이 같다 (2026 체계와 호환)
  3. 로컬 UTM-K → WGS84 변환(build_geo.utmk_to_wgs84)이 SGIS transcoord 결과와 1e-9° 안에서 같다
"""
from __future__ import annotations

import datetime
import json
import os
import sys

sys.dont_write_bytecode = True
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import build_geo as B  # noqa: E402
from sgis_api import SgisError, from_env  # noqa: E402

GU_ADM_CD = "23050"                      # SGIS 남동구 (통계용 코드)
GU_NAME = "인천광역시 남동구"
KEEP = ("인천광역시 남동구 구월1동", "인천광역시 남동구 구월3동")
TRANSFORM_TOL_DEG = 1e-9


def latest_year(sgis) -> int:
    this_year = datetime.date.today().year
    for year in range(this_year + 1, this_year - 5, -1):
        try:
            sgis.boundary(year, GU_ADM_CD, 0)
            return year
        except SgisError:
            continue
    raise SgisError("최근 5년 안에 제공 연도가 없다")


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")
    sgis = from_env()

    year = latest_year(sgis)
    print(f"SGIS hadmarea 최신 제공 연도: {year}")
    if year != B.SGIS_YEAR:
        print(f"중단: build_geo.SGIS_YEAR={B.SGIS_YEAR} 와 다르다 — 새 연도 경계로 교체할지 먼저 결정한다 (D-017)")
        return 2

    feats = sgis.boundary(year, GU_ADM_CD, 1)
    names = sorted(f["properties"]["adm_nm"] for f in feats)
    with open(os.path.join(B.GEO_DIR, B.BOUNDARY_OUT), encoding="utf-8") as f:
        ours = sorted(f"{GU_NAME} {ft['properties']['행정동명']}" for ft in json.load(f)["features"]
                      if ft["properties"]["시군구명"] == "남동구")
    print(f"남동구 하위 행정동 SGIS {len(names)}개 / data/geo {len(ours)}개")
    if names != ours:
        print(f"중단: 이름 집합이 다르다. SGIS만 {sorted(set(names) - set(ours))}, data/geo만 {sorted(set(ours) - set(names))}")
        return 2

    keep = sorted((f for f in feats if f["properties"]["adm_nm"] in KEEP), key=lambda f: f["properties"]["adm_nm"])
    if [f["properties"]["adm_nm"] for f in keep] != list(KEEP):
        print("중단: 구월1동·구월3동 feature 를 찾지 못함")
        return 2

    worst = 0.0
    for f in keep:
        ring = f["geometry"]["coordinates"][0] if f["geometry"]["type"] == "Polygon" else f["geometry"]["coordinates"][0][0]
        for x, y in ring[:: max(1, len(ring) // 5)][:5]:
            lat, lng = sgis.to_wgs84(x, y)
            lo, la = B.utmk_to_wgs84(x, y)
            worst = max(worst, abs(lat - la), abs(lng - lo))
    print(f"로컬 변환 vs SGIS transcoord 최대 차이 {worst:.2e}°")
    if worst > TRANSFORM_TOL_DEG:
        print("중단: 좌표 변환이 SGIS 와 다르다")
        return 3

    out = {"type": "FeatureCollection", "name": os.path.splitext(B.SGIS_BOUNDARY)[0],
           "provenance": {"source": "통계청 SGIS OpenAPI (sgisapi.mods.go.kr)", "api": "/OpenAPI3/boundary/hadmarea.geojson",
                          "year": year, "adm_cd": GU_ADM_CD, "low_search": 1, "kept": list(KEEP), "crs": "EPSG:5179",
                          "note": "응답 geometry 좌표 그대로. 인증값·token·응답 메타 없음. scripts/fetch_sgis_boundary.py"},
           "features": [{"type": "Feature",
                         "properties": {"adm_cd": f["properties"]["adm_cd"], "adm_nm": f["properties"]["adm_nm"]},
                         "geometry": f["geometry"]} for f in keep]}
    data = (json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    path = os.path.join(B.GEO_DIR, B.SGIS_BOUNDARY)
    if os.path.exists(path):
        with open(path, "rb") as f:
            same = f.read() == data
        print("기존 파일과 같다 (재현됨)" if same else "기존 파일과 다르다 — 덮어쓰지 않는다 (경계 교체는 새 결정과 함께)")
        return 0 if same else 1
    with open(path, "wb") as f:
        f.write(data)
    print(f"저장: {path} (API 호출 {sgis.calls}회)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
