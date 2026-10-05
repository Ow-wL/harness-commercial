"""
scoring_engine — 웹 실행용 v0.3 스코어링 엔진 패키지.

구조
  v0_3/        팀 원본(sources/team_v0.3/04_엔진코드/engine)의 **바이트 단위 동일 사본**. 수정 금지.
               tests/test_engine_canonical.py 가 원본과의 해시 일치를 검사한다.
  runtime.py   런타임 데이터 1회 로드 (RuntimeData)
  reference.py 업종별/유인시설집합별 비교 모집단 캐시 (ReferenceCache)
  context.py   분석 지점 컨텍스트 (SiteContext) — run_all.py 하드코딩 값을 명시적 파라미터로 분리
  service.py   run_all.py 와 동일한 입력을 구성해 scoring.analyze() 를 호출하는 어댑터

v0.3 엔진 모듈은 `import config as C` 같은 평면(flat) import 를 쓴다.
엔진 파일을 고치지 않기 위해 v0_3 디렉터리를 sys.path 앞에 넣는다.
→ 백엔드/테스트는 config, scoring, access, radius_demand, etl_location, etl_rent, demo
   라는 이름의 최상위 모듈을 만들면 안 된다 (docs/DECISIONS.md D-004).
"""
from __future__ import annotations

import os
import sys

ENGINE_VERSION = "mvp-0.3"
ENGINE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "v0_3")
ENGINE_MODULES = ("config", "scoring", "access", "radius_demand", "etl_location", "etl_rent")

if ENGINE_DIR not in sys.path:
    sys.path.insert(0, ENGINE_DIR)

import config  # noqa: E402
import scoring  # noqa: E402
import access  # noqa: E402
import radius_demand  # noqa: E402
import etl_location  # noqa: E402
import etl_rent  # noqa: E402


def _assert_engine_modules_resolved() -> None:
    """평면 import 가 다른 동명 모듈로 가로채이지 않았는지 확인한다."""
    for name in ENGINE_MODULES:
        mod = sys.modules[name]
        path = os.path.abspath(getattr(mod, "__file__", "") or "")
        if os.path.dirname(path) != ENGINE_DIR:
            raise ImportError(f"engine module '{name}' resolved to {path}, expected {ENGINE_DIR}")


_assert_engine_modules_resolved()

# `import scoring_engine.config` 도 같은 모듈 객체를 가리키게 한다 (사본을 두 번 로드하지 않는다).
for _name in ENGINE_MODULES:
    sys.modules[f"{__name__}.{_name}"] = sys.modules[_name]

__all__ = ["ENGINE_VERSION", "ENGINE_DIR", "config", "scoring", "access",
           "radius_demand", "etl_location", "etl_rent"]
