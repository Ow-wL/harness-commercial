"""
측정용 — 다른 git 리비전의 scoring_engine/reference.py(ReferenceCache)를 작업 트리 파일을 바꾸지 않고 불러온다.

  load_cache_class("working")   현재 작업 트리의 ReferenceCache
  load_cache_class("93b7031")   그 커밋의 reference.py 를 scoring_engine 패키지 안 모듈로 실행해 얻은 ReferenceCache

엔진·런타임 모듈은 같은 프로세스의 것을 공유한다(같은 엔진 버전, 같은 RuntimeData). 테스트·서비스 코드에서는 쓰지 않는다.
"""
from __future__ import annotations

import os
import subprocess
import sys
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_cache_class(rev: str):
    if rev in ("working", "", None):
        from scoring_engine.reference import ReferenceCache
        return ReferenceCache
    import scoring_engine  # noqa: F401 — 패키지와 엔진 평면 모듈을 먼저 올린다
    src = subprocess.check_output(["git", "show", f"{rev}:scoring_engine/reference.py"], cwd=ROOT).decode("utf-8")
    name = f"scoring_engine._reference_{rev}"
    mod = types.ModuleType(name)
    mod.__package__ = "scoring_engine"
    mod.__file__ = f"{rev}:scoring_engine/reference.py"
    sys.modules[name] = mod
    exec(compile(src, mod.__file__, "exec"), mod.__dict__)
    return mod.ReferenceCache
