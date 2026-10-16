"""
사용자 가중치 규칙 + breakdown 검증.   실행: python3 test_weights.py   (pytest도 가능)

규칙
  R1 입력이 없으면 기본(업종그룹) 가중치, 결과는 이전과 동일
  R2 어떤 경우에도 합계 1
  R3 관점당 MIN_WEIGHT 이상 (하한)
  R4 잘못된 입력은 조용히 보정하지 않고 오류
  R5 병목 경고는 가중치와 무관하게 유지
  R6 breakdown 기여도 합 == 관점 점수
"""
import math
import config as C
import scoring as S
import demo as D


def _run(**kw):
    return S.analyze(D.site, D.dongs[0], D.panel, D.stores, D.stations, D.facilities,
                     D.cohort_counts, **kw)


def approx(a, b, tol=0.06):
    return abs(a - b) <= tol


def test_R1_default_unchanged():
    r = _run()
    assert r["종합"]["가중치_출처"] == "기본(업종그룹)"
    assert r["종합"]["점수"] == 58.3          # 변경 전 합성데이터 결과
    assert "기본가중치_종합점수" not in r["종합"]


def test_R2_sum_to_one():
    for kw in [dict(user_weights={"market": 3, "customer": 1}),
               dict(importance={"stability": 5, "competition": 1}),
               dict(user_weights={k: 0 for k in C.PERSPECTIVES[:4]} | {"stability": 1})]:
        w, _ = S.resolve_weights("C_목적방문형", **kw)
        assert math.isclose(sum(w.values()), 1.0, abs_tol=1e-9), (kw, w)


def test_R3_floor():
    w, info = S.resolve_weights("C_목적방문형",
                                user_weights={"market": 0, "customer": 0, "competition": 0,
                                              "location": 0, "stability": 1})
    assert all(v >= C.MIN_WEIGHT - 1e-12 for v in w.values()), w
    assert set(info["하한_적용"]) == {"market", "customer", "competition", "location"}
    assert approx(w["stability"], 1 - 4 * C.MIN_WEIGHT, 1e-9)


def test_R4_invalid_inputs_raise():
    bad = [dict(user_weights={"foo": 1}),
           dict(user_weights={"market": -1}),
           dict(user_weights={"market": "많이"}),
           dict(user_weights={k: 0 for k in C.PERSPECTIVES}),
           dict(importance={"market": 9}),
           dict(importance={"bar": 3}),
           dict(user_weights={"market": 1}, importance={"market": 3})]
    # 모든 가중치 0: 생략된 관점이 없으니 합 0 → 오류
    for kw in bad:
        try:
            S.resolve_weights("C_목적방문형", **kw)
        except ValueError:
            continue
        raise AssertionError(f"오류가 나야 함: {kw}")


def test_importance_default_is_base():
    w, _ = S.resolve_weights("C_목적방문형", importance={k: 3 for k in C.PERSPECTIVES})
    for k, v in C.WEIGHTS["C_목적방문형"].items():
        assert approx(w[k], v, 1e-9)


def test_importance_direction():
    base = C.WEIGHTS["C_목적방문형"]
    w, info = S.resolve_weights("C_목적방문형", importance={"stability": 5, "competition": 1})
    assert w["stability"] > base["stability"] and w["competition"] < base["competition"]
    assert info["출처"] == "사용자(중요도 1~5)"


def test_R5_bottleneck_kept_when_weight_lowered():
    base = _run()
    assert base["종합"]["병목_지표"] == "stability"
    bott_key = base["종합"]["병목_지표"]
    r = _run(importance={bott_key: 1})          # 병목 관점 중요도를 최저로
    assert r["종합"]["병목_지표"] == bott_key
    assert any("단일 병목" in w for w in r["경고"])
    assert any("병목 경고는 가중치와 무관" in w for w in r["경고"])
    assert r["종합"]["점수"] > base["종합"]["점수"]       # 점수는 오르지만 경고는 남는다
    assert r["종합"]["기본가중치_종합점수"] == base["종합"]["점수"]


def test_R6_breakdown_sums_to_score():
    r = _run()
    for ind in r["지표"]:
        bd = ind["breakdown"]
        if ind["score"] is None or not bd:
            continue
        s = sum(b["기여도"] for b in bd if b["기여도"] is not None)
        assert abs(s - ind["score"]) <= 0.31, (ind["key"], s, ind["score"])   # 항목별 반올림 오차 허용
        used = sum(b["적용_가중치"] for b in bd)
        assert abs(used - 1.0) <= 0.003, (ind["key"], used)


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for f in fns:
        f()
        print("PASS", f.__name__)
    print(f"\n{len(fns)}개 통과")
