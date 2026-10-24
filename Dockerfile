# syntax=docker/dockerfile:1
# 하나의 이미지 = 하나의 Cloud Run 서비스 (docs/DECISIONS.md D-018).
#   Node/Vite 는 build 단계에서만 쓴다. runtime process 는 FastAPI/uvicorn 하나 — API + frontend dist 를 같은 origin 에서 서빙.
#
#   docker build --build-arg VITE_NAVER_MAP_CLIENT_ID=<Client ID> -t harness-commercial .
#   선택 build arg: VITE_NAVER_MAP_STYLE_ID(다크 스타일), VITE_NAVER_MAP_LIGHT_STYLE_ID(라이트 스타일) — ARG 는 이 단계의 RUN(vite build) 환경변수로 전달된다
#   docker run --rm -p 8080:8080 harness-commercial
#
# NAVER Maps Client ID 는 브라우저 번들에 그대로 들어가는 공개 값이다(Client Secret 아님). build arg 로만 받고 commit 하지 않는다.

# ── 1) frontend build ───────────────────────────────────────
FROM node:22-slim AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# 행정동 경계·구 경계(묶음 A)는 data/geo 원본을 그대로 asset 으로 쓴다 (src/map/dongBoundary.ts·guBoundary.ts 의 ../../../data/geo 경로)
COPY ["data/geo/인천_행정동경계_2026.geojson", "data/geo/인천_시군구경계_2026.geojson", "/build/data/geo/"]
ARG VITE_NAVER_MAP_CLIENT_ID
RUN test -n "$VITE_NAVER_MAP_CLIENT_ID" || { echo "build arg VITE_NAVER_MAP_CLIENT_ID 가 필요하다"; exit 1; }
# 선택: NAVER 다크 지도 스타일 My Style ID(8-DK, DESIGN.md §19.3.1). 없으면 밝은 지도. commit 하지 않는다
ARG VITE_NAVER_MAP_STYLE_ID=
# 선택: 라이트 테마 지도 스타일 My Style ID(묶음 A, DESIGN.md §19.7). 없으면 라이트 테마는 NAVER 기본 밝은 지도. commit 하지 않는다
ARG VITE_NAVER_MAP_LIGHT_STYLE_ID=
# 번들만 만든다. 타입 검사(tsc -b)는 테스트 파일·tests/golden 까지 보므로 scripts/check(npm run check)에서 한다
RUN npx vite build
# build 에 GeoJSON asset 이 정확히 2개(행정동·구 경계)이고, 각각 data/geo 원본과 같은 바이트인지(해시 집합 일치) 확인한다
RUN set -e; \
    n=$(find dist/assets -name '*.geojson' | wc -l); test "$n" -eq 2 || { echo "geojson asset $n 개"; exit 1; }; \
    got=$(find dist/assets -name '*.geojson' -exec sha256sum {} \; | awk '{print $1}' | sort); \
    src=$(for f in /build/data/geo/*.geojson; do sha256sum < "$f"; done | awk '{print $1}' | sort); \
    test "$got" = "$src" || { echo "geojson asset 이 data/geo 원본과 다르다"; exit 1; }

# ── 2) runtime ──────────────────────────────────────────────
FROM python:3.10-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    MPLCONFIGDIR=/tmp/matplotlib
WORKDIR /app
COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY scoring_engine/ scoring_engine/
COPY backend/__init__.py backend/
COPY backend/app/ backend/app/
COPY data/runtime/ data/runtime/
COPY ["data/geo/인천_행정동경계_2026.geojson", "data/geo/"]
# 엔진 v0.5 인구 면적 배분용 SGIS 2025년 2분기 경계(D-028). 지도·행정동 판정용 2026 경계와 별개 — v0.3·v0.4 는 읽지 않는다
COPY ["data/geo/SGIS_행정동경계_2025_2Q_인천.geojson", "data/geo/"]
COPY --from=frontend /build/frontend/dist/ frontend/dist/

RUN useradd --system --uid 10001 app
USER app

ENV FRONTEND_DIST=/app/frontend/dist \
    PORT=8080
EXPOSE 8080
# 엔진 버전은 이미지에 고정하지 않는다: 실행 환경변수 SCORING_ENGINE_VERSION = v0_3(기본) | v0_4 | v0_5 (Cloud Run 리비전 설정)
# matplotlib(v0.5 면적 배분)은 matplotlib.path 만 쓴다. MPLCONFIGDIR 는 홈 없는 app 사용자의 설정 캐시 경고를 막는다
# Cloud Run 이 PORT 를 넣는다. worker 1개 — 워커마다 RuntimeData·ReferenceCache 를 따로 가지므로 (D-016)
CMD ["sh", "-c", "exec uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT} --workers 1"]
