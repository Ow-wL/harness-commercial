#!/usr/bin/env python3
"""
입지성 데이터 → 역세권 강도 · 유인시설 근접도

입력
  역사_전국도시철도.xlsx   전국 1,099개역 (한국철도공사 334 포함) ← 경인선 부평역이 여기 있다
  학교_전국.csv            전국 12,011개 초·중·고 (CP949)
출력
  역_인천권.csv / 학교_인천.csv / 패널_입지성.csv

🔴 승하차 인원을 쓰지 않는 이유
  코레일 '역별 승하차' 공공데이터는 KTX·ITX 등 일반철도 전용이고
  수도권 광역전철(경인선 등)이 빠져 있다. 인천교통공사 데이터에는
  인천1·2호선과 7호선만 있다.
  → 부평역은 인천1호선 분(일평균 14,090명)만 집계되어 71개역 중 26위로 나온다.
    실제로는 경인선 환승 거점인데 부평시장역보다 낮게 평가된다.
  승하차를 그대로 쓰면 입지성이 심하게 왜곡되므로 점수 산출에서 제외하고,
  대신 '환승 가중 역세권 강도'를 쓴다. 승하차는 참고값으로만 남긴다.

역세권 강도 = Σ_역 (1 + 환승노선수) × exp(-거리 / STATION_DECAY_M)

⚠️ 유인시설 근접도는 종류별로 따로 낸다
  유인시설 개수가 종류마다 100배 가까이 차이난다 (오피스 12,162 vs 고등학교 129).
  Σ exp(-d/300) 을 한 번에 합치면 개수가 많은 종류가 합계를 지배해서,
  ANCHOR에 '오피스'가 들어간 업종이 전부 같은 점수로 붙어버린다.
  → 종류별 근접도를 각각 반환하고, 스코어링에서 종류별 백분위를 낸 뒤 평균한다.
    그래야 '고등학교 129개'와 '오피스 12,162개'가 동등한 무게를 갖는다.
  환승역은 노선 수만큼 이용객이 많다는 상식을 가중치로 표현한 것이다.
  승하차 실측을 대체하는 근사이며, 광역전철 승하차가 개방되면 교체할 것.
"""
import re, sys
import numpy as np
import pandas as pd

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import config as C

# 인천 + 인접 생활권 (부천·김포 일부 포함) 좌표 범위
BBOX = dict(lat=(37.10, 37.95), lng=(126.30, 126.90))
MERGE_M = 400          # 같은 이름 역이 이 거리 안이면 동일 역으로 본다


def haversine_m(lat0, lng0, lats, lngs):
    R = 6_371_000.0
    p1, p2 = np.radians(lat0), np.radians(np.asarray(lats, dtype=float))
    dl = np.radians(np.asarray(lngs, dtype=float) - lng0)
    a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * R * np.arcsin(np.sqrt(a))


def load_stations(xlsx: str) -> pd.DataFrame:
    df = pd.read_excel(xlsx)
    df = df.rename(columns={"역위도": "lat", "역경도": "lng", "역사명": "name"})
    df = df.dropna(subset=["lat", "lng"])
    df = df[(df.lat.between(*BBOX["lat"])) & (df.lng.between(*BBOX["lng"]))].copy()

    def n_transfer(row):
        if str(row.get("환승역구분", "")).strip() != "환승역":
            return 0
        s = str(row.get("환승노선명", "") or "")
        return max(1, len([x for x in re.split(r"[,+/·]", s) if x.strip()]))

    df["환승노선수"] = df.apply(n_transfer, axis=1)
    df["가중치"] = 1 + df["환승노선수"]

    # ── 환승역 병합 ────────────────────────────────────────────
    # 같은 물리적 역이 노선별로 따로 등록된다.
    #   '부평역'(경인선, 37.4895) 과 '부평'(인천1호선, 37.4905) 는 120m 떨어진 같은 역.
    # 좌표 격자만으로 묶으면 격자 경계를 사이에 두고 갈라진다.
    # → 역명을 정규화한 뒤(접미사 '역', 괄호 제거) 같은 이름이면서
    #   MERGE_M 이내인 레코드를 하나로 합치고 가중치를 더한다.
    df["_nm"] = (df.name.astype(str)
                 .str.replace(r"\([^)]*\)", "", regex=True)
                 .str.replace(r"역$", "", regex=True)
                 .str.replace(r"\s+", "", regex=True))
    merged, used = [], set()
    for i, a in df.iterrows():
        if i in used:
            continue
        same = df[(df._nm == a._nm) & (~df.index.isin(used))]
        d = haversine_m(a.lat, a.lng, same.lat, same.lng)
        grp = same[d <= MERGE_M]
        used.update(grp.index)
        merged.append({"name": a._nm, "lat": grp.lat.mean(), "lng": grp.lng.mean(),
                       "가중치": float(grp["가중치"].sum()), "노선수": len(grp)})
    g = pd.DataFrame(merged)
    print(f"[station] 인천권 {len(df)}개 레코드 → 물리적 역 {len(g)}개 "
          f"(환승 중복 {len(df)-len(g)}건 병합)")
    return g


