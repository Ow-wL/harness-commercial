"""scripts/deploy_cloud_run.py (2026-10-31 비용 점검) — 배포 명령이 비용 설정을 늘 명시하고, 후보 리비전이 상시 인스턴스를 만들지 않는지."""
import importlib.util
import os

_spec = importlib.util.spec_from_file_location(
    "deploy_cloud_run", os.path.join(os.path.dirname(__file__), "..", "..", "scripts", "deploy_cloud_run.py"))
D = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(D)


def flag(cmd, name):
    return cmd[cmd.index(name) + 1]


def test_candidate_is_no_traffic_preview_and_never_keeps_idle_instances():
    cmd = D.candidate_cmd("abc1234", "abc1234-v051", ai=False)
    assert "--no-traffic" in cmd and flag(cmd, "--tag") == "preview"
    assert flag(cmd, "--min-instances") == "0"                       # 태그가 남아도 쉬는 동안 과금 없음
    for name in ("--max-instances", "--cpu", "--memory", "--concurrency", "--timeout"):
        assert name in cmd                                            # 서비스 템플릿 값을 물려받지 않게 모두 명시
    assert ("--cpu-throttling" in cmd) != ("--no-cpu-throttling" in cmd)
    assert "--update-secrets" not in cmd
    assert flag(cmd, "--update-env-vars") == "SCORING_ENGINE_VERSION=v0_5_1"


def test_candidate_with_ai_links_secret_by_name_only():
    cmd = D.candidate_cmd("abc1234", "abc1234-v051", ai=True)
    assert flag(cmd, "--update-secrets") == "ANTHROPIC_API_KEY=anthropic-api-key:latest"


def test_billing_profile_maps_to_cpu_throttling():
    req = D.candidate_cmd("t", "s", False, {**D.PROFILE, "billing": "request"})
    inst = D.candidate_cmd("t", "s", False, {**D.PROFILE, "billing": "instance"})
    assert "--cpu-throttling" in req and "--no-cpu-throttling" in inst


def test_switch_sets_traffic_then_service_level_min():
    t, m = D.switch_cmds("harness-commercial-abc1234-v051", {**D.PROFILE, "service_min": 0})
    assert flag(t, "--to-revisions") == "harness-commercial-abc1234-v051=100"
    assert m[:4] == ["gcloud", "run", "services", "update"] and flag(m, "--min") == "0"
    assert "--min-instances" not in m                                 # 리비전을 새로 만들지 않는 서비스 단위 설정


def test_dry_run_does_not_execute(capsys, monkeypatch):
    called = []
    monkeypatch.setattr(D.subprocess, "run", lambda *a, **k: called.append(a))
    assert D.main(["candidate", "abc1234"]) == 0
    assert not called and "dry run" in capsys.readouterr().out
