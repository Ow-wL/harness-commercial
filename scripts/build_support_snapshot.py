"""
지원사업 공고 스냅샷 (v0.3.1, D-039) — 배포 이미지에 넣는 시작용 공고 묶음.

  python scripts/build_support_snapshot.py [--secrets] [--out data/extra/support-snapshot.json]

- 서버(Cloud Run)는 시작 때 인스턴스 캐시가 없으면 이 파일부터 읽고, 하루 1회 직접 갱신을 시도한다. 공공 사이트가 Cloud Run 연결을
  시간 초과시킬 때(2026-11-01 관측)도 카드가 비지 않게 하려는 것이다.
- 키: 환경변수 BIZINFO_API_KEY·DATA_GO_KR_API_KEY, 또는 --secrets(Secret Manager 에서 이 프로세스 환경변수로만 — 출력·저장하지 않음).
- 두 자료원이 모두 성공해야 쓴다(일부만 받은 묶음을 이미지에 넣지 않는다). 형식은 서버 캐시와 같다(backend/app/support.py).
- 결과 파일은 git 에 넣지 않는다(매일 바뀌는 공고 묶음 — .gitignore). 배포 작업 폴더가 이미지 빌드 컨텍스트에 복사한다.
"""
from __future__ import annotations

import argparse
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main(argv: list[str]) -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--secrets", action="store_true")
    ap.add_argument("--out", default=str(ROOT / "data" / "extra" / "support-snapshot.json"))
    a = ap.parse_args(argv)
    if a.secrets:
        import run_local_backend as R          # 같은 scripts 폴더 — Secret 을 환경변수로만 읽는다
        R.load_secrets()
    from backend.app.support import CACHE_FILE, SupportService

    with tempfile.TemporaryDirectory() as tmp:
        svc = SupportService.from_env(state_dir=tmp, snapshot=None)
        if not svc.enabled:
            print("키가 없다 — 스냅샷을 만들지 않는다", file=sys.stderr)
            return 1
        state = svc.refresh()
        bad = [s for s, v in state["sources"].items() if not v["ok"]]
        if bad or len(state["sources"]) < 2:
            print(f"자료원 실패 {bad} — 스냅샷을 쓰지 않는다", file=sys.stderr)
            return 1
        out = Path(a.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(Path(tmp) / CACHE_FILE, out)
    print(f"{out}: 공고 {len(state['programs'])}건, 기준 {state['as_of']}, "
          + ", ".join(f"{s} {v['count']}" for s, v in state["sources"].items()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