def load_schools(csv: str) -> pd.DataFrame:
    df = pd.read_csv(csv, encoding="cp949", low_memory=False)
    addr = df["소재지도로명주소"].fillna("") + " " + df["소재지지번주소"].fillna("")
    df = df[addr.str.contains("인천", na=False)].copy()
    df = df.dropna(subset=["위도", "경도"]).rename(columns={"위도": "lat", "경도": "lng"})
    df["type"] = df["학교급구분"]
    print(f"[school] 인천 {len(df)}개 "
          f"({df['type'].value_counts().to_dict()})")
    return df[["학교명", "type", "lat", "lng"]]


# 학교 표준데이터에는 초·중·고만 있다. 나머지 유인시설은 상가정보에서 가져온다.
#   '대학교'는 어느 소스에도 없으므로 ANCHOR에 쓰지 않는다 (쓰면 조용히 0이 된다).
#   '오피스'는 전문·과학·기술 서비스업(M1) 밀집도를, '병원'은 보건의료업(Q1)을 프록시로 쓴다.
SHOP_ANCHOR_CODE = {"학원": "P10501", "독서실": "R10202"}
SHOP_ANCHOR_MAJOR = {"오피스": "M1", "병원": "Q1"}


def build_anchor_points(schools: pd.DataFrame, shops: pd.DataFrame) -> pd.DataFrame:
    """유인시설 후보 = 학교(표준데이터) + 학원 등(상가정보)."""
    a = schools[["type", "lat", "lng"]].copy()
    rows = [a]
    for label, code in SHOP_ANCHOR_CODE.items():
        sub = shops[shops["상권업종소분류코드"] == code]
        if len(sub):
            rows.append(pd.DataFrame({"type": label, "lat": sub["위도"].values,
                                      "lng": sub["경도"].values}))
    for label, major in SHOP_ANCHOR_MAJOR.items():
        sub = shops[shops["상권업종대분류코드"] == major]
        if len(sub):
            rows.append(pd.DataFrame({"type": label, "lat": sub["위도"].values,
                                      "lng": sub["경도"].values}))
    out = pd.concat(rows, ignore_index=True)
    print(f"[anchor] 유인시설 {len(out):,}개 ({out['type'].value_counts().to_dict()})")
    return out


def site_profile(lat, lng, stations, schools, biz_code):
    ds = haversine_m(lat, lng, stations.lat, stations.lng)
    near_i = int(np.argmin(ds))
    l2 = float((stations["가중치"].values * np.exp(-ds / C.STATION_DECAY_M)).sum())

    anchors = C.ANCHOR.get(biz_code, C.DEFAULT_ANCHOR)
    per_type, n_sch, l3 = {}, 0, 0.0
    for t in anchors:
        sub = schools[schools["type"] == t]
        if len(sub) == 0:
            per_type[t] = 0.0
            continue
        dsc = haversine_m(lat, lng, sub.lat, sub.lng)
        per_type[t] = float(np.exp(-dsc / C.FACILITY_DECAY_M).sum())
        n_sch += int((dsc <= 500).sum())
        l3 += per_type[t]
    return {"최근접역": stations.name.iloc[near_i],
            "최근접역_거리m": float(ds[near_i]),
            "역세권_강도": l2,
            "유인시설_기준": ", ".join(anchors),
            "유인시설_근접도": l3,            # 참고용 합계 (점수에는 종류별 백분위 평균을 쓴다)
            "유인시설_종류별": per_type,
            "반경500m_해당시설수": n_sch}


if __name__ == "__main__":
    st = load_stations("역사_전국도시철도.xlsx")
    sc = load_schools("학교_전국.csv")
    shops = pd.read_csv("인천_상가_정제.csv", encoding="utf-8-sig", low_memory=False)
    sc = build_anchor_points(sc, shops)
    st.to_csv("역_인천권.csv", index=False, encoding="utf-8-sig")
    sc.to_csv("유인시설_인천.csv", index=False, encoding="utf-8-sig")
    cent = shops.groupby(["시군구명", "행정동명"])[["위도", "경도"]].mean().reset_index()
    biz = sys.argv[1] if len(sys.argv) > 1 else "R10406"
    rows = []
    for _, c in cent.iterrows():
        p = site_profile(c["위도"], c["경도"], st, sc, biz)
        rows.append({"시군구명": c["시군구명"], "행정동명": c["행정동명"], **p})
    pd.DataFrame(rows).to_csv("패널_입지성.csv", index=False, encoding="utf-8-sig")
    print(f"[out] 패널_입지성.csv ({len(rows)}개 행정동, 업종 {biz})")
