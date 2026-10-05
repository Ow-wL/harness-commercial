#!/usr/bin/env python3
"""
공공데이터 CSV 첫 진단 도구 — 다운로드한 파일에 제일 먼저 돌린다.

해결하는 함정:
  · 인코딩 위장 — HTTP 헤더는 UTF-8인데 본문은 CP949인 경우가 흔하다
  · 컬럼명 제각각 — '도로명주소' vs '도로명전체주소', 'X'/'경도'/'lon' 등
  · 좌표계 불명 — EPSG:5174 / 2097 / 4326 중 뭔지 값으로 역추정
  · 대용량 — 전국 파일이 자치단체코드 순 정렬이라 앞부분만 보면 인천이 없다

사용법:
  python prep.py <파일.csv>              # 구조 진단
  python prep.py <파일.csv> --incheon    # 인천만 뽑아 저장
"""
import sys, os, csv, io, re
from collections import Counter

ENCODINGS = ["utf-8-sig", "utf-8", "cp949", "euc-kr", "latin-1"]

# 컬럼명 후보 (공공데이터마다 표기가 다르다)
ALIASES = {
    "lat":  ["위도", "LAT", "lat", "Y", "y", "좌표정보y", "좌표정보(y)", "역위도", "GPS_LATI"],
    "lng":  ["경도", "LON", "lng", "X", "x", "좌표정보x", "좌표정보(x)", "역경도", "GRAMAP", "GPS_LONG"],
    "addr": ["도로명주소", "도로명전체주소", "소재지전체주소", "지번주소", "소재지도로명주소", "주소"],
    "sido": ["시도명", "시도", "광역시도", "시도코드"],
    "sgg":  ["시군구명", "시군구", "군구", "시군구코드"],
    "dong": ["행정동명", "행정동", "읍면동명", "법정동명", "동명"],
    "biz":  ["상권업종소분류명", "업종명", "상권업종중분류명", "업태구분명", "개방서비스명"],
    "open": ["인허가일자", "인허가일", "개업일자"],
    "close":["폐업일자", "폐업일"],
    "state":["영업상태명", "상세영업상태명", "영업상태구분코드"],
}


def sniff_encoding(path, probe=200_000):
    """
    앞부분을 읽어 한글이 깨지지 않는 첫 인코딩을 고른다.

    ⚠ probe 경계에서 멀티바이트 글자가 잘리면 strict 디코딩이 실패한다.
      그 한 글자 때문에 올바른 인코딩이 후보에서 탈락하고 latin-1이 선택되면
      한글이 통째로 깨진 채 "정상"으로 보고된다 (실제로 겪은 버그).
      → 꼬리를 잘라내고, errors='replace'로 디코딩해 치환문자 수로 판정한다.
    """
    with open(path, "rb") as f:
        raw = f.read(probe)
    # 마지막 줄바꿈까지만 사용해 글자 중간에서 끊기는 것을 방지
    cut = raw.rfind(b"\n")
    if cut > 0:
        raw = raw[:cut]
    results = []
    for enc in ENCODINGS:
        try:
            txt = raw.decode(enc, errors="replace")
        except LookupError:
            continue
        # 한글 음절 비율이 높고 치환문자(U+FFFD)가 없으면 정상
        hangul = len(re.findall(r"[가-힣]", txt))
        broken = txt.count("�")
        results.append((enc, hangul, broken))
    if not results:
        return "latin-1", results
    good = [r for r in results if r[2] == 0]
    pool = good or results
    pool.sort(key=lambda r: (-r[1], r[2]))
    return pool[0][0], results


def find_col(header, kind):
    """별칭 목록으로 컬럼을 찾는다. 정확히 일치 → 부분 일치 순."""
    for cand in ALIASES.get(kind, []):
        if cand in header:
            return cand
    for cand in ALIASES.get(kind, []):
        for h in header:
            if cand in h:
                return h
    return None


def guess_crs(xs, ys):
    """좌표 값의 범위로 좌표계를 역추정한다. ⚠ 반드시 알려진 지점으로 교차검증할 것."""
    if not xs or not ys:
        return "불명 (좌표 없음)"
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    if 124 <= mx <= 132 and 33 <= my <= 39:
        return "EPSG:4326 (WGS84) — 변환 불필요"
    if 120_000 <= mx <= 640_000 and 130_000 <= my <= 780_000:
        return ("EPSG:5174 또는 5179 또는 2097 추정 (TM 계열) — "
                "⚠ 세 좌표계는 값 범위가 겹친다. 알려진 지점으로 반드시 교차검증할 것")
    if 13_000_000 <= abs(mx) <= 15_000_000:
        return "EPSG:3857 (웹 메르카토르) 추정"
    return f"불명 (평균 x={mx:,.0f}, y={my:,.0f})"


