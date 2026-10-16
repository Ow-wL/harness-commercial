"""
scoring_engine — 웹 실행용 스코어링 엔진 패키지.

구조
  v0_3/        팀 원본(sources/team_v0.3/04_엔진코드/engine)의 **바이트 단위 동일 사본**. 수정 금지.
               tests/test_engine_canonical.py 가 원본과의 해시 일치를 검사한다.
  v0_4/        v0.3 사본 + 분석 반경 선택(300·500·1,000m) 최소 diff (D-024). 허용 diff 밖 변경 금지
               (tests/test_engine_v0_4_diff.py, tests/manifests/engine_v0_4.sha256.json).
  runtime.py   런타임 데이터 1회 로드 (RuntimeData)
  reference.py 업종별/유인시설집합별 비교 모집단 캐시 (ReferenceCache)
  context.py   분석 지점 컨텍스트 (SiteContext) — run_all.py 하드코딩 값을 명시적 파라미터로 분리
  service.py   run_all.py 와 동일한 입력을 구성해 scoring.analyze() 를 호출하는 어댑터

엔진 버전은 프로세스당 하나다: 환경변수 SCORING_ENGINE_VERSION = v0_3(기본) | v0_4.
엔진 모듈은 `import config as C` 같은 평면(flat) import 를 쓰므로 한 프로세스에 두 버전이 공존할 수 없다.
엔진 파일을 고치지 않기 위해 고른 버전 디렉터리를 sys.path 앞에 넣는다.
→ 백엔드/테스트는 config, scoring, access, radius_demand, etl_location, etl_rent, demo
   라는 이름의 최상위 모듈을 만들면 안 된다 (docs/DECISIONS.md D-004).
"""
from __future__ import annotations

import os
import sys

ENGINE_VERSIONS = {"v0_3": "mvp-0.3", "v0_4": "mvp-0.4"}
ENGINE_KEY = os.environ.get("SCORING_ENGINE_VERSION", "v0_3") or "v0_3"
if ENGINE_KEY not in ENGINE_VERSIONS:
    raise ImportError(f"SCORING_ENGINE_VERSION={ENGINE_KEY!r} — 가능: {', '.join(ENGINE_VERSIONS)}")
ENGINE_VERSION = ENGINE_VERSIONS[ENGINE_KEY]
ENGINE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), ENGINE_KEY)
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

# 이 엔진이 받는 분석 반경. v0.3 은 config.RADIUS_M(500) 하나뿐이다.
RADIUS_OPTIONS_M: tuple = tuple(getattr(config, "RADIUS_OPTIONS_M", (config.RADIUS_M,)))

# `import scoring_engine.config` 도 같은 모듈 객체를 가리키게 한다 (사본을 두 번 로드하지 않는다).
for _name in ENGINE_MODULES:
    sys.modules[f"{__name__}.{_name}"] = sys.modules[_name]

__all__ = ["ENGINE_VERSION", "ENGINE_KEY", "ENGINE_DIR", "RADIUS_OPTIONS_M", "config", "scoring", "access",
           "radius_demand", "etl_location", "etl_rent"]
