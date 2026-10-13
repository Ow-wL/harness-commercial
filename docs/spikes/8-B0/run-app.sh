#!/usr/bin/env bash
# 8-B0 앱 실측: 실제 앱(dev)의 지도 사각형·범례·SDK 컨트롤 위치를 읽기만 한다(앱 코드 불변).
# 전제: backend(:8000)와 frontend dev(:5173) 실행 중. 흐름 = 좌표 직접 입력(부평역) → PC방 → 분석하기 → 3폭 측정,
#       375는 "지도 보기"를 눌러 지도 화면을 잰다. 결과: results/app-*.json
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
B="${B:-$HOME/.claude/skills/gstack/browse/dist/browse}"
D=docs/spikes/8-B0
ref() { "$B" snapshot -i | grep -F "$1" | grep -o '@e[0-9]*' | head -1; }

"$B" viewport 1280x800 >/dev/null
"$B" goto http://localhost:5173/ >/dev/null
sleep 6
"$B" eval "$D/scripts/measure-app.js" > "$D/results/app-1280x800-before-select.json"
"$B" click "$(ref '"좌표 직접 입력"')" >/dev/null
"$B" fill "$(ref '"위도"')" 37.4894 >/dev/null
"$B" fill "$(ref '"경도"')" 126.7246 >/dev/null
"$B" click "$(ref '"이 좌표로 선택"')" >/dev/null
for i in $(seq 1 20); do "$B" js "document.querySelector('select')?.options.length" | grep -qE '^[3-9][0-9]$' && break; sleep 1; done
"$B" select select R10406 >/dev/null
"$B" click "$(ref '"분석하기"')" >/dev/null
sleep 8
for vp in 1280x800 970x800; do
  "$B" viewport "$vp" >/dev/null; sleep 2
  "$B" eval "$D/scripts/measure-app.js" > "$D/results/app-$vp-result.json"
done
"$B" viewport 375x812 >/dev/null; sleep 2
"$B" click "$(ref '"지도 보기"')" >/dev/null; sleep 2
"$B" eval "$D/scripts/measure-app.js" > "$D/results/app-375x812-result-mapscreen.json"
for f in "$D"/results/app-*.json; do grep -q '^{' "$f" || { echo "FAIL $f"; exit 1; }; echo "ok $f"; done
