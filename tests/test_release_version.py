from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from scripts import release_version

Commit = release_version.Commit


def commit(subject: str, body: str = "", name: str = "Vlad") -> Commit:
    return Commit("0123456789abcdef", name, "vlad@example.test", subject, body)


@pytest.mark.parametrize(
    ("subjects", "bump"),
    [
        (["docs: explain deploys", "chore(deps): bump", "test(e2e): wait"], None),
        (["fix(deps): bump vite (#179)"], "patch"),
        (["perf: cache plans"], "patch"),
        (["revert: undo the plan cache"], "patch"),
        (["fix: a", "feat(history): edit past workouts (#176)"], "minor"),
        (["feat!: drop the v1 API"], "major"),
        (["Coaching principles: one admin-edited text (#164)"], None),
    ],
)
def test_bump_follows_conventional_commit_types(subjects: list[str], bump: str | None) -> None:
    assert release_version.bump_for([commit(subject) for subject in subjects]) == bump


def test_breaking_change_footer_is_a_major_bump() -> None:
    body = "Moves the endpoint.\n\nBREAKING CHANGE: /api/v1/logs is gone"
    assert release_version.bump_for([commit("feat: new logs API", body)]) == "major"


def test_release_and_bot_commits_never_cut_a_release() -> None:
    commits = [
        commit("chore(release): v3.7.0"),
        commit("feat: generated", name="github-actions[bot]"),
        Commit("abc", "x", "41898282+github-actions[bot]@users.noreply.github.com", "fix: x"),
    ]
    assert release_version.bump_for(commits) is None


@pytest.mark.parametrize(
    ("previous", "bump", "expected"),
    [
        ("v3.6.0", "patch", "v3.6.1"),
        ("v3.6.2", "minor", "v3.7.0"),
        ("v3.6.2", "major", "v4.0.0"),
    ],
)
def test_next_version(previous: str, bump: str, expected: str) -> None:
    assert release_version.next_version(previous, bump) == expected


def test_only_plain_semver_tags_count_as_releases() -> None:
    assert release_version.parse_version("v3.6.0") == (3, 6, 0)
    assert release_version.parse_version("v3.6.0-rc.1") is None
    assert release_version.parse_version("e2e-abc") is None


def test_notes_group_release_worthy_commits_only() -> None:
    notes = release_version.render_notes(
        [commit("feat: volume rules (#178)"), commit("fix: vite"), commit("docs: readme")],
        "v3.6.0",
        "v3.7.0",
        "vvojtisek/workout-logger",
    )

    assert "## Features\n\n- feat: volume rules (#178) (0123456)" in notes
    assert "## Fixes\n\n- fix: vite (0123456)" in notes
    assert "docs: readme" not in notes
    assert "compare/v3.6.0...v3.7.0" in notes


def git(repo: Path, *args: str) -> str:
    return subprocess.check_output(["git", "-C", str(repo), *args], text=True).strip()


def make_commit(repo: Path, subject: str) -> str:
    git(repo, "commit", "--allow-empty", "-q", "-m", subject)
    return git(repo, "rev-parse", "HEAD")


@pytest.fixture
def repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    git(tmp_path, "init", "-q", "-b", "main")
    git(tmp_path, "config", "user.name", "Vlad")
    git(tmp_path, "config", "user.email", "vlad@example.test")
    make_commit(tmp_path, "feat: first")
    git(tmp_path, "tag", "v1.2.3")
    monkeypatch.chdir(tmp_path)
    return tmp_path


def run_next(sha: str, capsys: pytest.CaptureFixture[str]) -> dict[str, str]:
    assert release_version.main(["next", "--sha", sha]) == 0
    return dict(line.split("=", 1) for line in capsys.readouterr().out.splitlines())


def test_next_skips_when_nothing_release_worthy(
    repo: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    sha = make_commit(repo, "ci: tweak workflow")

    outputs = run_next(sha, capsys)

    assert outputs["release"] == "false"
    assert outputs["previous"] == "v1.2.3"


def test_next_bumps_from_the_newest_reachable_tag(
    repo: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    make_commit(repo, "fix: one")
    sha = make_commit(repo, "feat: two")

    outputs = run_next(sha, capsys)

    assert outputs == {
        "release": "true",
        "tag": "v1.3.0",
        "previous": "v1.2.3",
        "reason": "minor bump from v1.2.3",
    }


def test_next_skips_a_commit_a_later_release_already_contains(
    repo: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    older = make_commit(repo, "fix: one")
    make_commit(repo, "feat: two")
    git(repo, "tag", "v1.3.0")

    outputs = run_next(older, capsys)

    assert outputs["release"] == "false"
    assert "v1.3.0" in outputs["reason"]


def test_is_latest_compares_semver_not_text(repo: Path, capsys: pytest.CaptureFixture[str]) -> None:
    git(repo, "tag", "v1.10.0")

    release_version.main(["is-latest", "--tag", "v1.9.0"])
    assert capsys.readouterr().out.strip() == "latest=false"
    release_version.main(["is-latest", "--tag", "v1.11.0"])
    assert capsys.readouterr().out.strip() == "latest=true"
