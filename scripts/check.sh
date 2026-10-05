#!/usr/bin/env bash
# 전체 검증 (bash / Git Bash / macOS / Linux).  사용: scripts/check.sh [--fast]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -x "$ROOT/.venv/Scripts/python.exe" ]; then PY="$ROOT/.venv/Scripts/python.exe"
elif [ -x "$ROOT/.venv/bin/python" ]; then PY="$ROOT/.venv/bin/python"
else echo ".venv 없음. 먼저 scripts/setup.ps1 (Windows) 또는 scripts/setup.sh 실행" >&2; exit 2; fi
exec "$PY" "$ROOT/scripts/check.py" "$@"
