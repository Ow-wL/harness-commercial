"""
분석 지점 컨텍스트.

v0.3 run_all.py 는 지점 정보를 모듈 상수로 하드코딩한다:
  LAT, LNG, GU = 37.4894, 126.7246, "28237"
  panel[(시군구명=="부평구") & (행정동명=="부평1동")]   STAB 시군구 == "부평구"   RENT_AREA = "부평"
여기서는 그 값을 SiteContext 하나로 모아 명시적 파라미터로 만든다.

⚠ 현재 검증된 컨텍스트는 BUPYEONG_STATION 하나뿐이다 (golden regression).
  임의 lat/lng → SiteContext 변환(Location Resolver / Analysis Context Builder)은 아직 없다.
  docs/ARCHITECTURE.md 와 docs/TASKS.md 참고.
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
