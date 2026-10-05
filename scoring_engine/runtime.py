"""
런타임 데이터 — 애플리케이션 시작 시 1회 로드한다.

run_all.py 의 모듈 최상단 로드 블록과 같은 파일·같은 인코딩·같은 dtype 으로 읽는다.
요청마다 다시 읽지 않는다 (인천_상가_정제.csv 135,750행 / 35MB).
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

import pandas as pd

from . import config as C, etl_location, etl_rent

build_anchor_points = etl_location.build_anchor_points
load_schools = etl_location.load_schools
load_stations = etl_location.load_stations
incheon_areas = etl_rent.incheon_areas
load_rent = etl_rent.load_rent

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DATA_DIR = os.path.join(ROOT, "data", "runtime")

# 파일명 → (읽기 인코딩, 엔진이 실제로 쓰는 필수 컬럼). tests/test_data_schema.py 가 검사한다.
RUNTIME_FILES = {
    "인천_상가_정제.csv": ("utf-8-sig", ["상권업종대분류코드", "상권업종소분류코드", "시군구명", "행정동코드",
                                       "행정동명", "경도", "위도"]),
    "패널_통합.csv": ("utf-8-sig", ["행정동코드", "행정동명", "시군구명", "총인구", "종사자수", "1인가구비중"]),
    "패널_시장성_202608.csv": ("utf-8-sig", ["시군구코드", "일평균_유입", "work_ratio"]
                              + [f"h{h:02d}" for h in range(24)]),
    "패널_안정성.csv": ("utf-8-sig", ["시군구", "생존율_3년", "표본_3년", "평균업력_년", "최근3년_폐업률"]),
    "패널_안정성_음식.csv": ("utf-8-sig", ["업종코드", "시군구", "생존율_3년", "표본_3년", "평균업력_년",
                                        "최근3년_폐업률"]),
    "학교_전국.csv": ("cp949", ["학교명", "학교급구분", "소재지도로명주소", "소재지지번주소", "위도", "경도"]),
    "역사_전국도시철도.xlsx": (None, ["역사명", "역위도", "역경도", "환승역구분", "환승노선명"]),
    "임대료_소규모상가_R-ONE.csv": ("cp949", None),   # 헤더 3줄 형식. etl_rent.load_rent 가 열 개수를 검증한다
}


def biz_panel_columns() -> list[str]:
    """패널_통합.csv 에 업종별로 있어야 하는 컬럼 (업종명, 타겟_업종명, 타겟비중_업종명)."""
    cols = []
    for name in C.CODE_NAME.values():
        cols += [name, f"타겟_{name}", f"타겟비중_{name}"]
    return cols


@dataclass
class RuntimeData:
    shops: pd.DataFrame          # 인천 상가 점포 (좌표·업종)
    panel: pd.DataFrame          # 인천 158개 행정동 패널
    market: pd.DataFrame         # 11개 시군구 생활이동 (시장성)
    stability: pd.DataFrame      # PC방 + 음식 14업종 안정성 (시군구 단위)
    stations: pd.DataFrame       # 인천권 물리적 역 (환승 병합)
    schools: pd.DataFrame        # 인천 초·중·고 (학교명·type·lat·lng)
    anchors: pd.DataFrame        # 유인시설 (학교 + 상가 기반 학원·독서실·오피스·병원)
    centroids: pd.DataFrame      # 행정동별 점포 중심점 (비교 모집단의 가상 분석지점)
    rent: pd.DataFrame           # 인천 9개 상권 임대료 (최신 분기)
    data_dir: str

    def rent_for(self, rent_area: Optional[str]) -> Optional[float]:
        if rent_area is None:
            return None
        hit = self.rent.loc[self.rent["상권"] == rent_area, "임대료_천원_㎡"]
        if hit.empty:
            raise KeyError(f"임대료 상권 '{rent_area}' 없음. 가능: {self.rent['상권'].tolist()}")
        return float(hit.iloc[0])

    def base_panel(self) -> dict:
        """업종·지점과 무관한 비교 모집단 (run_all.py 의 base dict 와 동일)."""
        panel, mkt = self.panel, self.market
        n = len(panel)
        nones = [None] * n
        base = {k: nones for k in ["pop_by_sex_age", "same_biz_net_change_1y", "station_strength",
                                   "anchor_strength", "nearest_station_m", "bus_stop_density",
                                   "survival_3y", "closure_rate", "avg_tenure", "gugu_rent_per_sqm",
                                   "gugu_spend_yoy"]}
        base["pop_total"] = panel["총인구"].tolist()
        base["workers"] = panel["종사자수"].tolist()
        base["solo_household_share"] = panel["1인가구비중"].tolist()
        base["inflow_daily"] = mkt["일평균_유입"].tolist()
        base["inflow_by_hour"] = [[float(r[f"h{h:02d}"]) for h in range(24)] for _, r in mkt.iterrows()]
        base["work_ratio"] = mkt["work_ratio"].tolist()
        base["gugu_rent_per_sqm"] = self.rent["임대료_천원_㎡"].tolist()
        return base


def load_runtime(data_dir: str = DEFAULT_DATA_DIR) -> RuntimeData:
    p = lambda name: os.path.join(data_dir, name)  # noqa: E731
    shops = pd.read_csv(p("인천_상가_정제.csv"), encoding="utf-8-sig", low_memory=False)
    panel = pd.read_csv(p("패널_통합.csv"), encoding="utf-8-sig")
    mkt = pd.read_csv(p("패널_시장성_202608.csv"), encoding="utf-8-sig", dtype={"시군구코드": str})
    stab = pd.read_csv(p("패널_안정성.csv"), encoding="utf-8-sig")
    stab["업종코드"] = "R10406"               # PC방 패널에는 업종코드 열이 없다 (run_all.py 와 동일)
    stab_food = pd.read_csv(p("패널_안정성_음식.csv"), encoding="utf-8-sig")
    stability = pd.concat([stab, stab_food], ignore_index=True)
    stations = load_stations(p("역사_전국도시철도.xlsx"))
    schools = load_schools(p("학교_전국.csv"))
    anchors = build_anchor_points(schools, shops)
    centroids = shops.groupby(["시군구명", "행정동명"])[["위도", "경도"]].mean().reset_index()
    rent = incheon_areas(load_rent(p("임대료_소규모상가_R-ONE.csv")))
    return RuntimeData(shops=shops, panel=panel, market=mkt, stability=stability, stations=stations,
                       schools=schools, anchors=anchors, centroids=centroids, rent=rent,
                       data_dir=data_dir)
