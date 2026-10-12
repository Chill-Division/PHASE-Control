"""One command releases the repository (scripts/release.py): it dates the Unreleased notes, sets
every version and checks the result before anything is committed, pushed or published.

Only the pure part is tested here: what the release commit will contain, and when to refuse. The
version files are the repository's own, so a change to their format that the release would miss
fails here first.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import release  # noqa: E402
import release_notes  # noqa: E402
from custom_components.crop_steering.whats_new import parse  # noqa: E402

REPO = "https://github.com/owner/repo"
DAY = "2026-10-01"
CHANGELOG = """# Changelog

Intro.

## [Unreleased]

Two changes.

- **A thing.** It is better.

### 🔧 Technical notes

- `thing.py`.

## [2.24.0] - 2026-09-26

Pair: **controller 2.24.0**.

- Older.
"""
ADDON = """# Unreleased

No change to the state file.

- **A thing.** `thing.py`.

# 2.24.0

Pair with integration 2.24.0.
"""
WHATS_NEW = """# What's new

The rules.

## Unreleased

- Bug fixes and improvements.
- Each zone does a new thing, which a grower would
  notice at once.

## 2.24.0 - 2026-09-26

- Older.
"""


def _files(**notes):
    files = release.read_files()
    files.update(
        {
            release.CHANGELOG: CHANGELOG,
            release.ADDON_CHANGELOG: ADDON,
            release.WHATS_NEW: WHATS_NEW,
        }
    )
    files.update(notes)
    return files


def test_every_version_is_set_and_nothing_else_moves():
    before = _files()
    old = release.current_version(before)
    after = release.prepare(before, "9.9.9", DAY)
    assert json.loads(after[release.MANIFEST])["version"] == "9.9.9"
    assert 'SOFTWARE_VERSION = "9.9.9"' in after[release.CONST]
    assert re.search(r'^version: "9\.9\.9"$', after[release.ADDON_CONFIG], re.M)
    assert "badge/Release-9.9.9-" in after[release.README]
    for path in (release.MANIFEST, release.CONST, release.ADDON_CONFIG, release.README):
        assert after[path].replace("9.9.9", old) == before[path], path


def test_a_release_changes_no_line_endings():
    """A rewrite that switched a file's line endings would change every line of it."""
    before = _files()
    after = release.prepare(before, "9.9.9", DAY)
    for path in before:
        assert after[path].count("\r\n") == before[path].count("\r\n"), path


def test_the_unreleased_notes_become_the_release():
    after = release.prepare(_files(), "9.9.9", DAY)
    changelog = after[release.CHANGELOG]
    assert "## [Unreleased]" not in changelog
    assert (
        f"## [9.9.9] - {DAY}\n\nIntegration and controller **9.9.9**.\n\nTwo changes."
        in changelog
    )
    assert changelog.index("## [9.9.9]") < changelog.index("## [2.24.0]")
    notes = release_notes.notes(changelog, "9.9.9", REPO)
    assert (
        notes.startswith("Integration and controller **9.9.9**.")
        and "**A thing.**" in notes
    )
    addon = after[release.ADDON_CHANGELOG]
    assert addon.startswith(
        "# 9.9.9\n\nPair with integration 9.9.9.\n\nNo change to the state file."
    )
    assert "# 2.24.0" in addon


def test_whats_new_is_dated_with_the_small_things_last():
    text = release.prepare(_files(), "9.9.9", DAY)[release.WHATS_NEW]
    newest = parse(text)[0]
    assert (newest["version"], newest["date"]) == ("9.9.9", DAY)
    assert newest["items"] == [
        "Each zone does a new thing, which a grower would notice at once.",
        "Bug fixes and improvements.",
    ]
    assert "## Unreleased" not in text and "The rules." in text


