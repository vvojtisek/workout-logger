"""Guards for the small-host k3s protections tracked in issue #72.

The production node has 2 GiB RAM. Argo reconciliation plus a Recreate rollout pushed
it into memory exhaustion and Kubernetes API timeouts. The host-level protections live
in ``deploy/k3s`` (they cannot be expressed in the Helm chart) and the Argo sync
behaviour in ``deploy/argocd/application.yaml``.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
APPLICATION = ROOT / "deploy" / "argocd" / "application.yaml"
K3S_DIR = ROOT / "deploy" / "k3s"
SWAP_SCRIPT = K3S_DIR / "setup-swap.sh"
K3S_DROPIN = K3S_DIR / "config.yaml.d" / "10-small-host.yaml"


def _run_swap_script(tmp_path: Path, fstab_text: str = "") -> str:
    fstab = tmp_path / "fstab"
    fstab.write_text(fstab_text)
    result = subprocess.run(
        ["bash", str(SWAP_SCRIPT)],
        check=True,
        capture_output=True,
        text=True,
        env={
            "PATH": "/usr/bin:/bin",
            "DRY_RUN": "1",
            "SWAPFILE": str(tmp_path / "swapfile"),
            "FSTAB": str(fstab),
            "SYSCTL_DROPIN": str(tmp_path / "99-swap.conf"),
        },
    )
    return result.stdout


def test_argo_application_limits_api_load_and_retries_with_backoff() -> None:
    sync_policy = yaml.safe_load(APPLICATION.read_text())["spec"]["syncPolicy"]

    # Only touch resources that actually drifted, instead of re-applying every
    # object on every sync against a starved API server.
    assert "ApplyOutOfSyncOnly=true" in sync_policy["syncOptions"]
    # A sync that fails while the API is timing out must retry on its own with
    # growing delays rather than hot-looping or waiting for a manual k3s restart.
    retry = sync_policy["retry"]
    assert retry["limit"] >= 1
    assert retry["backoff"]["factor"] >= 2
    assert retry["backoff"]["maxDuration"]
    # Existing GitOps behaviour must be preserved.
    assert sync_policy["automated"] == {"prune": True, "selfHeal": True}
    assert "CreateNamespace=true" in sync_policy["syncOptions"]


def test_k3s_dropin_reserves_memory_for_the_control_plane() -> None:
    config = yaml.safe_load(K3S_DROPIN.read_text())

    # `+` appends to any kubelet-arg already present in the host's config.yaml
    # instead of replacing it.
    kubelet_args = config["kubelet-arg+"]
    assert any(arg.startswith("system-reserved=") and "memory=" in arg for arg in kubelet_args)
    assert any(arg.startswith("kube-reserved=") and "memory=" in arg for arg in kubelet_args)
    assert any(arg.startswith("eviction-hard=memory.available<") for arg in kubelet_args)
    # The drop-in must not take over cluster-wide settings owned by the host config.
    assert set(config) == {"kubelet-arg+"}


def test_swap_script_is_valid_bash() -> None:
    subprocess.run(["bash", "-n", str(SWAP_SCRIPT)], check=True)


def test_swap_script_creates_persistent_swap_and_low_swappiness(tmp_path: Path) -> None:
    plan = _run_swap_script(tmp_path)

    assert "mkswap" in plan
    assert "swapon" in plan
    # Persistence across reboots: the temporary swapfile from the incident was not.
    assert f"{tmp_path / 'swapfile'} none swap sw 0 0" in plan
    # Swap is an emergency buffer for k3s, not a place to push the page cache.
    assert "vm.swappiness=10" in plan
    # Nothing was actually created or modified in dry-run mode.
    assert not (tmp_path / "swapfile").exists()
    assert (tmp_path / "fstab").read_text() == ""


def test_swap_script_is_idempotent_for_an_existing_fstab_entry(tmp_path: Path) -> None:
    entry = f"{tmp_path / 'swapfile'} none swap sw 0 0\n"
    plan = _run_swap_script(tmp_path, fstab_text="UUID=abc / ext4 defaults 0 1\n" + entry)

    assert f"{tmp_path / 'swapfile'} none swap sw 0 0" not in plan
    assert "already present in" in plan
