"""Work out the next release version from Conventional Commits.

The continuous-delivery workflow calls ``next`` after Merge checks pass on
main. It reads every commit since the newest ``vX.Y.Z`` tag reachable from the
tested commit and bumps:

- major for ``type!:`` subjects or a ``BREAKING CHANGE:`` footer,
- minor for ``feat``,
- patch for ``fix``, ``perf`` and ``revert``.

Anything else (``chore``, ``docs``, ``test``, ``ci``, ``build``, ``refactor``,
``style`` or a subject that is not a Conventional Commit) does not release.
Commits by ``github-actions[bot]`` and ``chore(release):`` commits are skipped
so a release can never trigger another one.

``notes`` writes the grouped changelog for a GitHub Release, and ``is-latest``
says whether a tag is the highest release, which decides the ``latest`` image.
Only the standard library is used, so it runs on a bare runner.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

RELEASE_TAG = re.compile(r"^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
SUBJECT = re.compile(r"^(?P<type>[a-zA-Z]+)(?:\([^)]*\))?(?P<breaking>!)?: \S")
BREAKING_FOOTER = re.compile(r"^BREAKING[ -]CHANGE: ", re.MULTILINE)
BOT_AUTHORS = {"github-actions[bot]", "41898282+github-actions[bot]@users.noreply.github.com"}
LOOP_PREFIX = "chore(release):"

BUMPS = {"feat": "minor", "fix": "patch", "perf": "patch", "revert": "patch"}
RANK = {None: 0, "patch": 1, "minor": 2, "major": 3}
SECTIONS = (
    ("major", "Breaking changes"),
    ("feat", "Features"),
    ("fix", "Fixes"),
    ("perf", "Performance"),
    ("revert", "Reverts"),
)

# git log fields: sha, author name, author email, subject, body; records end in \x1e.
LOG_FORMAT = "%H%x1f%an%x1f%ae%x1f%s%x1f%b%x1e"


@dataclass(frozen=True)
class Commit:
    sha: str
    author_name: str
    author_email: str
    subject: str
    body: str = ""


def parse_version(tag: str) -> tuple[int, int, int] | None:
    match = RELEASE_TAG.match(tag)
    if not match:
        return None
    major, minor, patch = (int(part) for part in match.groups())
    return major, minor, patch


def is_ignored(commit: Commit) -> bool:
    return (
        commit.author_name in BOT_AUTHORS
        or commit.author_email in BOT_AUTHORS
        or commit.subject.startswith(LOOP_PREFIX)
    )


def classify(commit: Commit) -> str | None:
    """Return the section key of a release-worthy commit, else None."""
    if is_ignored(commit):
        return None
    match = SUBJECT.match(commit.subject)
    if not match:
        return None
    if match.group("breaking") or BREAKING_FOOTER.search(commit.body):
        return "major"
    commit_type = match.group("type").lower()
    return commit_type if commit_type in BUMPS else None


def bump_for(commits: list[Commit]) -> str | None:
    bump: str | None = None
    for commit in commits:
        section = classify(commit)
        candidate = "major" if section == "major" else BUMPS.get(section or "")
        if RANK[candidate] > RANK[bump]:
            bump = candidate
    return bump


def next_version(previous: str, bump: str) -> str:
    parsed = parse_version(previous)
    if parsed is None:
        raise ValueError(f"Not a release tag: {previous}")
    major, minor, patch = parsed
    if bump == "major":
        return f"v{major + 1}.0.0"
    if bump == "minor":
        return f"v{major}.{minor + 1}.0"
    return f"v{major}.{minor}.{patch + 1}"


def render_notes(commits: list[Commit], previous: str, tag: str, repository: str) -> str:
    grouped: dict[str, list[str]] = {key: [] for key, _ in SECTIONS}
    for commit in commits:
        section = classify(commit)
        if section:
            grouped[section].append(f"- {commit.subject} ({commit.sha[:7]})")
    lines: list[str] = []
    for key, title in SECTIONS:
        if grouped[key]:
            lines += [f"## {title}", "", *grouped[key], ""]
    if not lines:
        lines = ["No user-facing changes.", ""]
    lines.append(f"**Full changelog:** https://github.com/{repository}/compare/{previous}...{tag}")
    return "\n".join(lines) + "\n"


def _git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True)


def release_tags(merged_into: str | None = None) -> list[str]:
    args = ["tag", "--list", "v*"]
    if merged_into:
        args += ["--merged", merged_into]
    tags = [tag for tag in _git(*args).split() if parse_version(tag)]
    return sorted(tags, key=lambda tag: parse_version(tag) or (0, 0, 0))


def is_ancestor(ancestor: str, descendant: str) -> bool:
    result = subprocess.run(["git", "merge-base", "--is-ancestor", ancestor, descendant])
    return result.returncode == 0


def commits_between(previous: str, sha: str) -> list[Commit]:
    raw = _git("log", f"--format={LOG_FORMAT}", f"{previous}..{sha}")
    commits = []
    for record in raw.split("\x1e"):
        record = record.strip("\n")
        if record:
            sha_, name, email, subject, body = record.split("\x1f", 4)
            commits.append(Commit(sha_, name, email, subject, body))
    return commits


def previous_release(sha: str) -> str:
    tags = release_tags(merged_into=sha)
    if not tags:
        raise SystemExit(f"No vX.Y.Z tag is reachable from {sha}; tag a first release by hand.")
    return tags[-1]


def command_next(args: argparse.Namespace) -> int:
    outputs: dict[str, str] = {"release": "false", "tag": "", "previous": "", "reason": ""}
    already = [tag for tag in release_tags() if is_ancestor(args.sha, f"{tag}^{{commit}}")]
    if already:
        outputs["reason"] = f"{args.sha[:12]} is already part of release {already[-1]}"
    else:
        previous = previous_release(args.sha)
        commits = commits_between(previous, args.sha)
        bump = bump_for(commits)
        outputs["previous"] = previous
        if bump is None:
            outputs["reason"] = f"no feat, fix, perf, revert or breaking commits since {previous}"
        else:
            outputs.update(release="true", tag=next_version(previous, bump))
            outputs["reason"] = f"{bump} bump from {previous}"
    for key, value in outputs.items():
        print(f"{key}={value}")
    return 0


def command_notes(args: argparse.Namespace) -> int:
    earlier = [tag for tag in release_tags(merged_into=args.sha) if tag != args.tag]
    if not earlier:
        raise SystemExit(f"No release before {args.tag} to write a changelog from.")
    previous = earlier[-1]
    notes = render_notes(commits_between(previous, args.sha), previous, args.tag, args.repository)
    args.output.write_text(notes)
    return 0


def command_is_latest(args: argparse.Namespace) -> int:
    version = parse_version(args.tag)
    if version is None:
        raise SystemExit(f"Not a release tag: {args.tag}")
    others = [parse_version(tag) or (0, 0, 0) for tag in release_tags() if tag != args.tag]
    print(f"latest={'true' if all(version > other for other in others) else 'false'}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)

    next_parser = sub.add_parser("next", help="Print GitHub outputs for the next release")
    next_parser.add_argument("--sha", required=True)
    next_parser.set_defaults(func=command_next)

    notes_parser = sub.add_parser("notes", help="Write the grouped changelog for a release")
    notes_parser.add_argument("--tag", required=True)
    notes_parser.add_argument("--sha", required=True)
    notes_parser.add_argument("--repository", required=True)
    notes_parser.add_argument("--output", type=Path, required=True)
    notes_parser.set_defaults(func=command_notes)

    latest_parser = sub.add_parser("is-latest", help="Print latest=true if the tag is highest")
    latest_parser.add_argument("--tag", required=True)
    latest_parser.set_defaults(func=command_is_latest)

    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