def test_a_release_with_nothing_written_for_growers_or_the_controller():
    files = _files()
    files[release.WHATS_NEW] = WHATS_NEW.replace(
        WHATS_NEW[WHATS_NEW.index("## Unreleased") : WHATS_NEW.index("## 2.24.0")], ""
    )
    files[release.ADDON_CHANGELOG] = ADDON[ADDON.index("# 2.24.0") :]
    after = release.prepare(files, "9.9.9", DAY)
    assert parse(after[release.WHATS_NEW])[0]["items"] == [
        "Bug fixes and improvements."
    ]
    assert after[release.ADDON_CHANGELOG].startswith(
        "# 9.9.9\n\nPair with integration 9.9.9.\n\n# 2.24.0"
    )


def test_it_refuses_a_release_nobody_has_written_up():
    with pytest.raises(release.Refused, match="no '## \\[Unreleased\\]' section"):
        release.prepare(
            _files(**{release.CHANGELOG: CHANGELOG.replace("## [Unreleased]", "")}),
            "9.9.9",
            DAY,
        )
    # Nothing before the technical notes says what changed, for anyone.
    unsaid = CHANGELOG.replace("- **A thing.** It is better.\n\n", "")
    with pytest.raises(release.Refused, match="what this release changes"):
        release.prepare(_files(**{release.CHANGELOG: unsaid}), "9.9.9", DAY)
    # Written under the heading the changelog no longer has: the same.
    headed = CHANGELOG.replace(
        "- **A thing.** It is better.",
        "### 🌱 In plain English\n\n- **A thing.** It is better.",
    )
    with pytest.raises(release.Refused, match="what this release changes"):
        release.prepare(_files(**{release.CHANGELOG: headed}), "9.9.9", DAY)
    stray = WHATS_NEW.replace("## Unreleased\n", "## Unreleased\n\nA paragraph.\n")
    with pytest.raises(release.Refused, match="only '- ' lines"):
        release.prepare(_files(**{release.WHATS_NEW: stray}), "9.9.9", DAY)


def test_numbers_only_go_up():
    release.check_number("2.37.2", "2.37.1", False, CHANGELOG)
    for same_or_lower in ("2.37.1", "1.0.0"):
        with pytest.raises(release.Refused, match="is not newer than 2.37.1"):
            release.check_number(same_or_lower, "2.37.1", False, CHANGELOG)


def test_the_numbers_start_again_only_lower_and_never_on_a_used_number():
    release.check_number("1.0.0", "2.37.1", True, CHANGELOG)  # as 1.0.0 followed 2.37.1
    with pytest.raises(release.Refused, match="for a number below 2.37.1"):
        release.check_number("2.38.0", "2.37.1", True, CHANGELOG)
    with pytest.raises(release.Refused, match="2.24.0 was released before"):
        release.check_number("2.24.0", "2.37.1", True, CHANGELOG)


def test_starting_again_leaves_whats_new_with_the_new_numbers_only():
    after = release.prepare(_files(), "1.0.0", DAY, start_again=True)
    text = after[release.WHATS_NEW]
    # The dashboard orders releases by number: 2.24.0 would come before 1.0.0.
    assert [r["version"] for r in parse(text)] == ["1.0.0"]
    assert text.startswith("# What's new\n\nThe rules.\n\n## 1.0.0 - ")
    assert text.endswith("- Bug fixes and improvements.\n")
    # The changelogs keep everything, and a release that does not start again keeps every section.
    assert "## [2.24.0]" in after[release.CHANGELOG]
    assert "# 2.24.0" in after[release.ADDON_CHANGELOG]
    kept = release.prepare(_files(), "9.9.9", DAY)[release.WHATS_NEW]
    assert [r["version"] for r in parse(kept)] == ["9.9.9", "2.24.0"]


def test_commits_that_ship_nothing_go_public_without_a_release():
    assert (
        release.sync_refusal(
            [
                "README.md",
                "LICENSE",
                "CHANGELOG.md",
                "docs/INSTALL.md",
                "img/operator-dashboard.png",
                "scripts/release.py",
                "tests/test_release.py",
                "frontend/scripts/verify-dashboard.mjs",
            ]
        )
        is None
    )


