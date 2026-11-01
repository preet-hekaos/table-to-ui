"""Type presets: a named bundle of core type, length and saved-as handling.

A preset is a one-time bundle (decision A): choosing it fills the field's own settings and leaves no link back.
Industry words live here only as data in a registry; the models stay free of them.
"""

from dataclasses import dataclass
from typing import Any

# Which core types a live field may be changed to. A type not listed can only stay as it is.
COMPATIBLE: dict[str, frozenset[str]] = {
    "text": frozenset({"text", "long_text"}),
    "long_text": frozenset({"long_text", "text"}),
    "email": frozenset({"email", "text", "long_text"}),
    "phone": frozenset({"phone", "text", "long_text"}),
    "url": frozenset({"url", "text", "long_text"}),
    "integer": frozenset({"integer", "decimal"}),
}


def compatible(old: str, new: str) -> bool:
    return new in COMPATIBLE.get(old, frozenset({old}))


def why_not(old: str, new: str) -> str:
    return (
        f"existing {old.replace('_', ' ')} values cannot always be read as {new.replace('_', ' ')}; "
        "add a new field instead"
    )


@dataclass(frozen=True)
class Preset:
    key: str
    name: str
    core: str
    area: str  # "common" or an industry area such as "recruitment"
    description: str
    example: str
    max_length: int | None = None
    save_as: str | None = None  # "upper" or "lower"
    min: float | None = None
    max: float | None = None

    def settings(self) -> dict[str, Any]:
        """What choosing the preset writes onto the field."""
        return {
            "type": self.core,
            "type_name": self.name,
            "max_length": self.max_length,
            "save_as": self.save_as,
            "min": self.min,
            "max": self.max,
        }


PRESETS: tuple[Preset, ...] = (
    Preset(
        "person_name", "Person name", "text", "common", "A person's full name", "Asha Verma", 120
    ),
    Preset(
        "email_address",
        "Email address",
        "email",
        "common",
        "One email address, saved in lower case",
        "asha@example.com",
        254,
    ),
    Preset(
        "mobile_in",
        "Mobile number (India)",
        "phone",
        "common",
        "An Indian mobile number, saved as +91 and ten digits",
        "+91 98450 12345",
    ),
    Preset(
        "job_title", "Job title", "text", "common", "A role or designation", "Senior accountant", 80
    ),
    Preset("city", "City", "text", "common", "A city or town", "Pune", 60),
    Preset(
        "website",
        "Website",
        "url",
        "common",
        "A web address starting with http or https",
        "https://example.com",
        200,
    ),
    Preset(
        "pan_in",
        "PAN (India)",
        "text",
        "recruitment",
        "Permanent Account Number, saved in capitals",
        "ABCDE1234F",
        10,
        "upper",
    ),
    Preset(
        "pincode_in",
        "Pincode (India)",
        "text",
        "recruitment",
        "A six digit postal code",
        "560001",
        6,
    ),
    Preset(
        "notice_days",
        "Notice period (days)",
        "integer",
        "recruitment",
        "Days of notice, from 0 to 180",
        "60",
        None,
        None,
        0,
        180,
    ),
    Preset(
        "annual_salary",
        "Annual salary (INR)",
        "money",
        "recruitment",
        "A yearly amount; 12.5 LPA is read as 1250000",
        "12.5 LPA",
    ),
    Preset(
        "experience",
        "Experience (years and months)",
        "months",
        "recruitment",
        "A duration kept as whole months",
        "5 yrs 3 mo",
    ),
    Preset(
        "skills_list", "Skills list", "tags", "recruitment", "A list of short labels", "Tally, GST"
    ),
)
BY_KEY = {p.key: p for p in PRESETS}
BY_NAME = {p.name: p for p in PRESETS}
