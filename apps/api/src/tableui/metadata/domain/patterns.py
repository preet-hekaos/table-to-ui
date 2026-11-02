"""Pattern rules (S3): the portable regular-expression subset, the safety checks, and the ready-made library.

One engine, on the server. The Studio preview calls the same `rule_problem`, so a sample behaves in the popover
exactly as it does on a form, an import or the API.
"""

import datetime as dt
import re
import re._parser as sre  # type: ignore[import-not-found]  # the standard library's own pattern parser
from dataclasses import dataclass
from typing import Any

MAX_PATTERN = 300
MAX_RULES = 20
_UNBOUNDED = sre.MAXREPEAT


def check_pattern(pattern: str) -> str | None:
    """Why a pattern cannot be used, or None when it is fine. Portable subset: no look-behind, back-references
    or inline flags, so it means the same thing in every language the app talks to. No nested open-ended repeats,
    which can make a check run for ever."""
    if not pattern.strip():
        return "the pattern is empty"
    if len(pattern) > MAX_PATTERN:
        return f"the pattern is longer than {MAX_PATTERN} characters"
    try:
        tree = sre.parse(pattern)
    except re.error as e:
        return f"the pattern is not valid: {e}"
    return _walk(tree, in_repeat=False)


def _walk(items: Any, in_repeat: bool) -> str | None:
    for op, arg in items:
        name = str(op)
        if name in ("ASSERT", "ASSERT_NOT") and arg[0] == -1:
            return "look-behind is not supported"
        if name in ("GROUPREF", "GROUPREF_EXISTS"):
            return "back-references are not supported"
        if name in ("MAX_REPEAT", "MIN_REPEAT", "POSSESSIVE_REPEAT"):
            lo, hi, sub = arg
            open_ended = hi == _UNBOUNDED or hi > 1000
            if open_ended and in_repeat:
                return "a repeat inside a repeat can run away; use a fixed count"
            problem = _walk(sub, in_repeat or open_ended)
            if problem:
                return problem
        elif name == "SUBPATTERN":
            problem = _walk(arg[-1], in_repeat)
            if problem:
                return problem
        elif name == "BRANCH":
            for branch in arg[1]:
                problem = _walk(branch, in_repeat)
                if problem:
                    return problem
        elif name in ("ASSERT", "ASSERT_NOT"):
            problem = _walk(arg[1], in_repeat)
            if problem:
                return problem
    return None


def rule_problem(kind: str, pattern: str, value: Any) -> bool:
    """True when the value breaks the rule. Only text and dates are checked; a blank value is left to Required."""
    if value is None or value == "":
        return False
    text = str(value)
    if kind == "not_future":
        try:
            return dt.date.fromisoformat(text[:10]) > dt.date.today()
        except ValueError:
            return False
    return re.search(pattern, text) is None


@dataclass(frozen=True)
class LibraryItem:
    key: str
    name: str
    pattern: str
    message: str
    good: tuple[str, ...]
    bad: tuple[str, ...]
    kind: str = "pattern"


LIBRARY: tuple[LibraryItem, ...] = (
    LibraryItem(
        "email",
        "Email",
        r"^[^@\s]+@[^@\s]+\.[^@\s]+$",
        "Enter a valid email address.",
        ("asha@example.com",),
        ("asha@", "asha example.com"),
    ),
    LibraryItem(
        "mobile_in",
        "Mobile (India)",
        r"^(\+91)?[6-9][0-9]{9}$",
        "Enter a 10 digit mobile number starting with 6 to 9.",
        ("+919845012345", "9845012345"),
        ("12345", "5845012345"),
    ),
    LibraryItem(
        "pan",
        "PAN",
        r"^[A-Z]{5}[0-9]{4}[A-Z]$",
        "Enter a PAN like ABCDE1234F.",
        ("ABCDE1234F",),
        ("abcde1234f", "ABCDE12345"),
    ),
    LibraryItem(
        "pincode_in",
        "Pincode (India)",
        r"^[1-9][0-9]{5}$",
        "Enter a 6 digit pincode.",
        ("560001",),
        ("56001", "060001"),
    ),
    LibraryItem(
        "gstin",
        "GSTIN",
        r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$",
        "Enter a 15 character GSTIN like 29ABCDE1234F1Z5.",
        ("29ABCDE1234F1Z5",),
        ("29ABCDE1234F1X5", "ABCDE1234F"),
    ),
    LibraryItem(
        "letters_only",
        "Letters only",
        r"^[A-Za-z ]+$",
        "Use letters and spaces only.",
        ("Asha Rao",),
        ("Asha 2",),
    ),
    LibraryItem(
        "letters_numbers",
        "Letters and numbers",
        r"^[A-Za-z0-9 ]+$",
        "Use letters, numbers and spaces only.",
        ("Asha 2",),
        ("Asha-2",),
    ),
    LibraryItem(
        "web_link",
        "Web link",
        r"^https?://\S+$",
        "Enter a web address starting with http:// or https://.",
        ("https://example.com",),
        ("example.com",),
    ),
    LibraryItem(
        "not_future",
        "Date not in the future",
        "",
        "The date cannot be in the future.",
        ("2020-01-01",),
        ("2999-01-01",),
        kind="not_future",
    ),
)
BY_KEY = {i.key: i for i in LIBRARY}
