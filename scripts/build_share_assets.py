"""공유·홈 화면용 이미지 만들기 (13-50 4단계).

    python scripts/build_share_assets.py [--og]

frontend/public/ 에 아래 파일을 다시 만든다(로고 모양은 favicon.svg 와 같다 — 파란 둥근 사각형 안의 위치 핀).
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
BLUE = (29, 91, 191)
WHITE = (255, 255, 255)
NAVY = (13, 22, 43)
SS = 4  # 가장자리를 부드럽게: 4배로 그려 줄인다


def logo(size: int, radius_ratio: float = 0.25) -> Image.Image:
    """favicon.svg(32x32 기준)와 같은 모양을 size 픽셀로."""
    n = size * SS
    k = n / 32
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, n - 1, n - 1], radius=n * radius_ratio, fill=BLUE)
    # 핀: 머리 원(중심 16,14.1 · 반지름 9.2) + 아래 꼭짓점(16,27)
    d.ellipse([(16 - 9.2) * k, (14.1 - 9.1) * k, (16 + 9.2) * k, (14.1 + 9.3) * k], fill=WHITE)
    d.polygon([(8.6 * k, 19.6 * k), (23.4 * k, 19.6 * k), (16 * k, 27 * k)], fill=WHITE)
    d.ellipse([(16 - 3.6) * k, (14.2 - 3.6) * k, (16 + 3.6) * k, (14.2 + 3.6) * k], fill=BLUE)
    return im.resize((size, size), Image.LANCZOS)


def icon(size: int, name: str, square: bool = False) -> None:
    """square: 홈 화면 아이콘은 OS 가 모서리를 깎으므로 꽉 찬 사각 바탕."""
    im = logo(size, 0.0 if square else 0.25)
    if square:
        bg = Image.new("RGB", (size, size), BLUE)
        bg.paste(im, (0, 0), im)
        im = bg
    im.save(OUT / name, optimize=True)
    print("wrote", name)


def og() -> None:
    fonts = Path("C:/Windows/Fonts")
    bold, regular = fonts / "malgunbd.ttf", fonts / "malgun.ttf"
    if not bold.is_file() or not regular.is_file():
        print("skip og.png — 맑은 고딕 글꼴이 없습니다", file=sys.stderr)
        return
    w, h = 1200, 630
    im = Image.new("RGB", (w, h), NAVY)
    d = ImageDraw.Draw(im)
    mark = logo(132)
    im.paste(mark, (96, 120), mark)
    d.text((96, 300), "우리동네 상권분석 매니저", font=ImageFont.truetype(str(bold), 76), fill=WHITE)
    d.text((96, 410), "인천 지도에서 자리와 업종을 고르면", font=ImageFont.truetype(str(regular), 38), fill=(200, 212, 234))
    d.text((96, 464), "공공데이터 다섯 관점으로 상권을 살펴봅니다", font=ImageFont.truetype(str(regular), 38), fill=(200, 212, 234))
    d.rectangle([96, 548, 96 + 72, 554], fill=(110, 160, 255))
    im.save(OUT / "og.png", optimize=True)
    print("wrote og.png")


if __name__ == "__main__":
    icon(180, "apple-touch-icon.png", square=True)
    icon(192, "icon-192.png")
    icon(512, "icon-512.png")
    if "--og" in sys.argv:
        og()
