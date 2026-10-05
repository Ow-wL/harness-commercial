"""
초보자 접근성 태그 검증.   실행: python3 test_access.py
  T1 엔진의 29개 업종이 모두 태그를 가진다 (빠지면 조용히 None이 되지 않도록)
  T2 등급 규칙: 허가·본인 면허 → 높음 / 등록·입지규제 → 중간 / 나머지 → 낮음
  T3 면허를 보유했다고 하면 면허 장벽만 해제된다 (약국은 등록업이라 중간)
  T4 태그는 점수를 바꾸지 않는다
  T5 학교 근접 검사: 300m 안 학교만 센다
  T6 표에 없는 업종은 None
"""
import config as C
import access as A
import scoring as S
import demo as D


def test_T1_all_codes_tagged():
    missing = [c for c in C.CODE_NAME if c not in A.ACCESS]
    assert not missing, missing
    assert len(A.ACCESS) == len(C.CODE_NAME) == 29


def test_T2_levels():
    lv = {c: A.access_tag(c)["제도_진입장벽"] for c in A.ACCESS}
    assert lv["I21101"] == "높음"                      # 유흥주점 허가
    assert lv["G21501"] == lv["S20701"] == lv["S20703"] == lv["S20702"] == "높음"   # 본인 면허
    assert lv["R10406"] == lv["R10407"] == lv["R10404"] == "중간"   # 등록 + 학교 주변 규제
    assert lv["P10501"] == lv["R10202"] == "중간"                    # 학원법 등록
    assert lv["I21201"] == lv["P10603"] == lv["G20405"] == lv["R10310"] == "낮음"
    for c, info in A.ACCESS.items():
        if info["인허가"] == "허가" or info["면허"]:
            assert lv[c] == "높음", c


def test_T3_license():
    assert A.access_tag("S20701", ["미용사(일반)"])["제도_진입장벽"] == "낮음"
    assert A.access_tag("S20701", ["미용사(네일)"])["제도_진입장벽"] == "높음"   # 다른 면허는 해제 안 됨
    assert A.access_tag("G21501", ["약사"])["제도_진입장벽"] == "중간"
    assert A.access_tag("I21201", ["미용사(일반)"])["면허_보유"] is None       # 면허 불필요 업종


def test_T4_score_unchanged():
    base = S.analyze(D.site, D.dongs[0], D.panel, D.stores, D.stations, D.facilities, D.cohort_counts)
    lic = S.analyze(D.site, D.dongs[0], D.panel, D.stores, D.stations, D.facilities, D.cohort_counts,
                    user_licenses=["약사", "미용사(일반)"])
    assert base["종합"]["점수"] == lic["종합"]["점수"] == 58.3
    assert base["meta"]["엔진버전"] == "mvp-0.3"


def test_T5_school_check():
    fac = [{"type": "중학교", "lat": 37.0, "lng": 127.0, "학교명": "가까운중"},
           {"type": "고등학교", "lat": 37.0 + 0.0045, "lng": 127.0, "학교명": "먼고"},   # 약 500m
           {"type": "학원", "lat": 37.0, "lng": 127.0}]
    r = A.school_check(37.0005, 127.0, fac)                                         # 약 55m
    assert r["학교수"] == 1 and r["목록"][0]["이름"] == "가까운중"
    assert A.school_check(None, None, fac) is None


def test_T6_unknown():
    assert A.access_tag("Z99999") is None


if __name__ == "__main__":
    for k, f in list(globals().items()):
        if k.startswith("test_"):
            f(); print("PASS", k)
