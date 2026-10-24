#!/usr/bin/env python3
"""
v0.5 — 행정동 경계로 '반경 500m 안 인구'를 면적 비율로 배분한다.

왜 바꿨나
  v0.2~v0.4는 경계 파일 없이 '점포 분포'로 인구를 배분했다.
      w_d = (반경 안 d의 점포 수) / (d의 전체 점포 수)
  그런데 이 방식은 점포가 몰린 곳에 사람도 몰려 사는 것으로 가정한다.
  번화가 중심점은 주변 동의 점포 대부분을 반경 안에 담으므로 인구를 과하게 배분받는다.
  고객성(타겟 인구)을 반경 기준으로 바꾸자 이 편향이 그대로 번화가 가점이 됐다(재검토 5장 점검).
  → 행정동 경계(SGIS 2025년 2분기)로 '원과 동이 겹치는 면적 ÷ 동 면적'을 쓴다.
      w_d = |원 ∩ 동 d| / |동 d|,   반경 인구 = Σ_d w_d × 인구_d
  가정: 동 안에서는 인구가 고르게 산다(산·공단·바다가 넓은 동은 과소 배분될 수 있다).

입력
  bnd_dong_00_2025_2Q.shp/.dbf  SGIS 행정동 경계 (EPSG:5179, UTM-K, 미터)
  ※ 경계는 2026-07 인천 행정구역 개편 이전 기준. 행정동명은 대체로 유지되어 동명으로 붙인다
    (etl_sgis.py와 같은 규칙). 신설 분동(아라1·2동, 운서1·2동)은 모체 동 경계를 인구 비율로 나눠 쓴다.

계산
  원 안에 20m 간격 격자점(약 1,960개)을 깔고, 각 점이 어느 동 경계 안에 있는지 센다.
  pyproj·shapely 없이 numpy + matplotlib.path로만 계산한다.
"""
import struct
import numpy as np
import pandas as pd
from matplotlib.path import Path

from etl_sgis import read_dbf, norm_dong, SPLIT_PARENT

# EPSG:5179 (GRS80, TM) 역변환 상수
_A, _F = 6378137.0, 1 / 298.257222101
_LAT0, _LON0, _K0, _X0, _Y0 = np.radians(38.0), np.radians(127.5), 0.9996, 1_000_000.0, 2_000_000.0
GRID_M = 20.0


def _inv_tm(x, y):
    a, f = _A, _F
    e2 = f * (2 - f); ep2 = e2 / (1 - e2)
    def M(phi):
        return a * ((1 - e2/4 - 3*e2**2/64 - 5*e2**3/256) * phi
                    - (3*e2/8 + 3*e2**2/32 + 45*e2**3/1024) * np.sin(2*phi)
                    + (15*e2**2/256 + 45*e2**3/1024) * np.sin(4*phi) - (35*e2**3/3072) * np.sin(6*phi))
    mu = (M(_LAT0) + (y - _Y0) / _K0) / (a * (1 - e2/4 - 3*e2**2/64 - 5*e2**3/256))
    e1 = (1 - np.sqrt(1 - e2)) / (1 + np.sqrt(1 - e2))
    p1 = (mu + (3*e1/2 - 27*e1**3/32) * np.sin(2*mu) + (21*e1**2/16 - 55*e1**4/32) * np.sin(4*mu)
          + (151*e1**3/96) * np.sin(6*mu) + (1097*e1**4/512) * np.sin(8*mu))
    C1 = ep2 * np.cos(p1)**2; T1 = np.tan(p1)**2
    N1 = a / np.sqrt(1 - e2 * np.sin(p1)**2); R1 = a * (1 - e2) / (1 - e2 * np.sin(p1)**2)**1.5
    D = (x - _X0) / (N1 * _K0)
    lat = p1 - (N1 * np.tan(p1) / R1) * (D**2/2 - (5 + 3*T1 + 10*C1 - 4*C1**2 - 9*ep2) * D**4/24
                                         + (61 + 90*T1 + 298*C1 + 45*T1**2 - 252*ep2 - 3*C1**2) * D**6/720)
    lon = _LON0 + (D - (1 + 2*T1 + C1) * D**3/6
                   + (5 - 2*C1 + 28*T1 - 3*C1**2 + 8*ep2 + 24*T1**2) * D**5/120) / np.cos(p1)
    return np.degrees(lat), np.degrees(lon)


def _read_polygons(shp_path, idx_keep):
    """shp에서 지정한 레코드(0부터)만 읽는다. 반환: {레코드번호: [링(경도,위도 배열), ...]}"""
    shx = open(shp_path[:-4] + ".shx", "rb").read()
    n = (len(shx) - 100) // 8
    offs = [struct.unpack(">i", shx[100 + 8*i:104 + 8*i])[0] * 2 for i in range(n)]
    out = {}
    with open(shp_path, "rb") as f:
        for i in idx_keep:
            f.seek(offs[i] + 8)
            st = struct.unpack("<i", f.read(4))[0]
            if st != 5:
                continue
            f.read(32)
            nparts, npts = struct.unpack("<ii", f.read(8))
            parts = struct.unpack(f"<{nparts}i", f.read(4 * nparts))
            xy = np.frombuffer(f.read(16 * npts), dtype="<f8").reshape(-1, 2)
            lat, lon = _inv_tm(xy[:, 0], xy[:, 1])
            ll = np.c_[lon, lat]
            bounds = list(parts) + [npts]
            out[i] = [ll[bounds[k]:bounds[k + 1]] for k in range(nparts)]
    return out


