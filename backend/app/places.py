"""
장소 이름 검색 프록시 (TASKS 12-14, 계획 1-6, D-036).

NAVER 검색(지역) API 는 비밀키(Client ID·Secret)가 필요해 프런트가 직접 부를 수 없다 → backend 가 대신 부른다.
  GET /places?q=부평역  →  {"count": n, "places": [{"name", "category", "road_address", "jibun_address", "lat", "lng"}]}
- 키는 환경변수 NAVER_SEARCH_CLIENT_ID / NAVER_SEARCH_CLIENT_SECRET (운영은 Cloud Run Secret). 없으면 기능을 끈다
  (GET /health places.enabled=false, GET /places 503 places_unavailable) — 프런트는 광고가 있을 때만 "장소 이름" 입력 방법을 보인다.
- 결과는 **좌표 선택일 뿐**이다. 분석 행정동 판정은 /analyze 의 ContextBuilder 가 좌표로 한다(장소 이름·주소로 덮어쓰지 않는다).
- 검색 원문(q)·결과를 서버 로그에 남기지 않는다. 로그는 상태 코드·소요 시간뿐.
- 응답은 표시에 필요한 필드만 옮기고(제목의 <b> 태그·HTML 엔티티 제거), 좌표는 NAVER 의 mapx/mapy(WGS84 × 1e7 정수 문자열)를
  경도·위도로 바꾼다. 좌표가 없는 항목은 뺀다. 인천 밖 결과도 그대로 돌려준다(선택은 막지 않고, 분석이 location_outside 로 거른다).
"""
from __future__ import annotations

import html
import json
import logging
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Callable, Optional

logger = logging.getLogger("backend.places")

NAVER_LOCAL_SEARCH_URL = "https://openapi.naver.com/v1/search/local.json"
CLIENT_ID_ENV = "NAVER_SEARCH_CLIENT_ID"
CLIENT_SECRET_ENV = "NAVER_SEARCH_CLIENT_SECRET"
MAX_QUERY_CHARS = 60
DISPLAY = 5                      # NAVER 지역 검색은 한 번에 최대 5건
TIMEOUT_S = 5.0

_TAG = re.compile(r"<[^>]+>")


@dataclass(frozen=True)
class Place:
    name: str
    category: str
    road_address: Optional[str]
    jibun_address: Optional[str]
    lat: float
    lng: float


class PlacesUpstreamError(Exception):
    """NAVER 응답 없음·오류·형식 불일치. 메시지에 검색어를 넣지 않는다."""


# fetch(url, headers) -> (status, body_bytes). 테스트는 가짜를 주입한다
Fetch = Callable[[str, dict[str, str]], tuple[int, bytes]]


def urllib_fetch(url: str, headers: dict[str, str]) -> tuple[int, bytes]:
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as res:   # noqa: S310 — 고정 https 주소
            return res.status, res.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def clean_title(title: str) -> str:
    return html.unescape(_TAG.sub("", title)).strip()


def _coord(value: object) -> Optional[float]:
    """mapx/mapy: WGS84 × 1e7 의 정수 문자열. 숫자가 아니면 None."""
    try:
        n = int(str(value))
    except (TypeError, ValueError):
        return None
    return n / 1e7


def parse_places(body: bytes) -> list[Place]:
    """NAVER 지역 검색 응답 → Place 목록. 형식이 다르면 PlacesUpstreamError."""
    try:
        data = json.loads(body.decode("utf-8"))
        items = data["items"]
        if not isinstance(items, list):
            raise TypeError("items")
    except (ValueError, KeyError, TypeError, UnicodeDecodeError) as e:
        raise PlacesUpstreamError("response shape") from e
    out: list[Place] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        lng = _coord(it.get("mapx"))
        lat = _coord(it.get("mapy"))
        if lat is None or lng is None or not (-90 <= lat <= 90 and -180 <= lng <= 180):
            continue
        road = str(it.get("roadAddress") or "").strip() or None
        jibun = str(it.get("address") or "").strip() or None
        out.append(Place(name=clean_title(str(it.get("title") or "")), category=str(it.get("category") or ""),
                         road_address=road, jibun_address=jibun, lat=lat, lng=lng))
    return out


class PlacesClient:
    """NAVER 지역 검색 호출. enabled=False(키 없음)면 search 를 부르지 않는다(엔드포인트가 503)."""

    def __init__(self, client_id: Optional[str], client_secret: Optional[str], fetch: Fetch = urllib_fetch):
        self.client_id = client_id or None
        self.client_secret = client_secret or None
        self.fetch = fetch

    @classmethod
    def from_env(cls, environ: Optional[dict[str, str]] = None) -> "PlacesClient":
        env = os.environ if environ is None else environ
        return cls(env.get(CLIENT_ID_ENV), env.get(CLIENT_SECRET_ENV))

    @property
    def enabled(self) -> bool:
        return self.client_id is not None and self.client_secret is not None

    def search(self, query: str) -> list[Place]:
        assert self.enabled
        url = f"{NAVER_LOCAL_SEARCH_URL}?{urllib.parse.urlencode({'query': query, 'display': DISPLAY})}"
        headers = {"X-Naver-Client-Id": self.client_id or "", "X-Naver-Client-Secret": self.client_secret or ""}
        started = time.perf_counter()
        try:
            status, body = self.fetch(url, headers)
        except Exception as e:                      # noqa: BLE001 — 네트워크·타임아웃 종류를 가리지 않고 상류 오류로
            logger.warning("places upstream error %s (%.0fms)", type(e).__name__, (time.perf_counter() - started) * 1000)
            raise PlacesUpstreamError("request failed") from e
        elapsed = (time.perf_counter() - started) * 1000
        if status != 200:
            logger.warning("places upstream status %s (%.0fms)", status, elapsed)
            raise PlacesUpstreamError(f"status {status}")
        places = parse_places(body)
        logger.info("places ok %d results (%.0fms)", len(places), elapsed)   # 검색어는 적지 않는다
        return places
