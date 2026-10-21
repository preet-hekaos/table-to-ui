"""Take contact details out of text before it leaves for a model."""

import re

EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
PHONE = re.compile(r"(?<!\w)(?:\+?\d[\d\s().-]{7,}\d)(?!\w)")


def redact(text: str) -> str:
    return PHONE.sub("[phone]", EMAIL.sub("[email]", text))


def squash(text: str) -> str:
    """Lower case with runs of white space collapsed, so a quote can be found in the text it came from."""
    return re.sub(r"\s+", " ", text).strip().lower()
