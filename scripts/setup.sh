#!/usr/bin/env bash
# 개발 환경 준비 (bash). Python 3.10 이상 필요.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ -d "$ROOT/.venv" ] || python3 -m venv "$ROOT/.venv"
if [ -x "$ROOT/.venv/bin/python" ]; then PY="$ROOT/.venv/bin/python"; else PY="$ROOT/.venv/Scripts/python.exe"; fi
"$PY" -m pip install -r "$ROOT/requirements.txt"
echo "준비 완료. 검증: scripts/check.sh"
