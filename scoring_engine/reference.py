"""
비교 모집단(reference) 캐시.

비교 모집단은 런타임 데이터와 업종(또는 유인시설 집합)에만 의존하고 분석 지점과는 무관하다.
→ 프로세스 안에서 한 번 계산하면 모든 요청이 재사용할 수 있다.

  competition(biz, radius_m)  158개 행정동 중심점 × radius_profile  ((업종, 반경)마다 다름, v0.3 은 29개)
  location(biz)     158개 행정동 중심점 × site_profile     (유인시설 집합마다 다름, run_all.py 와 같은 키)
  stability(biz)    시군구별 안정성 분포                    (업종마다 다름, 가벼움)

계산식은 v0.3 엔진 함수(radius_demand.build_reference, etl_location.site_profile)를 그대로 호출한다.
디스크 캐시(data/cache/)는 아직 쓰지 않는다 (docs/ARCHITECTURE.md "캐시 경계").

잠금 (8-D2a, docs/UX_REDESIGN.md 4.7)
  hit   잠금 없이 dict 에서 읽는다. 값은 계산이 끝난 뒤에만 넣으므로(한 번의 dict 대입) 반쯤 만든 값은 보이지 않는다.
        → 이미 계산된 키의 요청은 다른 키의 build 를 기다리지 않는다.
  miss  build 실행권 하나로 계산을 한 번에 하나씩 한다(공유 DataFrame 을 여러 스레드가 동시에 계산하지 않는다 — 지금과 같음).
        실행권을 얻은 뒤 다시 확인하므로 같은 키는 한 번만 계산한다. 계산이 실패하면 아무것도 넣지 않고 실행권을 돌려준다
        (기다리던 스레드가 이어서 진행, 다음 요청이 다시 계산).
  warm  background(warm) 계산은 요청(foreground)이 실행권을 기다리는 동안 실행권을 얻지 않는다(양보).
        실행 중 여부(_building)와 대기 요청 수(_foreground_waiting)는 Condition 하나(_state)가 지킨다 — warm 의
        "대기 요청 확인"과 "실행권 예약"은 같은 잠금 안에서 한 번에 일어난다(확인 뒤 예약 전에 요청이 끼어드는 틈 없음).
        잠금은 _state 하나뿐이고 build() 는 그 잠금 밖에서 돈다(교착 없음).
        → 요청의 miss 대기는 "진행 중인(또는 이미 예약된) build 1개 + 다른 대기 요청들의 build + 자기 build" 이고 warm 에
          계속 밀리지 않는다. 대기 요청들 사이의 순서(FIFO)는 보장하지 않는다(Condition 깨움 순서).
"""
from __future__ import annotations

import threading
from typing import Optional

import pandas as pd

from . import RADIUS_OPTIONS_M, config as C, etl_location, radius_demand
from .runtime import RuntimeData

LOC_REF_KEYS = ["역세권_강도", "유인시설_근접도", "최근접역_거리m"]


class ReferenceCache:
    def __init__(self, rt: RuntimeData):
        self.rt = rt
        self._competition: dict[tuple[str, int], tuple[pd.DataFrame, pd.DataFrame]] = {}
        self._location: dict[tuple, dict] = {}
        self._state = threading.Condition()            # 아래 두 값을 지킨다 (hit 은 잡지 않는다)
        self._building = False                         # build 실행권 — 한 번에 하나
        self._foreground_waiting = 0                   # 실행권을 기다리는 요청 수 — warm 양보용
        self._background = threading.local()           # 이 스레드가 warm() 안에서 계산 중인지

    def _acquire_build(self, background: bool) -> None:
        """build 실행권을 얻는다. 요청은 실행 중인 build 가 없으면, warm 은 그에 더해 기다리는 요청도 없으면 얻는다.
        조건 확인과 예약(_building = True)이 같은 잠금 안이라 warm 이 확인한 뒤 요청이 끼어들 틈이 없다."""
        with self._state:
            if background:
                self._state.wait_for(lambda: not self._building and self._foreground_waiting == 0)
            else:
                self._foreground_waiting += 1
                try:
                    self._state.wait_for(lambda: not self._building)
                finally:
                    self._foreground_waiting -= 1      # 얻었거나(아래 예약) 대기 중 예외 — 둘 다 더는 대기자가 아니다
            self._building = True

    def _release_build(self) -> None:
        with self._state:
            self._building = False
            self._state.notify_all()                   # 요청·warm 모두 깨워 조건을 다시 보게 한다

    def _get(self, store: dict, key, build):
        """hit 은 잠금 없이, miss 는 build 실행권을 얻은 뒤 다시 확인하고 한 번만 계산한다."""
        value = store.get(key)
        if value is not None:
            return value
        self._acquire_build(getattr(self._background, "active", False))
        try:
            value = store.get(key)
            if value is None:
                value = build()
                store[key] = value
            return value
        finally:
            self._release_build()

    # ── 경쟁성 ──────────────────────────────────────────────
    def competition(self, biz: str, radius_m: int | None = None) -> tuple[pd.DataFrame, pd.DataFrame]:
        """(158개 행정동 반경 프로파일 표, 행정동별 전체 점포수). 반경마다 비교 모집단이 다르다(D-024)."""
        key = (biz, C.RADIUS_M if radius_m is None else radius_m)
        return self._get(self._competition, key, lambda: radius_demand.build_reference(
            self.rt.shops, self.rt.panel[["시군구명", "행정동명", "총인구"]], biz, key[1]))

    # ── 입지성 ──────────────────────────────────────────────
    @staticmethod
    def anchor_key(biz: str) -> tuple:
        return tuple(C.ANCHOR.get(biz, C.DEFAULT_ANCHOR))

    def location(self, biz: str) -> dict:
        """유인시설 집합이 같은 업종끼리 공유한다 (run_all.loc_for 의 _loc_cache 와 같은 키)."""
        key = self.anchor_key(biz)

        def build() -> dict:
            ref = [etl_location.site_profile(r["위도"], r["경도"], self.rt.stations, self.rt.anchors, biz)
                   for _, r in self.rt.centroids.iterrows()]
            d = {k: [x[k] for x in ref] for k in LOC_REF_KEYS}
            d["유인시설_종류별"] = {t: [x["유인시설_종류별"].get(t, 0.0) for x in ref] for t in key}
            return d
        return self._get(self._location, key, build)

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
    def warm(self, biz_codes=None, radii=None) -> None:
        """애플리케이션 시작 시 미리 계산해 둘 때 쓴다(background — 요청에 양보). radii 기본 = 엔진이 받는 반경 전부."""
        self._background.active = True
        try:
            for biz in (biz_codes or C.CODE_NAME):
                for r in (radii or RADIUS_OPTIONS_M):
                    self.competition(biz, r)
                self.location(biz)
        finally:
            self._background.active = False

    def stats(self) -> dict:
        return {"competition_entries": len(self._competition), "location_entries": len(self._location)}
