"""
통계청 SGIS 공식 OpenAPI 최소 클라이언트 (조사·경계 확보 스크립트 공용, runtime 에서 쓰지 않는다).

- 인증: 프로젝트 루트 .env 의 SGIS_CONSUMER_KEY / SGIS_CONSUMER_SECRET (표준 라이브러리로 읽음).
  인증값·access token·raw 응답은 출력·저장하지 않는다. 오류 메시지에도 URL·token 을 넣지 않는다.
- SGIS 공식 OpenAPI (sgisapi.mods.go.kr, 개발자센터 OpenAPI 정의서 기준):
    인증       /OpenAPI3/auth/authentication.json  (consumer_key, consumer_secret → accessToken, accessTimeout)
    좌표변환   /OpenAPI3/transformation/transcoord.json  (src, dst EPSG, posX=경도/x, posY=위도/y)
    역지오코딩 /OpenAPI3/addr/rgeocode.json  (UTM-K x_coor, y_coor, addr_type=20 "행정동(읍면동)")
    행정경계   /OpenAPI3/boundary/hadmarea.geojson  (year, adm_cd, low_search → UTM-K(EPSG:5179) geometry)
  성공은 errCd == 0 일 때만. 그 밖은 SgisError.
- 호출: 순차, 요청 간 짧은 간격. 네트워크 오류·429·5xx 는 최대 3회 backoff 재시도. token 은 accessTimeout 전에
  갱신하고, 인증 오류로 보이는 응답이면 한 번만 다시 발급받아 재시도한다.
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://sgisapi.mods.go.kr/OpenAPI3"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REQUEST_INTERVAL_S = 0.15
MAX_RETRIES = 3


class SgisError(Exception):
    """SGIS 호출 실패. 메시지에 인증값·URL·token 을 넣지 않는다."""


def read_env(path: str = os.path.join(ROOT, ".env")) -> dict:
    out = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def from_env() -> "Sgis":
    """루트 .env 로 클라이언트를 만든다. 키가 없으면 SgisError (값은 메시지에 넣지 않는다)."""
    env = read_env()
    key, secret = env.get("SGIS_CONSUMER_KEY"), env.get("SGIS_CONSUMER_SECRET")
    if not key or not secret:
        raise SgisError(".env 에 SGIS_CONSUMER_KEY / SGIS_CONSUMER_SECRET 가 없다")
    return Sgis(key, secret)


class Sgis:
    def __init__(self, key: str, secret: str):
        self._key, self._secret = key, secret
        self._token: str | None = None
        self._expires = 0.0
        self.calls = 0

    def __repr__(self) -> str:                      # 인증값이 repr 로 새지 않게
        return f"Sgis(calls={self.calls})"

    def _get(self, path: str, params: dict) -> dict:
        url = f"{API}{path}?{urllib.parse.urlencode(params)}"
        for attempt in range(MAX_RETRIES + 1):
            time.sleep(REQUEST_INTERVAL_S)
            self.calls += 1
            try:
                with urllib.request.urlopen(url, timeout=30) as res:
                    return json.loads(res.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                retryable = e.code == 429 or e.code >= 500
                err = f"HTTP {e.code}"
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                retryable, err = True, type(e).__name__
            except json.JSONDecodeError:
                retryable, err = False, "JSON 아님"
            if not retryable or attempt == MAX_RETRIES:
                raise SgisError(f"{path} {err}")
            time.sleep(0.5 * 2 ** attempt)
        raise SgisError(path)

    def _authenticate(self) -> None:
        body = self._get("/auth/authentication.json", {"consumer_key": self._key, "consumer_secret": self._secret})
        if body.get("errCd") != 0 or not (body.get("result") or {}).get("accessToken"):
            raise SgisError(f"인증 실패 errCd={body.get('errCd')} errMsg={body.get('errMsg')}")
        self._token = body["result"]["accessToken"]
        timeout = float(body["result"].get("accessTimeout") or 0)
        self._expires = timeout / 1000 if timeout > 1e11 else timeout      # ms 또는 s

    def call(self, path: str, params: dict) -> dict:
        """errCd == 0 인 응답만 돌려준다. 인증 오류로 보이면 token 을 한 번 다시 받아 재시도한다."""
        if not self._token or time.time() > self._expires - 60:
            self._authenticate()
        for refreshed in (False, True):
            body = self._get(path, {**params, "accessToken": self._token})
            if body.get("errCd") == 0:
                return body
            msg = str(body.get("errMsg", ""))
            auth_like = body.get("errCd") in (-401, -402) or "인증" in msg or "token" in msg.lower()
            if refreshed or not auth_like:
                raise SgisError(f"{path} errCd={body.get('errCd')} errMsg={msg[:60]}")
            self._authenticate()
        raise SgisError(path)

    def to_utmk(self, lat: float, lng: float) -> tuple[float, float]:
        r = self.call("/transformation/transcoord.json", {"src": 4326, "dst": 5179, "posX": lng, "posY": lat})["result"]
        return float(r["posX"]), float(r["posY"])

    def to_wgs84(self, x: float, y: float) -> tuple[float, float]:
        r = self.call("/transformation/transcoord.json", {"src": 5179, "dst": 4326, "posX": x, "posY": y})["result"]
        return float(r["posY"]), float(r["posX"])

    def admin_dong(self, lat: float, lng: float) -> dict:
        """현재 행정동 (addr_type=20 '행정동(읍면동)'). 파생 값만 돌려준다."""
        x, y = self.to_utmk(lat, lng)
        res = self.call("/addr/rgeocode.json", {"x_coor": x, "y_coor": y, "addr_type": 20}).get("result")
        if not isinstance(res, list) or not res:
            raise SgisError("rgeocode result 비어 있음")
        names = {(r.get("sgg_nm"), r.get("emdong_cd"), r.get("emdong_nm")) for r in res}
        if len(names) != 1:
            raise SgisError(f"rgeocode 결과가 서로 다른 행정동 {len(names)}개")
        sgg, code, name = names.pop()
        if not name or not code:
            raise SgisError("emdong_cd/emdong_nm 없음")
        return {"sgg_nm": sgg, "emdong_cd": str(code), "emdong_nm": name}

    def boundary(self, year: int, adm_cd: str, low_search: int) -> list[dict]:
        """행정구역 경계 (UTM-K). feature 의 properties·geometry 만 돌려준다 (응답 메타·token 없음)."""
        body = self.call("/boundary/hadmarea.geojson", {"year": year, "adm_cd": adm_cd, "low_search": low_search})
        feats = body.get("features")
        if not isinstance(feats, list) or not feats:
            raise SgisError("hadmarea features 비어 있음")
        return [{"properties": dict(f["properties"]), "geometry": f["geometry"]} for f in feats]
