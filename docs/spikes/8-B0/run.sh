#!/usr/bin/env bash
# 8-B0 지도 맞춤 스파이크 재현 (docs/spikes/8-B0/README.md).
# 전제: frontend dev 서버가 http://localhost:5173 에서 실행 중(frontend/.env에 VITE_NAVER_MAP_CLIENT_ID),
#       gstack browse 바이너리($B)가 있다. 결과는 results/에 덮어쓴다.
# 주의: `$B eval`은 한글 // 주석이 든 스크립트에 빈 결과를 돌려준 적이 있다 → scripts/*.js에는 주석을 두지 않는다(README).
#       eval 경로는 cwd 아래여야 하므로 저장소 루트에서 실행한다.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
B="${B:-$HOME/.claude/skills/gstack/browse/dist/browse}"
D=docs/spikes/8-B0
URL=http://localhost:5173/spike/map-fit-spike.html

run() { # $1 viewport, $2 query, $3 script, $4 out
  "$B" viewport "$1" >/dev/null
  "$B" goto "$URL$2" >/dev/null
  "$B" eval "$D/scripts/$3" > "$D/results/$4"
  if ! grep -q '^{' "$D/results/$4"; then echo "FAIL $4: $(head -c 200 "$D/results/$4")"; exit 1; fi
  echo "ok $4"
}

for vp in 1280x800 970x800 375x812; do
  run "$vp" "" run-final.js "final-$vp-LARGE.json"
  run "$vp" "?zoomStyle=SMALL" run-final.js "final-$vp-SMALL.json"
  run "$vp" "" run-hypothesis.js "hypothesis-$vp.json"
done
run 1280x800 "" run-events.js "events-1280x800.json"
run 1280x800 "" run-hidden.js "hidden-1280x800.json"
run 375x812 "" run-hidden.js "hidden-375x812.json"
