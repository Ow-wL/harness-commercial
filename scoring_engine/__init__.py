"""
scoring_engine — 웹 실행용 스코어링 엔진 패키지.

구조
  v0_3/        팀 원본(sources/team_v0.3/04_엔진코드/engine)의 **바이트 단위 동일 사본**. 수정 금지.
               tests/test_engine_canonical.py 가 원본과의 해시 일치를 검사한다.
  v0_4/        v0.3 사본 + 분석 반경 선택(300·500·1,000m) 최소 diff (D-024). 허용 diff 밖 변경 금지
               (tests/test_engine_v0_4_diff.py, tests/manifests/engine_v0_4.sha256.json).
  v0_5/        팀 전달 v0.5(sources/team_v0.5/04_엔진코드/engine) 사본 + 웹 v0.4 와 같은 반경 선택 최소 diff (D-028).
               면적 배분(etl_boundary)·고객성 반경 입력·집적도(agg_ref)·학교구역. 허용 diff 밖 변경 금지
               (tests/test_engine_v0_5_diff.py, tests/manifests/engine_v0_5.sha256.json).
               ※ 팀 번들의 "v0.4"(집적 효과)는 웹 v0.4(반경 선택)와 다른 변경이다 — 팀 v0.5 가 팀 v0.4 를 포함한다.
  v0_5_1/      v0_5 + 분동 배분 결함 수정(팀 엔진 유래 — 분동 인구비 이중 적용, D-029). etl_boundary 한 줄 + 엔진버전 mvp-0.5.1
               (tests/test_engine_v0_5_1_diff.py, tests/manifests/engine_v0_5_1.sha256.json). v0_5 는 팀 결과 보존용으로 그대로.
  boundary.py  v0.5 인구 면적 배분용 행정동 경계 로드(UTF-8) + 비교 모집단 중심점의 면적 가중치 재사용
  runtime.py   런타임 데이터 1회 로드 (RuntimeData)
  reference.py 업종별/유인시설집합별 비교 모집단 캐시 (ReferenceCache)
  context.py   분석 지점 컨텍스트 (SiteContext) — run_all.py 하드코딩 값을 명시적 파라미터로 분리
  service.py   run_all.py 와 동일한 입력을 구성해 scoring.analyze() 를 호출하는 어댑터

엔진 버전은 프로세스당 하나다: 환경변수 SCORING_ENGINE_VERSION = v0_3(기본) | v0_4 | v0_5 | v0_5_1.
엔진 모듈은 `import config as C` 같은 평면(flat) import 를 쓰므로 한 프로세스에 두 버전이 공존할 수 없다.
엔진 파일을 고치지 않기 위해 고른 버전 디렉터리를 sys.path 앞에 넣는다.
→ 백엔드/테스트는 config, scoring, access, radius_demand, etl_location, etl_rent, demo, etl_boundary, etl_sgis
   라는 이름의 최상위 모듈을 만들면 안 된다 (docs/DECISIONS.md D-004).
"""
from __future__ import annotations

import os
import sys

ENGINE_VERSIONS = {"v0_3": "mvp-0.3", "v0_4": "mvp-0.4", "v0_5": "mvp-0.5", "v0_5_1": "mvp-0.5.1"}
ENGINE_KEY = os.environ.get("SCORING_ENGINE_VERSION", "v0_3") or "v0_3"
if ENGINE_KEY not in ENGINE_VERSIONS:
    raise ImportError(f"SCORING_ENGINE_VERSION={ENGINE_KEY!r} — 가능: {', '.join(ENGINE_VERSIONS)}")
ENGINE_VERSION = ENGINE_VERSIONS[ENGINE_KEY]
ENGINE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), ENGINE_KEY)
# v0.5 입력 계약(D-028): 행정동 경계 면적 배분 반경 인구·잠재수요(거주+종사자)·고객성 반경 입력(customer_inputs)·
# 대체업종 실효 동종 수·집적도 비교 분포(agg_ref)·입지 reference 의 학교구역 키. v0.3·v0.4 는 그대로(golden).
AREA_WEIGHTED = ENGINE_KEY in ("v0_5", "v0_5_1")      # v0.5.1 = v0.5 + 분동 배분 수정(D-029)
ENGINE_MODULES = ("config", "scoring", "access", "radius_demand", "etl_location", "etl_rent") + \
    (("etl_sgis", "etl_boundary") if AREA_WEIGHTED else ())

if ENGINE_DIR not in sys.path:
    sys.path.insert(0, ENGINE_DIR)

import config  # noqa: E402
import scoring  # noqa: E402
import access  # noqa: E402
import radius_demand  # noqa: E402
import etl_location  # noqa: E402
import etl_rent  # noqa: E402
if AREA_WEIGHTED:
    import etl_sgis  # noqa: E402,F401
    import etl_boundary  # noqa: E402,F401  (matplotlib.path — v0.5 만 필요)


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

__all__ = ["ENGINE_VERSION", "ENGINE_KEY", "ENGINE_DIR", "RADIUS_OPTIONS_M", "AREA_WEIGHTED", "config", "scoring",
           "access", "radius_demand", "etl_location", "etl_rent"]
