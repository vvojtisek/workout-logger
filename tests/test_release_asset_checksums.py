from __future__ import annotations

import re
import subprocess
from pathlib import Path

DEPLOY_SCRIPT = Path(__file__).parents[1] / "scripts" / "deploy-aws-release.sh"


def test_release_checksum_verification_only_requires_downloaded_architecture(
    tmp_path: Path,
) -> None:
    script = DEPLOY_SCRIPT.read_text()
    function = re.search(r"(?ms)^verify_release_checksums\(\) \{\n.*?^\}", script)
    assert function, "deployment script must define checksum verification helper"

    assets = [
        "workout-logger-v1.2.3-linux-amd64-image.tar.gz",
        "workout-logger-v1.2.3-compose.yaml",
        "workout-logger-v1.2.3-linux-arm64-image.tar.gz",
    ]
    for asset in assets:
        (tmp_path / asset).write_text(asset)
    checksum_file = tmp_path / "SHA256SUMS"
    sums = subprocess.run(
        ["sha256sum", *(f"./{asset}" for asset in assets)],
        cwd=tmp_path,
        check=True,
        capture_output=True,
        text=True,
    )
    checksum_file.write_text(sums.stdout)
    (tmp_path / assets[2]).unlink()

    result = subprocess.run(
        [
            "bash",
            "-e",
            "-c",
            function.group() + '\nverify_release_checksums "$1" "$2" "$3"',
            "checksum-test",
            str(checksum_file),
            *assets[:2],
        ],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr

    (tmp_path / assets[1]).write_text("modified compose")
    failed_result = subprocess.run(
        [
            "bash",
            "-e",
            "-c",
            function.group() + '\nverify_release_checksums "$1" "$2" "$3"',
            "checksum-test",
            str(checksum_file),
            *assets[:2],
        ],
        check=False,
        capture_output=True,
        text=True,
    )

    assert failed_result.returncode != 0


def test_pre_upgrade_backup_compose_loads_production_environment() -> None:
    script = DEPLOY_SCRIPT.read_text()
    backup_block = re.search(r"(?ms)if \[\[ -f .*?scripts/backup_database\.py.*?^\s+fi", script)
    assert backup_block, "deployment script must back up the previous database before upgrade"
    assert '--env-file "$previous_file"' in backup_block.group()
    assert '--env-file "$app_dir/.env.production"' in backup_block.group()