def verify_crs(x, y, epsg):
    """
    좌표 1건을 WGS84로 변환해 인천 범위(124~127E, 37~38N)에 들어오는지 본다.
    pyproj 필요:  pip install pyproj
    """
    try:
        from pyproj import Transformer
    except ImportError:
        return "pyproj 미설치 — pip install pyproj"
    try:
        t = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True)
        lon, lat = t.transform(x, y)
        ok = 124 < lon < 127.5 and 36.8 < lat < 38.2
        return f"EPSG:{epsg} → ({lat:.5f}, {lon:.5f}) {'✅ 인천 범위' if ok else '❌ 범위 벗어남'}"
    except Exception as e:
        return f"EPSG:{epsg} 변환 실패: {e}"


def inspect(path):
    enc, tried = sniff_encoding(path)
    size = os.path.getsize(path)

    print("=" * 72)
    print(f"파일: {os.path.basename(path)}   ({size/1024/1024:.1f} MB)")
    print("=" * 72)

    print("\n[인코딩 판정]")
    for e, hangul, broken in tried:
        mark = "←선택" if e == enc else ""
        print(f"  {e:12s} 한글 {hangul:6,}자  깨짐 {broken:5,}  {mark}")
    if enc in ("cp949", "euc-kr"):
        print("  ⚠ CP949 계열이다. pandas에서 encoding='cp949' 명시 필요.")

    with open(path, encoding=enc, errors="replace", newline="") as f:
        rdr = csv.reader(f)
        header = next(rdr, [])
        rows, xs, ys = [], [], []
        sido_counter = Counter()
        ci = {k: find_col(header, k) for k in ALIASES}
        idx = {k: (header.index(v) if v in header else None) for k, v in ci.items() if v}

        for i, row in enumerate(rdr):
            if i < 3:
                rows.append(row)
            if idx.get("sido") is not None and idx["sido"] < len(row):
                sido_counter[row[idx["sido"]][:6]] += 1
            if idx.get("lng") is not None and idx.get("lat") is not None:
                try:
                    xs.append(float(row[idx["lng"]])); ys.append(float(row[idx["lat"]]))
                except (ValueError, IndexError):
                    pass
            if i > 300_000:
                print(f"\n  ⚠ 30만 행까지만 스캔했다. 전국 파일은 자치단체코드 순 정렬이라")
                print(f"     뒤쪽에 인천이 있을 수 있다. 전량 처리는 --incheon 사용.")
                break
        n = i + 1 if 'i' in dir() else 0

    print(f"\n[구조]  {len(header)}개 컬럼 / 약 {n:,}행 스캔")
    for j, h in enumerate(header):
        sample = rows[0][j] if rows and j < len(rows[0]) else ""
        print(f"  {j:3d}. {h[:28]:30s} 예: {str(sample)[:30]}")

    print("\n[핵심 컬럼 자동 탐지]")
    for k, v in ci.items():
        print(f"  {k:6s} → {v or '❌ 못 찾음'}")

    if xs:
        print(f"\n[좌표계 추정]  {guess_crs(xs, ys)}")
        print(f"  표본: x={xs[0]:,.2f}  y={ys[0]:,.2f}")
        if not (124 <= xs[0] <= 132):
            print("  교차검증 (첫 좌표를 각 좌표계로 변환):")
            for epsg in (5174, 5179, 2097):
                print("   ", verify_crs(xs[0], ys[0], epsg))

    if sido_counter:
        print("\n[시도 분포 상위]")
        for s, c in sido_counter.most_common(8):
            mark = " ←인천" if "인천" in s else ""
            print(f"  {s:12s} {c:8,}{mark}")
        if not any("인천" in s for s in sido_counter):
            print("  ⚠ 스캔 구간에 인천이 없다. 정렬 순서 때문일 수 있으니 전량 확인할 것.")


def extract_incheon(path, out=None):
    """전량을 스트리밍으로 훑어 인천만 뽑는다. 대용량 파일 대응."""
    enc, _ = sniff_encoding(path)
    out = out or path.replace(".csv", "_인천.csv")
    with open(path, encoding=enc, errors="replace", newline="") as fi, \
         open(out, "w", encoding="utf-8-sig", newline="") as fo:
        rdr, wtr = csv.reader(fi), csv.writer(fo)
        header = next(rdr)
        wtr.writerow(header)
        # 시도 컬럼이 없으면 주소 문자열로 판정
        si = header.index(find_col(header, "sido")) if find_col(header, "sido") else None
        ai = header.index(find_col(header, "addr")) if find_col(header, "addr") else None
        kept = total = 0
        for row in rdr:
            total += 1
            hit = False
            if si is not None and si < len(row):
                hit = "인천" in row[si]
            elif ai is not None and ai < len(row):
                hit = "인천" in row[ai]
            if hit:
                wtr.writerow(row); kept += 1
    print(f"전체 {total:,}행 → 인천 {kept:,}행 ({kept/max(total,1)*100:.1f}%)")
    print(f"저장: {out}  (UTF-8 BOM, 엑셀에서 바로 열림)")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    path = sys.argv[1]
    if not os.path.exists(path):
        print(f"파일 없음: {path}"); sys.exit(1)
    if "--incheon" in sys.argv:
        extract_incheon(path)
    else:
        inspect(path)
