"""
비교 모집단(reference) 캐시.

비교 모집단은 런타임 데이터와 업종(또는 유인시설 집합)에만 의존하고 분석 지점과는 무관하다.
→ 프로세스 안에서 한 번 계산하면 모든 요청이 재사용할 수 있다.

  competition(biz)  158개 행정동 중심점 × radius_profile  (업종마다 다름, 29개)
  location(biz)     158개 행정동 중심점 × site_profile     (유인시설 집합마다 다름, run_all.py 와 같은 키)
  stability(biz)    시군구별 안정성 분포                    (업종마다 다름, 가벼움)

계산식은 v0.3 엔진 함수(radius_demand.build_reference, etl_location.site_profile)를 그대로 호출한다.
디스크 캐시(data/cache/)는 아직 쓰지 않는다 (docs/ARCHITECTURE.md "캐시 경계").
"""
from __future__ import annotations

import threading
from typing import Optional

import pandas as pd

from . import config as C, etl_location, radius_demand
from .runtime import RuntimeData

LOC_REF_KEYS = ["역세권_강도", "유인시설_근접도", "최근접역_거리m"]


class ReferenceCache:
    def __init__(self, rt: RuntimeData):
        self.rt = rt
        self._competition: dict[str, tuple[pd.DataFrame, pd.DataFrame]] = {}
        self._location: dict[tuple, dict] = {}
        self._lock = threading.Lock()

    # ── 경쟁성 ──────────────────────────────────────────────
    def competition(self, biz: str) -> tuple[pd.DataFrame, pd.DataFrame]:
        """(158개 행정동 반경 프로파일 표, 행정동별 전체 점포수)."""
        with self._lock:
            if biz not in self._competition:
                self._competition[biz] = radius_demand.build_reference(
                    self.rt.shops, self.rt.panel[["시군구명", "행정동명", "총인구"]], biz, C.RADIUS_M)
            return self._competition[biz]

    # ── 입지성 ──────────────────────────────────────────────
    @staticmethod
    def anchor_key(biz: str) -> tuple:
        return tuple(C.ANCHOR.get(biz, C.DEFAULT_ANCHOR))

    def location(self, biz: str) -> dict:
        """유인시설 집합이 같은 업종끼리 공유한다 (run_all.loc_for 의 _loc_cache 와 같은 키)."""
        key = self.anchor_key(biz)
        with self._lock:
            if key not in self._location:
                ref = [etl_location.site_profile(r["위도"], r["경도"], self.rt.stations, self.rt.anchors, biz)
                       for _, r in self.rt.centroids.iterrows()]
                d = {k: [x[k] for x in ref] for k in LOC_REF_KEYS}
                d["유인시설_종류별"] = {t: [x["유인시설_종류별"].get(t, 0.0) for x in ref] for t in key}
                self._location[key] = d
            return self._location[key]

    # ── 안정성 ──────────────────────────────────────────────
    def stability(self, biz: str) -> Optional[dict]:
        """구별 기준 분포. 3년 표본 MIN_COHORT_N_GUGU 미만 구는 뺀다. 데이터 없는 업종은 None."""
        t = self.rt.stability[self.rt.stability.업종코드 == biz]
        if t.empty:
            return None
        gu = t[(t.시군구 != "__인천전체__") & (t.표본_3년 >= C.MIN_COHORT_N_GUGU)]
        return {"survival_3y": gu["생존율_3년"].tolist(), "closure_rate": gu["최근3년_폐업률"].tolist(),
                "avg_tenure": gu["평균업력_년"].tolist()}

    def stability_row(self, biz: str, gu_name: str):
        """분석 지점이 속한 시군구의 안정성 행과 3년 표본수. 없으면 (None, 0)."""
        t = self.rt.stability[(self.rt.stability.업종코드 == biz) & (self.rt.stability.시군구 == gu_name)]
        if t.empty:
            return None, 0
        return t.iloc[0], int(t.iloc[0]["표본_3년"])

    # ── 관리 ────────────────────────────────────────────────
    def warm(self, biz_codes=None) -> None:
        """애플리케이션 시작 시 미리 계산해 둘 때 쓴다."""
        for biz in (biz_codes or C.CODE_NAME):
            self.competition(biz)
            self.location(biz)

    def stats(self) -> dict:
        return {"competition_entries": len(self._competition), "location_entries": len(self._location)}
