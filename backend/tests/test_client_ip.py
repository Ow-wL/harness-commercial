"""제한기 IP 키 — Cloud Run 연결 주소(X-Forwarded-For 끝), Firebase Hosting 프록시에서 온 요청만 Fastly-Client-IP (2026-11-01)."""
from starlette.requests import Request

from backend.app.main import client_ip


def req(headers: dict, peer: str = "169.254.1.1") -> Request:
    return Request({"type": "http", "method": "GET", "path": "/", "client": (peer, 1234),
                    "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()]})


def test_direct_uses_last_forwarded_entry():
    assert client_ip(req({"X-Forwarded-For": "1.2.3.4, 61.105.109.180"})) == "61.105.109.180"    # 앞 값은 꾸밀 수 있다
    assert client_ip(req({})) == "169.254.1.1"


def test_firebase_proxy_uses_fastly_client_ip():
    h = {"X-Forwarded-For": "61.105.109.180, 66.249.82.97", "Fastly-Client-IP": "61.105.109.180"}
    assert client_ip(req(h)) == "61.105.109.180"
    # 프록시 주소가 요청마다 바뀌어도 같은 사용자는 같은 키
    assert client_ip(req({**h, "X-Forwarded-For": "61.105.109.180, 66.249.82.235"})) == "61.105.109.180"


def test_spoofed_fastly_header_from_direct_access_is_ignored():
    h = {"X-Forwarded-For": "61.105.109.180", "Fastly-Client-IP": "9.9.9.9"}
    assert client_ip(req(h)) == "61.105.109.180"


def test_firebase_proxy_without_header_falls_back_to_proxy_address():
    assert client_ip(req({"X-Forwarded-For": "66.249.82.97"})) == "66.249.82.97"
    assert client_ip(req({"X-Forwarded-For": "not-an-ip", "Fastly-Client-IP": "9.9.9.9"})) == "not-an-ip"
