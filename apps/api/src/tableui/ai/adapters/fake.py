import json
from collections.abc import Callable
from typing import Any

from tableui.ai.domain.provider import Completion, ProviderUnavailable


class FakeProvider:
    """Answers from a function, so tests and local runs need no key and no network."""

    name = "fake"

    def __init__(self, answer: Callable[[str, str], object] | None = None) -> None:
        self.answer = answer or (lambda system, user: {"text": "A short, plain answer."})
        self.calls: list[tuple[str, str]] = []
        self.down = False
        self.model = "fake-1"

    async def complete(
        self, system: str, user: str, *, json_mode: bool, max_tokens: int
    ) -> Completion:
        self.calls.append((system, user))
        if self.down:
            raise ProviderUnavailable("fake provider is down")
        out = self.answer(system, user)
        text = out if isinstance(out, str) else json.dumps(out)
        return Completion(text, len(system + user) // 4, len(text) // 4, "fake", self.model)


def demo_answer(system: str, user: str) -> object:
    """Plausible answers for every feature, so the screens can be tried without a key or a network.

    The wording is generic and says plainly that it is a demo; it only echoes what the prompt contained."""
    data = user.split("<data>")[1].split("</data>")[0].strip() if "<data>" in user else ""
    if "Fields to fill (JSON):" in user:
        spec = json.loads(user.split("Fields to fill (JSON):", 1)[1].split("\n", 1)[0])
        words = data.split()
        out: dict[str, object] = {}
        for i, f in enumerate(f for f in spec if f["type"] in ("text", "long_text")):
            chunk = words[3 * i : 3 * i + 3]
            if len(chunk) == 3:
                out[f["key"]] = {"value": " ".join(chunk), "quote": " ".join(chunk)}
        return {"fields": out}
    if "transformation rules for a field" in system:
        return _demo_transform(user.rsplit("<data>", 1)[1].split("</data>")[0].strip())
    if "regular expression" in system:
        return _demo_pattern(data)
    if "Describe the data tables" in system:
        return _demo_schema(data)
    if "You plan changes to the setup" in system:
        return _demo_plan(data)
    if "search filters" in system:
        spec = json.loads(user.split("Fields: ", 1)[1].split("\n", 1)[0])
        filters: dict[str, str] = {}
        for f in spec:
            for choice in f.get("choices") or []:
                if choice.lower() in data.lower():
                    filters[f["key"]] = choice
        return {"filters": filters, "text": ""}
    if "Draft a short message" in system:
        return {
            "subject": "A quick hello (demo draft)",
            "body": "Hi,\n\nThis is a demo draft written without a real AI provider.\n\n[Your name]",
        }
    return {"text": "Demo answer: " + (data[:160] or "no details were given.")}


def _demo_plan(words: str) -> object:
    """A tiny plan for trying the chat without a key: a table named after what the owner says to track."""
    import re

    m = re.search(
        r"(?:track|keep|manage|record)\s+(?:our\s+|my\s+|the\s+)?([A-Za-z]+)", words, re.I
    )
    if not m:
        return {"reply": "Demo mode: tell me what to track, for example 'track our projects'.", "steps": []}  # fmt: skip
    word = m.group(1).lower()
    one = word[:-1] if word.endswith("s") and len(word) > 3 else word
    extra = re.search(r"with (\d{1,2}) fields", words, re.I)
    more = [
        {"op": "field.add", "args": {"table": one, "label": f"Detail {i}", "type": "text"}, "why": "An extra detail."}
        for i in range(1, min(int(extra.group(1)), 18) + 1)
    ] if extra else []  # fmt: skip
    return {
        "reply": f"Demo plan: a {one} table with a status, a list screen and a menu entry.",
        "steps": [
            {
                "op": "table.add",
                "args": {"label": one.title(), "plural_label": one.title() + "s"},
                "why": f"A place to keep your {word}.",
            },  # fmt: skip
            {
                "op": "field.add",
                "args": {
                    "table": one,
                    "label": "Status",
                    "type": "select",
                    "options": ["Open", "In progress", "Done"],
                },
                "why": "See how each one is going.",
            },  # fmt: skip
            *more,
        ],
    }


def _demo_schema(words: str) -> object:
    """Reads lines like 'Clients: Name, City, Email' as tables, so the document import can be tried offline."""
    import re

    tables: list[dict[str, Any]] = []
    for line in words.splitlines():
        m = re.match(r"^\s*([A-Z][A-Za-z ]{1,30}):\s*(.+)$", line)
        if not m:
            continue
        fields: list[dict[str, Any]] = []
        for raw in m.group(2).split(","):
            f = raw.strip()
            if not f:
                continue
            low = f.lower()
            ftype = (
                "email"
                if "email" in low
                else "phone"
                if "phone" in low
                else "date"
                if "date" in low
                else "text"
            )
            fields.append(
                {
                    "label": f,
                    "type": ftype,
                    "required": False,
                    "choices": [],
                    "links_to": None,
                    "quote": f,
                }
            )
        tables.append({"label": m.group(1).strip(), "quote": m.group(1).strip(), "fields": fields})
    labels = {str(t["label"]).lower(): str(t["label"]) for t in tables}
    for t in tables:
        for f in t["fields"]:
            one = str(f["label"]).lower()
            for lab in labels:
                if lab != str(t["label"]).lower() and (
                    one == lab or one + "s" == lab or one == lab.rstrip("s")
                ):
                    f["links_to"] = labels[lab]
    return {"tables": tables}


_COUNT = {"one": 1, "a": 1, "an": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6}


def _demo_pattern(words: str) -> object:
    """A pattern from a description such as "5 capital letters, then 4 digits, then 1 capital letter"."""
    import re

    kinds = {
        "capital": ("[A-Z]", "A"),
        "digit": ("[0-9]", "1"),
        "lowercase": ("[a-z]", "a"),
        "letter": ("[A-Za-z]", "a"),
    }
    parts = re.findall(
        r"(\d+|one|an?|two|three|four|five|six)\s+(capital|lowercase|digit|letter)", words.lower()
    )
    if not parts:
        return {"pattern": "(", "explanation": "Demo could not read that.", "good": [], "bad": []}
    pattern, good = "^", ""
    for count, kind in parts:
        n = int(count) if count.isdigit() else _COUNT[count]
        pattern += f"{kinds[kind][0]}{{{n}}}"
        good += kinds[kind][1] * n
    pattern += "$"
    return {
        "pattern": pattern,
        "explanation": "Demo pattern built from the counts and kinds named in the description.",
        "good": [good],
        "bad": [good.lower(), good + "!"],
    }


def _demo_transform(words: str) -> object:
    """Rules from a description such as "if it says two months, save 60" or "if it is blank, use 30"."""
    import re

    low = words.lower()
    m = re.search(
        r"if (?:it )?says ['\"]?(.+?)['\"]?,?\s+(?:save|set|use|make it)\s+['\"]?([^'\"]+?)['\"]?\.?\s*$",
        low,
    )
    if m:
        return {
            "rules": [
                {
                    "when": "equals_any",
                    "args": [m.group(1)],
                    "do": "set",
                    "value": m.group(2),
                    "stop": False,
                }
            ],
            "explanation": f"Demo rule: when the value is “{m.group(1)}”, save {m.group(2)}.",
            "tries": [m.group(1), "something else"],
        }
    m = re.search(
        r"(?:blank|empty).*?(?:save|set|use|make it)\s+['\"]?([^'\"]+?)['\"]?\.?\s*$", low
    )
    if m:
        return {
            "rules": [
                {"when": "blank", "args": [], "do": "set", "value": m.group(1), "stop": True}
            ],
            "explanation": f"Demo rule: when left blank, save {m.group(1)}.",
            "tries": ["", "keep me"],
        }
    return {"rules": [], "explanation": "Demo could not read that.", "tries": []}
