from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import run_migrations


def test_successful_release_runs_once_and_retains_output(tmp_path, monkeypatch, capsys) -> None:
    calls: list[list[str]] = []

    def successful_run(command, **_kwargs):
        calls.append(command)
        return subprocess.CompletedProcess(command, 0, "migration output\n")

    monkeypatch.setattr(run_migrations.subprocess, "run", successful_run)

    assert run_migrations.run_migration("abc123def456", "head", tmp_path) == 0
    assert run_migrations.run_migration("abc123def456", "head", tmp_path) == 0

    assert calls == [["alembic", "upgrade", "head"]]
    assert (tmp_path / "abc123def456.succeeded").is_file()
    assert "migration output" in (tmp_path / "abc123def456.log").read_text()
    assert "already completed; skipping" in capsys.readouterr().out


def test_failed_release_retains_output_without_success_marker(tmp_path, monkeypatch) -> None:
    def failed_run(command, **_kwargs):
        return subprocess.CompletedProcess(command, 1, "deliberate migration failure\n")

    monkeypatch.setattr(run_migrations.subprocess, "run", failed_run)

    assert run_migrations.run_migration("abc123def456", "missing_revision", tmp_path) == 1

    assert not (tmp_path / "abc123def456.succeeded").exists()
    assert "deliberate migration failure" in (tmp_path / "abc123def456.log").read_text()


def test_release_id_is_restricted_to_chart_generated_hashes(tmp_path) -> None:
    with pytest.raises(ValueError, match="12 lowercase hexadecimal"):
        run_migrations.run_migration("../outside", "head", tmp_path)