def _local_m(lon, lat, lon0, lat0):
    return (np.asarray(lon) - lon0) * 111_320 * np.cos(np.radians(lat0)), (np.asarray(lat) - lat0) * 110_540


def _ring_area_m2(ring):
    lon0, lat0 = ring[:, 0].mean(), ring[:, 1].mean()
    x, y = _local_m(ring[:, 0], ring[:, 1], lon0, lat0)
    return 0.5 * (np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))


def export_geojson(dbf_path, shp_path, out_path, sido_code="23"):
    """전국 경계 shp(135MB)에서 인천만 뽑아 위경도 GeoJSON으로 저장 (번들에는 이 파일만 넣는다)."""
    import json
    names = read_dbf(dbf_path).reset_index(drop=True)
    keep = names.index[names["ADM_CD"].str.startswith(sido_code)].tolist()
    polys = _read_polygons(shp_path, keep)
    feats = [{"type": "Feature", "properties": {"ADM_CD": names.loc[i, "ADM_CD"], "ADM_NM": names.loc[i, "ADM_NM"]},
              "geometry": {"type": "Polygon", "coordinates": [np.round(r, 6).tolist() for r in polys[i]]}}
             for i in keep if i in polys]
    json.dump({"type": "FeatureCollection", "기준": "SGIS 2025년 2분기 행정동 경계, EPSG:5179→WGS84",
               "features": feats}, open(out_path, "w"), ensure_ascii=False, separators=(",", ":"))
    print(f"[boundary] {len(feats)}개 행정동 → {out_path}")


class DongAreas:
    """인천 행정동 경계. panel의 (시군구명, 행정동명) 키로 접근한다.
    geojson_path: export_geojson()으로 만든 인천 경계 파일 (07_가공데이터/경계_인천_행정동.geojson)"""

    def __init__(self, geojson_path, panel):
        import json
        gj = json.load(open(geojson_path))
        by_key = {}
        for ft in gj["features"]:
            rings = [np.asarray(r, float) for r in ft["geometry"]["coordinates"]]
            # 외곽링(시계방향, 면적 음수)과 구멍(반시계)을 모두 even-odd 규칙으로 한 Path에 담는다
            verts = np.vstack([np.vstack([r, r[:1]]) for r in rings])
            codes = np.concatenate([[Path.MOVETO] + [Path.LINETO] * (len(r) - 1) + [Path.CLOSEPOLY] for r in rings])
            area = abs(sum(_ring_area_m2(r) for r in rings))   # 외곽(시계방향) +, 구멍(반시계) −
            by_key[norm_dong(ft["properties"]["ADM_NM"])] = {
                "path": Path(verts, codes), "area": area,
                "bbox": (verts[:, 0].min(), verts[:, 0].max(), verts[:, 1].min(), verts[:, 1].max())}
        self.items = []          # (시군구명, 행정동명, path, area, bbox, 인구비율)
        miss = []
        p = panel.copy()
        p["_key"] = p["행정동명"].map(norm_dong)
        p["_parent"] = p["행정동명"].map(lambda x: norm_dong(SPLIT_PARENT[x]) if x in SPLIT_PARENT else None)
        par_tot = p[p._parent.notna()].groupby("_parent")["총인구"].sum()
        for _, r in p.iterrows():
            k, ratio = r["_key"], 1.0
            if k not in by_key and r["_parent"] in by_key:
                k, ratio = r["_parent"], r["총인구"] / par_tot[r["_parent"]]
            if k not in by_key:
                miss.append(r["행정동명"]); continue
            b = by_key[k]
            self.items.append((r["시군구명"], r["행정동명"], b["path"], b["area"], b["bbox"], ratio))
        print(f"[boundary] 인천 행정동 경계 {len(by_key)}개 → 패널 {len(self.items)}/{len(p)}개 연결"
              + (f", 미연결 {miss}" if miss else ""))

    def weights(self, lat, lng, radius_m=500):
        """반환 DataFrame[시군구명, 행정동명, w]  w = |원 ∩ 동| / |동| (분동은 인구 비율을 곱한 값)"""
        g = np.arange(-radius_m + GRID_M / 2, radius_m, GRID_M)
        gx, gy = np.meshgrid(g, g)
        m = gx**2 + gy**2 <= radius_m**2
        gx, gy = gx[m], gy[m]
        lon = lng + gx / (111_320 * np.cos(np.radians(lat))); la = lat + gy / 110_540
        pts = np.c_[lon, la]
        dlon, dlat = radius_m / (111_320 * np.cos(np.radians(lat))), radius_m / 110_540
        rows = []
        for gu, dong, path, area, (x0, x1, y0, y1), ratio in self.items:
            if x1 < lng - dlon or x0 > lng + dlon or y1 < lat - dlat or y0 > lat + dlat:
                continue
            n = int(path.contains_points(pts).sum())
            if n:
                rows.append((gu, dong, min(1.0, n * GRID_M**2 / area) * ratio))
        return pd.DataFrame(rows, columns=["시군구명", "행정동명", "w"])
