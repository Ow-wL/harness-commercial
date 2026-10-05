#!/usr/bin/env python3
"""
SGIS 행정구역 통계 → 고객성 보강 (종사자수 · 1인가구)

입력: 국가데이터처_SGIS 행정구역 통계 및 경계 ZIP의 CSV들 + 행정동 경계 dbf
출력: 패널_통합.csv 에 종사자수/사업체수/1인가구/총가구수 컬럼 추가

⚠️ 조인의 어려움 3가지 — 전부 조용히 틀리는 종류다
  1. 코드 체계가 또 다르다.
       SGIS 인천 = '23' (통계청 옛 체계)  ≠ 행안부/소진공 '28'
       → 코드 조인 불가. 행정동명으로 붙인다.
  2. 기준시점이 개편 이전이다.
       SGIS 경계·통계 = 2025년 2분기 / 2024년 기준 → 인천 개편(2026-07) 미반영.
       다만 시군구만 바뀌고 행정동명은 대체로 유지되므로 동명 조인은 성립한다.
  3. 표기와 분동 차이.
       '도화2·3동'(SGIS) vs '도화2.3동'(상가)  → 구분자 정규화로 해결
       '아라동' → '아라1동'+'아라2동',  '운서동' → '운서1동'+'운서2동'
       → 1:N 분할. 규모 변수는 인구 비례 배분한다.

통계항목 코드 (코드집 확인):
  to_em_020 총종사자수 / to_fa_010 총사업체수 / ga_sd_005 1인가구 / to_ga_001 총가구수
"""
import re, struct, sys
import pandas as pd

ITEMS = {"to_em_020": "종사자수", "to_fa_010": "사업체수",
         "ga_sd_005": "1인가구", "to_ga_001": "총가구수"}

# SGIS에 없는 신설 행정동 → 모체 행정동 (규모 변수는 인구 비례 배분)
SPLIT_PARENT = {"아라1동": "아라동", "아라2동": "아라동",
                "운서1동": "운서동", "운서2동": "운서동"}


def read_dbf(path, enc="utf-8"):
    """.cpg가 UTF-8이라고 명시한다. cp949로 읽으면 전부 깨진다."""
    b = open(path, "rb").read()
    nrec = struct.unpack("<I", b[4:8])[0]
    hlen = struct.unpack("<H", b[8:10])[0]
    rlen = struct.unpack("<H", b[10:12])[0]
    flds, off = [], 32
    while b[off] != 0x0D:
        flds.append((b[off:off+11].split(b"\x00")[0].decode(enc, "replace"), b[off+16]))
        off += 32
    rows, pos = [], hlen
    for _ in range(nrec):
        rec = b[pos:pos+rlen]; pos += rlen
        if rec[:1] == b"*":
            continue
        v, p = {}, 1
        for nm, ln in flds:
            v[nm] = rec[p:p+ln].decode(enc, "replace").strip(); p += ln
        rows.append(v)
    return pd.DataFrame(rows)


def norm_dong(s: str) -> str:
    """'도화2·3동' == '도화2.3동'. 구분자와 공백을 통일한다."""
    return re.sub(r"[·ㆍ‧∙・.]", ".", str(s)).replace(" ", "")


def load_stats(sgis_dir, dbf_path, sido_code="23"):
    names = read_dbf(dbf_path)
    names = names[names["ADM_CD"].str.startswith(sido_code)][["ADM_CD", "ADM_NM"]]
    out = names.copy()

    files = {
        "to_em_020": "2025년기준_2024년_산업분류별(11차_대분류)_총괄종사자수.csv",
        "to_fa_010": "2025년기준_2024년_산업분류별(11차_대분류)_총괄사업체수.csv",
        "ga_sd_005": "2025년기준_2024년_세대구성별가구.csv",
        "to_ga_001": "2025년기준_2024년_가구총괄.csv",
    }
    for code, fn in files.items():
        df = pd.read_csv(f"{sgis_dir}/{fn}", encoding="cp949", dtype={"행정구역코드": str})
        df = df[df["통계항목"] == code][["행정구역코드", "통계값"]]
        df.columns = ["ADM_CD", ITEMS[code]]
        out = out.merge(df, on="ADM_CD", how="left")

    out["_key"] = out["ADM_NM"].map(norm_dong)
    print(f"[sgis] 시도 {sido_code} 행정동 {len(out)}개 / 항목 {list(ITEMS.values())}")
    return out


def attach(panel: pd.DataFrame, sgis: pd.DataFrame) -> pd.DataFrame:
    """패널(신 행정구역 기준)에 SGIS 통계를 동명으로 붙인다."""
    p = panel.copy()
    p["_key"] = p["행정동명"].map(norm_dong)
    p["_parent"] = p["행정동명"].map(SPLIT_PARENT).map(
        lambda x: norm_dong(x) if isinstance(x, str) else None)

    s = sgis.set_index("_key")[list(ITEMS.values())]
    direct = p["_key"].map(lambda k: k in s.index)

    for col in ITEMS.values():
        p[col] = p["_key"].map(s[col])

    # ── 분동 처리: 모체 값을 자식 동들의 인구 비율로 배분 ──────────
    split_rows = p["_parent"].notna()
    if split_rows.any():
        for parent, grp in p[split_rows].groupby("_parent"):
            if parent not in s.index:
                continue
            ratio = grp["총인구"] / grp["총인구"].sum()
            for col in ITEMS.values():
                p.loc[grp.index, col] = (s.loc[parent, col] * ratio).round()
            print(f"[split] {parent} → {list(grp['행정동명'])} "
                  f"인구비 {[round(r,3) for r in ratio]}")

    miss = p[list(ITEMS.values())].isna().all(axis=1).sum()
    rate = (1 - miss / len(p)) * 100
    print(f"[join] 매칭 {rate:.1f}%  (직접 {int(direct.sum())} + 분동 {int(split_rows.sum())}, 미매칭 {miss})")
    if miss:
        print("  ⚠ 미매칭:", p[p[list(ITEMS.values())].isna().all(axis=1)]["행정동명"].tolist())

    p["1인가구비중"] = (p["1인가구"] / p["총가구수"]).round(4)
    return p.drop(columns=["_key", "_parent"])


if __name__ == "__main__":
    sgis_dir = sys.argv[1] if len(sys.argv) > 1 else "sgis"
    panel_csv = sys.argv[2] if len(sys.argv) > 2 else "패널_통합.csv"
    sgis = load_stats(sgis_dir, f"{sgis_dir}/bnd_dong_00_2025_2Q.dbf")
    panel = pd.read_csv(panel_csv, encoding="utf-8-sig")
    merged = attach(panel, sgis)
    merged.to_csv(panel_csv, index=False, encoding="utf-8-sig")
    print(f"[out] {panel_csv}  ({len(merged)}행 × {len(merged.columns)}열)")
