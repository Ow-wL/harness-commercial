#!/usr/bin/env python3
"""
행안부 행정동 성별·연령별 주민등록인구 → 인천 고객성 패널

입력: 행정안전부_지역별(행정동) 성별 연령별 주민등록 인구수_YYYYMMDD.csv
      (CP949, 230컬럼: 메타 5 + 계/남자/여자 + 0~109세남녀 + 110세이상남녀)
출력: 패널_고객성.csv  — 행정동 × 업종별 타겟연령 인구

검증된 사실 (2026-08-31 기준):
  · 인코딩 CP949 (상가정보와 달리 UTF-8 아님)
  · 행정구역 개편 반영됨 — 서해구/제물포구/영종구/검단구
  · ⚠ 조인 키: 행정기관코드는 10자리, 상가정보 행정동코드는 8자리 → 체계가 다르다.
    (시군구명, 동명) 문자열 조인을 쓴다. 인천 158/158 = 100% 매칭 확인.
    ※ 이름 조인은 통폐합·개명 시 조용히 깨지므로 매칭률을 매번 검증할 것.
"""
import re, sys
import pandas as pd

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import config as C

META = ["행정기관코드", "기준연월", "시도명", "시군구명", "읍면동명", "계", "남자", "여자"]


def load(path: str, sido: str = "인천광역시") -> pd.DataFrame:
    df = pd.read_csv(path, encoding="cp949", low_memory=False)
    df = df[df["시도명"] == sido].copy()
    df.columns = [c.replace(" ", "") for c in df.columns]   # '110세이상 남자' 공백 제거
    print(f"[load] {sido} 행정동 {len(df)}개 / 기준 {df['기준연월'].iloc[0]}")
    return df


def age_columns(df):
    """{(성별, 나이): 컬럼명}. 110세이상은 110으로 취급한다."""
    out = {}
    for c in df.columns:
        m = re.match(r"^(\d+)세(이상)?(남자|여자)$", c)
        if m:
            out[("M" if m.group(3) == "남자" else "F", int(m.group(1)))] = c
    return out


def target_pop(df, profile, agecol):
    """AGE_PROFILE 정의대로 가중 합산. (성별, 하한, 상한, 가중치) 리스트."""
    total = pd.Series(0.0, index=df.index)
    for sex, lo, hi, w in profile:
        cols = [agecol[(sex, a)] for a in range(lo, hi + 1) if (sex, a) in agecol]
        if cols:
            total += df[cols].sum(axis=1) * w
    return total


def build_panel(df: pd.DataFrame) -> pd.DataFrame:
    agecol = age_columns(df)
    panel = df[["시군구명", "읍면동명", "계", "남자", "여자"]].copy()
    panel = panel.rename(columns={"읍면동명": "행정동명", "계": "총인구"})

    # 업종별 타겟연령 인구 (규모)와 비중 (농도)
    # ⚠ AGE_PROFILE에 전용 프로파일이 없는 업종도 DEFAULT로 컬럼을 만들어야 한다.
    #   안 만들면 스코어링에서 KeyError로 죽는다 (빵/도넛 등).
    from etl_shops import PANEL_CODES
    codes = {**{c: C.AGE_PROFILE.get(c, C.DEFAULT_AGE_PROFILE) for c in PANEL_CODES},
             **C.AGE_PROFILE}
    for code, profile in codes.items():
        name = C.CODE_NAME.get(code, code)
        t = target_pop(df, profile, agecol)
        panel[f"타겟_{name}"] = t.round().astype(int)
        panel[f"타겟비중_{name}"] = (t / df["계"].replace(0, pd.NA)).round(4)

    # 범용 연령대 (다른 업종 폴백용)
    for lo, hi, label in [(0,14,"유소년"), (15,24,"청년초"), (25,34,"청년후"),
                          (35,49,"중년"), (50,64,"장년"), (65,110,"노년")]:
        cols = [agecol[(s, a)] for s in ("M","F") for a in range(lo, hi+1) if (s,a) in agecol]
        panel[f"연령_{label}"] = df[cols].sum(axis=1)
    return panel


def join_with_shops(pop_panel, shop_panel):
    """
    (시군구명, 행정동명) 기준 조인. 매칭률을 반드시 확인한다.
    코드 조인이 불가능한 이유는 모듈 docstring 참조.
    """
    merged = shop_panel.merge(pop_panel, on=["시군구명", "행정동명"], how="left")
    miss = merged["총인구"].isna().sum()
    rate = (1 - miss / len(merged)) * 100
    print(f"[join] 상가 {len(shop_panel)}개 행정동 ↔ 인구 → 매칭 {rate:.1f}% (미매칭 {miss}개)")
    if miss:
        print("  ⚠ 미매칭:", merged[merged["총인구"].isna()][["시군구명","행정동명"]].to_dict("records"))
    return merged


if __name__ == "__main__":
    pop_csv = sys.argv[1]
    shop_panel_csv = sys.argv[2] if len(sys.argv) > 2 else "패널_경쟁성.csv"

    df = load(pop_csv)
    pop_panel = build_panel(df)
    pop_panel.to_csv("패널_고객성.csv", index=False, encoding="utf-8-sig")
    print(f"[out] 패널_고객성.csv  ({len(pop_panel)}행 × {len(pop_panel.columns)}열)")

    try:
        shop_panel = pd.read_csv(shop_panel_csv, encoding="utf-8-sig")
    except FileNotFoundError:
        print(f"[skip] {shop_panel_csv} 없음 — 조인 생략")
        sys.exit(0)

    merged = join_with_shops(pop_panel, shop_panel)
    merged.to_csv("패널_통합.csv", index=False, encoding="utf-8-sig")
    print(f"[out] 패널_통합.csv  ({len(merged)}행 × {len(merged.columns)}열)")