def test_what_the_supervisor_only_shows_goes_too():
    assert (
        release.sync_refusal(
            [
                "addons/f2_control/CHANGELOG.md",
                "addons/f2_control/DOCS.md",
                "addons/f2_control/icon.png",
                "addons/f2_control/logo.png",
                "addons/f2_control/tests/test_controller.py",
            ]
        )
        is None
    )


def test_the_public_main_only_moves_forward():
    """A commit made straight on the public repository is not in what goes public, and moving its
    main past it would drop it. For 1.1.1 the dry run said it would push and the push was refused:
    the app's changelog had been trimmed there. Both --public and --sync now refuse first, and say
    how such a change comes back."""
    # No public main yet: its first release makes it.
    assert release.fast_forward_refusal(None, False, "v1.1.1") is None
    assert release.fast_forward_refusal("762b40a2f6aaba09", True, "v1.1.1") is None
    why = release.fast_forward_refusal("762b40a2f6aaba09", False, "v1.1.1")
    assert why.startswith(
        f"{release.PUBLIC} main (762b40a2f6aa) has a commit that v1.1.1 does not"
    )
    assert "in a pull request based on it" in why


@pytest.mark.parametrize(
    "shipped",
    [
        "addons/f2_control/f2_control/controller.py",  # the app is built from the public main
        "addons/f2_control/config.yaml",
        "addons/f2_control/Dockerfile",
        "addons/f2_control/LICENSE",  # copied into the image
        "addons/f2_control/www/public/dashboard.html",
        "custom_components/crop_steering/sensor.py",
    ],
)
def test_a_change_a_box_installs_waits_for_a_release(shipped):
    why = release.sync_refusal(["README.md", shipped, "docs/USER_GUIDE.md"])
    assert why and why.startswith(shipped) and "release them instead" in why


@pytest.mark.parametrize("version", ["2.25", "v2.25.0", "2.25.0-rc1", ""])
def test_a_version_is_three_numbers(version):
    with pytest.raises(release.Refused, match="not a version"):
        release.version_tuple(version)


def _run(number, status="completed", conclusion="success", sha="abc", attempt=1):
    return {
        "head_sha": sha,
        "run_number": number,
        "run_attempt": attempt,
        "status": status,
        "conclusion": conclusion,
        "html_url": f"https://github.com/owner/repo/actions/runs/{number}",
    }


def test_it_releases_only_a_commit_validate_has_passed():
    assert release.ci_verdict([_run(7)], "abc") is None
    assert "has not run" in release.ci_verdict([], "abc")
    assert "has not run" in release.ci_verdict([_run(7, sha="other")], "abc")
    assert "still running" in release.ci_verdict([_run(7, status="in_progress")], "abc")
    assert "failure" in release.ci_verdict([_run(7, conclusion="failure")], "abc")
    # the newest run decides: a rerun that passed, or a later push's run that failed
    assert (
        release.ci_verdict([_run(7, conclusion="failure"), _run(7, attempt=2)], "abc")
        is None
    )
    assert "failure" in release.ci_verdict(
        [_run(7), _run(8, conclusion="failure")], "abc"
    )


def test_the_public_repository_is_reached_the_way_origin_is():
    assert release.slug_of("git@github.com:Me/PHASE-Control.git") == "Me/PHASE-Control"
    assert release.slug_of("https://github.com/Me/PHASE-Control") == "Me/PHASE-Control"
    assert (
        release.public_url("git@github.com:Me/x.git")
        == f"git@github.com:{release.PUBLIC}.git"
    )
    assert (
        release.public_url("https://github.com/Me/x.git")
        == f"https://github.com/{release.PUBLIC}.git"
    )
    with pytest.raises(release.Refused):
        release.slug_of("https://gitlab.com/Me/x.git")
