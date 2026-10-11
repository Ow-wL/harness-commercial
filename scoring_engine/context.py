"""
분석 지점 컨텍스트.

v0.3 run_all.py 는 지점 정보를 모듈 상수로 하드코딩한다:
  LAT, LNG, GU = 37.4894, 126.7246, "28237"
  panel[(시군구명=="부평구") & (행정동명=="부평1동")]   STAB 시군구 == "부평구"   RENT_AREA = "부평"
여기서는 그 값을 SiteContext 하나로 모아 명시적 파라미터로 만든다.

SiteContext 를 만드는 경로는 두 가지다.
  - 웹 요청 (POST /analyze): location.ContextBuilder.build(lat, lng) 가 LocationResolver(2026-07 인천 행정동 경계
    point-in-polygon, 구월1·3동 SGIS 교정)로 행정동·시군구를 정해 만든다. rent_area 는 항상 None (D-015),
    반경 500m 안 점포가 0개면 NoDataNearby (D-011).
  - golden regression: 아래 BUPYEONG_STATION 고정값 (v0.3 05_분석결과를 만든 지점, rent_area="부평").
  같은 부평역 좌표라도 두 경로는 rent_area 가 달라 안정성(S4 포함 여부)·종합 점수가 다를 수 있다.
  docs/ARCHITECTURE.md 4장, docs/SCORE_EXPLANATION_AUDIT.md 5장 참고.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class SiteContext:
    label: str                 # 화면·query 문구용 지점 이름 (예: "부평역")
    lat: float                 # WGS84
    lng: float
    gu_code: str               # 시군구코드 5자리 (패널_시장성 의 시군구코드, 행정동코드 앞 5자리)
    gu_name: str               # 시군구명 (패널_통합·패널_안정성 의 시군구명/시군구)
    dong_name: str             # 행정동명 (패널_통합 의 행정동명)
    rent_area: Optional[str]   # R-ONE 소규모상가 상권명. 명시적으로 연결된 지점만. 없으면 None → S4 제외

    @property
    def display_dong(self) -> str:
        return f"{self.gu_name} {self.dong_name}"


# v0.3 golden 결과(05_분석결과)를 만든 유일한 분석 지점
BUPYEONG_STATION = SiteContext(
    label="부평역", lat=37.4894, lng=126.7246,
    gu_code="28237", gu_name="부평구", dong_name="부평1동", rent_area="부평",
)
