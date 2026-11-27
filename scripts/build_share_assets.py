"""공유·홈 화면용 이미지 만들기 (13-50 4단계 · 로고 13-53).

    python scripts/build_share_assets.py [--og]

frontend/public/ 에 아래 파일을 다시 만든다(로고 모양은 favicon.svg 와 같다 — 짙은 파랑 둥근 사각형, 아래 물결 두 겹, 흰 위치 핀).
  apple-touch-icon.png (180)  icon-192.png  icon-512.png
--og 를 주면 og.png(1200x630, 링크 미리보기 — index.html 의 og:image, 13-51)도 다시 만든다. 글자를 Windows 기본 글꼴(맑은 고딕)로
그려서 글꼴이 있는 기기에서만 만들 수 있어 옵션이다.
로고·문구를 바꾸면 다시 실행하고 결과를 커밋한다. 점수·데이터와 무관하다.
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "frontend" / "public"
TILE = (11, 58, 143)      # #0b3a8f
WAVE_1 = (27, 111, 224)   # #1b6fe0
WAVE_2 = (73, 180, 245)   # #49b4f5
WHITE = (255, 255, 255)
INK = (7, 8, 10)          # og.png 바탕 = 다크 --color-bg (#07080A)
SS = 4  # 가장자리를 부드럽게: 4배로 그려 줄인다

Point = tuple[float, float]


def _cubic(p0: Point, p1: Point, p2: Point, p3: Point, steps: int = 24) -> list[Point]:
    out = []
    for i in range(1, steps + 1):
        t = i / steps
        u = 1 - t
        out.append((
            u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
            u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1],
        ))
    return out


def _path(start: Point, curves: list[tuple[Point, Point, Point]], tail: list[Point]) -> list[Point]:
    pts = [start]
    for c1, c2, end in curves:
        pts += _cubic(pts[-1], c1, c2, end)
    return pts + tail


# favicon.svg 의 path 를 절대 좌표 3차 곡선으로 옮긴 것(64x64 기준)
WAVE_1_PATH = _path((0, 42), [((8, 36), (16, 36), (24, 42)), ((32, 48), (40, 48), (48, 42)), ((56, 36), (60, 37), (64, 39))], [(64, 64), (0, 64)])
WAVE_2_PATH = _path((0, 52), [((8, 47), (16, 47), (24, 52)), ((32, 57), (40, 57), (48, 52)), ((56, 47), (60, 48), (64, 50))], [(64, 64), (0, 64)])
PIN_PATH = _path(
    (32, 9),
    [((22.6, 9), (15.4, 16.2), (15.4, 25.4)), ((15.4, 37.5), (32, 50), (32, 50)), ((32, 50), (48.6, 37.5), (48.6, 25.4)), ((48.6, 16.2), (41.4, 9), (32, 9))],
    [],
)


def logo(size: int, radius_ratio: float = 0.25) -> Image.Image:
    """favicon.svg(64x64 기준)와 같은 모양을 size 픽셀로."""
    n = size * SS
    k = n / 64

    def scaled(points: list[Point]) -> list[Point]:
        return [(x * k, y * k) for x, y in points]

    body = Image.new("RGBA", (n, n), TILE + (255,))
    d = ImageDraw.Draw(body)
    d.polygon(scaled(WAVE_1_PATH), fill=WAVE_1)
    d.polygon(scaled(WAVE_2_PATH), fill=WAVE_2)
    d.polygon(scaled(PIN_PATH), fill=WHITE)
    d.ellipse([(32 - 6.5) * k, (25.5 - 6.5) * k, (32 + 6.5) * k, (25.5 + 6.5) * k], fill=TILE)
    # 물결이 둥근 모서리 밖으로 나가지 않게 둥근 사각형으로 잘라 낸다
    mask = Image.new("L", (n, n), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, n - 1, n - 1], radius=n * radius_ratio, fill=255)
    body.putalpha(mask)
    return body.resize((size, size), Image.LANCZOS)


def icon(size: int, name: str, square: bool = False) -> None:
    """square: 홈 화면 아이콘은 OS 가 모서리를 깎으므로 꽉 찬 사각 바탕."""
    im = logo(size, 0.0 if square else 0.25)
    if square:
        im = im.convert("RGB")
    im.save(OUT / name, optimize=True)
    print("wrote", name)


def og() -> None:
    fonts = Path("C:/Windows/Fonts")
    bold, regular = fonts / "malgunbd.ttf", fonts / "malgun.ttf"
    if not bold.is_file() or not regular.is_file():
        print("skip og.png — 맑은 고딕 글꼴이 없습니다", file=sys.stderr)
        return
    w, h = 1200, 630
    im = Image.new("RGB", (w, h), INK)
    d = ImageDraw.Draw(im)
    mark = logo(132)
    im.paste(mark, (96, 120), mark)
    d.text((96, 300), "우리동네 상권분석 매니저", font=ImageFont.truetype(str(bold), 76), fill=WHITE)
    d.text((96, 410), "인천 지도에서 자리와 업종을 고르면", font=ImageFont.truetype(str(regular), 38), fill=(184, 189, 197))
    d.text((96, 464), "공공데이터 다섯 관점으로 상권을 살펴봅니다", font=ImageFont.truetype(str(regular), 38), fill=(184, 189, 197))
    d.rectangle([96, 548, 96 + 72, 554], fill=(63, 208, 255))
    im.save(OUT / "og.png", optimize=True)
    print("wrote og.png")


if __name__ == "__main__":
    icon(180, "apple-touch-icon.png", square=True)
    icon(192, "icon-192.png")
    icon(512, "icon-512.png")
    if "--og" in sys.argv:
        og()
