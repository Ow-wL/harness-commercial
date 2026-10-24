"""
런타임 데이터 — 애플리케이션 시작 시 1회 로드한다.

run_all.py 의 모듈 최상단 로드 블록과 같은 파일·같은 인코딩·같은 dtype 으로 읽는다.
요청마다 다시 읽지 않는다 (인천_상가_정제.csv 135,750행 / 35MB).

데이터 버전 (docs/DATA_VERSIONING.md — 엔진 버전과 다른 축)
  디렉터리 선택  load_runtime(data_dir) 인자 > 환경변수 DATA_VERSION > DEFAULT_DATA_DIR(data/runtime).
                 DATA_VERSION 은 디렉터리 경로 또는 버전 id(data/versions/<id>).
  파일 찾기      <dir>/manifest.json 이 있으면 역할 키(ROLES) → manifest.roles[역할].file.
                 없으면(data/runtime) ROLE_FILES 기본 파일명 — 지금까지의 동작과 바이트 단위로 같다 (golden 이 이를 검사한다).
  기준일         RuntimeData.as_of(역할) — manifest.roles[역할].as_of, 없으면 LEGACY_AS_OF (sources/team_v0.3/00_README.md 데이터 표).
  읽기 호출(pd.read_csv 인자·dtype·인코딩·순서)은 데이터 버전과 무관하게 같다. 경로만 바뀐다.

엔진 v0.5(D-028)는 여기에 인구 면적 배분용 행정동 경계(data/geo/SGIS_행정동경계_2025_2Q_인천.geojson, scoring_engine/boundary.py)를
한 번 더 읽는다(RuntimeData.areas). 데이터 버전 역할 키가 아니라 엔진 v0.5 입력이다 — data/runtime·매니페스트 역할 8개는 그대로.
v0.3·v0.4 는 areas = None (읽지 않는다).
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Optional

import pandas as pd

from . import AREA_WEIGHTED, config as C, etl_location, etl_rent

build_anchor_points = etl_location.build_anchor_points
load_schools = etl_location.load_schools
load_stations = etl_location.load_stations
incheon_areas = etl_rent.incheon_areas
load_rent = etl_rent.load_rent

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DATA_DIR = os.path.join(ROOT, "data", "runtime")
VERSIONS_DIR = os.path.join(ROOT, "data", "versions")
DATA_VERSION_ENV = "DATA_VERSION"
MANIFEST_NAME = "manifest.json"
MANIFEST_SCHEMA = 1

# 파일명 → (읽기 인코딩, 엔진이 실제로 쓰는 필수 컬럼). tests/test_data_schema.py 가 검사한다.
RUNTIME_FILES = {
    "인천_상가_정제.csv": ("utf-8-sig", ["상가업소번호", "상호명", "지번주소", "도로명주소",   # nearby.py (4차)
                                       "상권업종대분류코드", "상권업종소분류코드", "시군구명", "행정동코드",
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

# 역할 키 → 기본 파일명 (data/runtime = 데이터 버전 2026-06). 매니페스트가 있는 버전은 이 이름을 따르지 않아도 된다
# (예: 패널_시장성_202609.csv). 인코딩·필수 컬럼은 RUNTIME_FILES[ROLE_FILES[역할]] 로 찾는다.
ROLE_FILES = {
    "shops": "인천_상가_정제.csv",
    "panel": "패널_통합.csv",
    "market_panel": "패널_시장성_202608.csv",
    "stability_pc": "패널_안정성.csv",
    "stability_food": "패널_안정성_음식.csv",
    "stations": "역사_전국도시철도.xlsx",
    "schools": "학교_전국.csv",
    "rent": "임대료_소규모상가_R-ONE.csv",
}
ROLES = tuple(ROLE_FILES)

# 매니페스트가 없는 디렉터리(data/runtime)의 버전 id 와 역할별 자료 기준일 — sources/team_v0.3/00_README.md 데이터 표, docs/DATA.md.
# 데이터를 바꾸면 새 버전 디렉터리의 manifest.json 에 적는다. 이 상수는 바꾸지 않는다.
LEGACY_VERSION_ID = "2026-06"
LEGACY_AS_OF = {
    "shops": "2026-06-30",          # 소진공 상가(상권)정보
    "panel": "2026-08-31",          # 행안부 주민등록 인구 (SGIS 종사자·1인가구는 2024)
    "market_panel": "2026-08",      # 수도권 생활이동(KT)
    "stability_pc": "2026-05-07",   # 인허가 인터넷컴퓨터게임시설제공업
    "stability_food": "2026-09-29", # 인허가 일반음식점·휴게음식점 (인천)
    "stations": "2024-12",          # 전국도시철도 역사정보
    "schools": "2026-03",           # 전국초중등학교 위치
    "rent": "2026Q2",               # R-ONE 소규모상가 임대료 (엔진 상수 etl_rent.QUARTERS 의 마지막 분기)
}


def biz_panel_columns() -> list[str]:
    """패널_통합.csv 에 업종별로 있어야 하는 컬럼 (업종명, 타겟_업종명, 타겟비중_업종명)."""
    cols = []
    for name in C.CODE_NAME.values():
        cols += [name, f"타겟_{name}", f"타겟비중_{name}"]
    return cols


@dataclass(frozen=True)
class DataVersion:
    """데이터 버전 메타 — 디렉터리, 역할 키 → 파일명, 역할별 자료 기준일. 파일을 읽지 않는다."""
    id: str
    data_dir: str
    files: dict = field(default_factory=dict)      # 역할 키 → 파일명 (디렉터리 기준 상대)
    as_of: dict = field(default_factory=dict)      # 역할 키 → 자료 기준일 문자열
    manifest: Optional[dict] = None                # manifest.json 내용 (없으면 None = data/runtime 동작)

    def path(self, role: str) -> str:
        return os.path.join(self.data_dir, self.files[role])

    def health(self) -> dict:
        """GET /health 의 data 블록 (version, as_of)."""
        return {"version": self.id, "as_of": {r: self.as_of[r] for r in ROLES}}


def version_dir(value: Optional[str]) -> str:
    """DATA_VERSION 값 → 디렉터리. 비어 있으면 DEFAULT_DATA_DIR, 경로처럼 보이거나 존재하는 디렉터리면 그대로,
    아니면 버전 id 로 보고 data/versions/<id>."""
    if not value:
        return DEFAULT_DATA_DIR
    if os.path.isdir(value) or os.sep in value or "/" in value:
        return os.path.abspath(value)
    return os.path.join(VERSIONS_DIR, value)


def read_manifest(data_dir: str) -> Optional[dict]:
    """<dir>/manifest.json — 없으면 None. 있으면 로더가 쓰는 최소 형식(schema·id·roles[*].file)만 검사한다.
    해시·컬럼·키 규칙은 scripts/etl/validate_version.py 가 검사한다."""
    path = os.path.join(data_dir, MANIFEST_NAME)
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as f:
        m = json.load(f)
    if not isinstance(m, dict) or m.get("schema") != MANIFEST_SCHEMA:
        raise ValueError(f"{path}: schema {m.get('schema') if isinstance(m, dict) else m!r} — 지원 {MANIFEST_SCHEMA}")
    if not isinstance(m.get("id"), str) or not m["id"]:
        raise ValueError(f"{path}: id 가 비어 있다")
    roles = m.get("roles")
    if not isinstance(roles, dict):
        raise ValueError(f"{path}: roles 가 없다")
    missing = [r for r in ROLES if not isinstance(roles.get(r), dict) or not roles[r].get("file")]
    if missing:
        raise ValueError(f"{path}: 역할 키의 file 누락 {missing}")
    unknown = sorted(set(roles) - set(ROLES))
    if unknown:
        raise ValueError(f"{path}: 모르는 역할 키 {unknown} (가능: {list(ROLES)})")
    for r in ROLES:
        if os.path.basename(roles[r]["file"]) != roles[r]["file"]:
            raise ValueError(f"{path}: roles.{r}.file 은 디렉터리 없는 파일명이어야 한다: {roles[r]['file']!r}")
    return m


def resolve_data_version(data_dir: Optional[str] = None) -> DataVersion:
    """데이터 버전 결정. data_dir 인자 > 환경변수 DATA_VERSION > data/runtime. 파일 내용은 읽지 않는다."""
    d = os.path.abspath(data_dir) if data_dir else version_dir(os.environ.get(DATA_VERSION_ENV))
    if not os.path.isdir(d):
        raise FileNotFoundError(f"데이터 디렉터리 없음: {d} ({DATA_VERSION_ENV}={os.environ.get(DATA_VERSION_ENV)!r})")
    m = read_manifest(d)
    if m is None:
        return DataVersion(id=LEGACY_VERSION_ID, data_dir=d, files=dict(ROLE_FILES), as_of=dict(LEGACY_AS_OF))
    files = {r: m["roles"][r]["file"] for r in ROLES}
    as_of = {r: str(m["roles"][r].get("as_of") or LEGACY_AS_OF[r]) for r in ROLES}
    return DataVersion(id=m["id"], data_dir=d, files=files, as_of=as_of, manifest=m)


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
    version: Optional[DataVersion] = None   # 데이터 버전 메타 (load_runtime 이 채운다)
    areas: Optional[object] = None          # v0.5: 행정동 경계 면적 배분 (boundary.ReusedAreas — 중심점 가중치 재사용). v0.3·v0.4 None

    def as_of(self, role: str) -> str:
        """역할 키의 자료 기준일 — 매니페스트 값, 없으면 LEGACY_AS_OF."""
        if self.version is not None:
            return self.version.as_of[role]
        return LEGACY_AS_OF[role]

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


def load_runtime(data_dir: Optional[str] = None) -> RuntimeData:
    """data_dir: 데이터 디렉터리 (None = 환경변수 DATA_VERSION, 없으면 data/runtime). 읽기 호출은 버전과 무관하게 같다."""
    v = resolve_data_version(data_dir)
    p = v.path
    shops = pd.read_csv(p("shops"), encoding="utf-8-sig", low_memory=False)
    panel = pd.read_csv(p("panel"), encoding="utf-8-sig")
    mkt = pd.read_csv(p("market_panel"), encoding="utf-8-sig", dtype={"시군구코드": str})
    stab = pd.read_csv(p("stability_pc"), encoding="utf-8-sig")
    stab["업종코드"] = "R10406"               # PC방 패널에는 업종코드 열이 없다 (run_all.py 와 동일)
    stab_food = pd.read_csv(p("stability_food"), encoding="utf-8-sig")
    stability = pd.concat([stab, stab_food], ignore_index=True)
    stations = load_stations(p("stations"))
    schools = load_schools(p("schools"))
    anchors = build_anchor_points(schools, shops)
    centroids = shops.groupby(["시군구명", "행정동명"])[["위도", "경도"]].mean().reset_index()
    rent = incheon_areas(load_rent(p("rent")))
    areas = None
    if AREA_WEIGHTED:                          # v0.5: 경계 1회 로드, 비교 모집단 중심점의 면적 가중치는 업종과 무관하게 재사용
        from .boundary import ReusedAreas, load_dong_areas
        areas = ReusedAreas(load_dong_areas(panel), zip(centroids["위도"], centroids["경도"]))
    return RuntimeData(shops=shops, panel=panel, market=mkt, stability=stability, stations=stations,
                       schools=schools, anchors=anchors, centroids=centroids, rent=rent,
                       data_dir=v.data_dir, version=v, areas=areas)
