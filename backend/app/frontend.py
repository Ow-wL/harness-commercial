"""
frontend production build(Vite `dist/`)를 같은 origin에서 서빙한다 (TASKS 5-4, docs/DECISIONS.md D-018).

  create_app(frontend_dist=".../frontend/dist")   # 또는 환경변수 FRONTEND_DIST (module-level app)

경로 규칙 — API route가 항상 먼저다. 이 모듈은 create_app 이 API route를 모두 등록한 **뒤에** 붙인다.
  /assets/*            dist/assets 의 해시된 파일 (JS·CSS·행정동 GeoJSON). 오래 캐시해도 된다(파일명에 해시)
  /health /businesses /analyze   API. 다른 method(예: GET /analyze)는 405 — index.html 로 떨어지지 않는다
  dist 루트의 실제 파일   그대로 (예: favicon)
  확장자 없는 그 밖의 GET  SPA fallback = index.html (no-cache)
  확장자 있는데 없는 파일·assets 안의 없는 파일·GET 이 아닌 method   404 (오류 계약 D-014: 404는 없는 route)
  hidden_paths (production 에서 끈 /docs·/redoc·/openapi.json)   404 — SPA fallback 으로 index.html 을 주지 않는다

frontend_dist 를 주지 않으면 아무것도 붙이지 않는다 — 개발(vite dev proxy)·테스트의 기존 동작 그대로.
"""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

INDEX = "index.html"
ASSET_CACHE = "public, max-age=31536000, immutable"
INDEX_CACHE = "no-cache"


class HashedAssets(StaticFiles):
    """Vite 가 파일명에 content hash 를 넣으므로 /assets 는 immutable 로 캐시한다."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers["Cache-Control"] = ASSET_CACHE
        return response


def mount_frontend(app: FastAPI, dist_dir: str | os.PathLike, api_paths: set[str],
                   hidden_paths: frozenset[str] | set[str] = frozenset()) -> None:
    dist = Path(dist_dir).resolve()
    index = dist / INDEX
    if not index.is_file() or not (dist / "assets").is_dir():
        raise RuntimeError(f"frontend build 가 없다: {dist} (frontend 에서 npm run build)")

    app.mount("/assets", HashedAssets(directory=dist / "assets"), name="assets")

    @app.api_route("/{full_path:path}", methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
                   include_in_schema=False)
    def spa(full_path: str, request: Request):
        path = "/" + full_path
        if path in api_paths:                      # API 경로에 다른 method → 405 (SPA 로 넘기지 않는다)
            raise HTTPException(status_code=405)
        if path in hidden_paths or request.method not in ("GET", "HEAD") or full_path.startswith("assets/"):
            raise HTTPException(status_code=404)
        candidate = (dist / full_path).resolve()
        if full_path and candidate.is_file() and candidate.is_relative_to(dist):
            return FileResponse(candidate)
        if "." in full_path.rsplit("/", 1)[-1]:    # 없는 파일 요청(확장자 있음)은 HTML 로 답하지 않는다
            raise HTTPException(status_code=404)
        return FileResponse(index, headers={"Cache-Control": INDEX_CACHE})
