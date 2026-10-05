#!/usr/bin/env python3
"""
반경 기반 수요·경쟁 지표 — 분자와 분모의 기준을 일치시킨다.

해결하는 문제:
  반경 500m가 여러 행정동에 걸치면, 점포는 4개 동에서 세면서
  인구는 1개 동만 쓰는 비대칭이 생긴다. 분석지점이 부당하게 불리해진다.

방법 — 점포밀도 면적가중(areal weighting):
  반경 안에 걸친 각 행정동 d에 대해
      w_d = (반경 내 d의 점포수) / (d의 전체 점포수)
  로 인구를 배분한다.
      반경수요 = Σ_d  w_d × 인구_d
  행정동 경계 폴리곤 없이 계산되며, 점포 분포를 '활동이 일어나는 곳'의
  프록시로 삼는다. 경계 GeoJSON이 확보되면 실면적 가중으로 교체할 것.

비교 모집단도 동일한 방식으로 만든다:
  158개 행정동의 점포 중심점을 '가상의 분석지점'으로 두고 같은 계산을 돌린다.
  → 분석지점과 모집단이 같은 규칙으로 산출되므로 백분위가 유효해진다.
"""
import numpy as np
import pandas as pd


def haversine_m(lat0, lng0, lats, lngs):
    R = 6_371_000.0
    p1, p2 = np.radians(lat0), np.radians(np.asarray(lats, dtype=float))
    dl = np.radians(np.asarray(lngs, dtype=float) - lng0)
    a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * R * np.arcsin(np.sqrt(a))


def radius_profile(lat, lng, shops, pop_by_dong, biz_code, radius_m=500,
                   pop_col="총인구", dong_total_shops=None):
    """
    한 지점의 반경 프로파일.
    반환: n_all, n_same, 반경수요, 점포당수요, 걸친 행정동별 가중치
    """
    d = haversine_m(lat, lng, shops["위도"].values, shops["경도"].values)
    m = d <= radius_m
    near = shops[m]
    n_all = int(m.sum())
    n_same = int((shops["상권업종소분류코드"].values[m] == biz_code).sum())

    in_radius = near.groupby(["시군구명", "행정동명"]).size().rename("반경내점포")
    parts = in_radius.reset_index().merge(dong_total_shops, on=["시군구명", "행정동명"], how="left")
    parts["w"] = (parts["반경내점포"] / parts["전체점포수"]).clip(upper=1.0)
    parts = parts.merge(pop_by_dong, on=["시군구명", "행정동명"], how="left")
    parts["배분인구"] = parts["w"] * parts[pop_col].fillna(0)

    demand = float(parts["배분인구"].sum())
    return {
        "n_all": n_all,
        "n_same": n_same,
        "반경수요": demand,
        "점포당수요": demand / n_same if n_same else None,
        "동종비중": n_same / n_all if n_all else None,
        "걸친행정동": parts[["시군구명", "행정동명", "w", "배분인구"]]
                      .sort_values("배분인구", ascending=False).to_dict("records"),
    }


def build_reference(shops, pop_by_dong, biz_code, radius_m=500, pop_col="총인구"):
    """158개 행정동 중심점을 가상 분석지점으로 삼아 비교 모집단을 만든다."""
    dong_total = shops.groupby(["시군구명", "행정동명"]).size().rename("전체점포수").reset_index()
    cent = shops.groupby(["시군구명", "행정동명"])[["위도", "경도"]].mean().reset_index()
    rows = []
    for _, c in cent.iterrows():
        p = radius_profile(c["위도"], c["경도"], shops, pop_by_dong, biz_code,
                           radius_m, pop_col, dong_total)
        rows.append({"시군구명": c["시군구명"], "행정동명": c["행정동명"],
                     "반경_전체점포": p["n_all"], "반경_동종점포": p["n_same"],
                     "반경_수요": p["반경수요"], "반경_점포당수요": p["점포당수요"],
                     "반경_동종비중": p["동종비중"]})
    return pd.DataFrame(rows), dong_total
