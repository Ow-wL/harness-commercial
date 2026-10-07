# syntax=docker/dockerfile:1
# 하나의 이미지 = 하나의 Cloud Run 서비스 (docs/DECISIONS.md D-018).
#   Node/Vite 는 build 단계에서만 쓴다. runtime process 는 FastAPI/uvicorn 하나 — API + frontend dist 를 같은 origin 에서 서빙.
#
#   docker build --build-arg VITE_NAVER_MAP_CLIENT_ID=<Client ID> -t harness-commercial .
#   docker run --rm -p 8080:8080 harness-commercial
#
# NAVER Maps Client ID 는 브라우저 번들에 그대로 들어가는 공개 값이다(Client Secret 아님). build arg 로만 받고 commit 하지 않는다.

# ── 1) frontend build ───────────────────────────────────────
FROM node:22-slim AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# 행정동 경계는 data/geo 원본을 그대로 asset 으로 쓴다 (src/map/dongBoundary.ts 의 ../../../data/geo 경로)
COPY ["data/geo/인천_행정동경계_2026.geojson", "/build/data/geo/"]
ARG VITE_NAVER_MAP_CLIENT_ID
RUN test -n "$VITE_NAVER_MAP_CLIENT_ID" || { echo "build arg VITE_NAVER_MAP_CLIENT_ID 가 필요하다"; exit 1; }
# 번들만 만든다. 타입 검사(tsc -b)는 테스트 파일·tests/golden 까지 보므로 scripts/check(npm run check)에서 한다
RUN npx vite build
# build 에 행정동 GeoJSON asset 이 정확히 1개, data/geo 원본과 같은 바이트로 들어갔는지 확인한다
RUN set -e; \
    n=$(find dist/assets -name '*.geojson' | wc -l); test "$n" -eq 1 || { echo "geojson asset $n 개"; exit 1; }; \
    test "$(sha256sum < "$(find dist/assets -name '*.geojson')")" = "$(sha256sum < /build/data/geo/인천_행정동경계_2026.geojson)" \
      || { echo "geojson asset 이 data/geo 원본과 다르다"; exit 1; }

# ── 2) runtime ──────────────────────────────────────────────
FROM python:3.10-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY scoring_engine/ scoring_engine/
COPY backend/__init__.py backend/
COPY backend/app/ backend/app/
COPY data/runtime/ data/runtime/
COPY ["data/geo/인천_행정동경계_2026.geojson", "data/geo/"]
COPY --from=frontend /build/frontend/dist/ frontend/dist/

RUN useradd --system --uid 10001 app
USER app

ENV FRONTEND_DIST=/app/frontend/dist \
    PORT=8080
EXPOSE 8080
# Cloud Run 이 PORT 를 넣는다. worker 1개 — 워커마다 RuntimeData·ReferenceCache 를 따로 가지므로 (D-016)
CMD ["sh", "-c", "exec uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT} --workers 1"]
