"""A deterministic résumé reader: text in, fields with a confidence out. No AI, no network.

It is the built-in parser behind the same port as a vendor (RChilli or Affinda). Every field carries a
confidence between 0 and 1; the review screen asks a person to check anything under 0.8.
"""

import re
from dataclasses import dataclass, field
from typing import Any

FIELDS = ("name", "email", "phone", "title", "employer", "location", "experience_months", "skills")

_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_PHONE = re.compile(r"(?<!\d)(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?!\d)")
_EXPERIENCE = re.compile(
    r"(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years|yrs|year|yr)(?:\s*(?:and\s*)?(\d{1,2})\s*(?:months|mos|mo))?",
    re.I,
)
_SECTION = re.compile(
    r"^\s*(skills|technical skills|key skills|core skills|areas of expertise|experience|work experience|professional experience|"
    r"employment|education|projects|summary|profile|objective|certifications|personal details|contact)\s*:?\s*$",
    re.I,
)
_TITLE_WORDS = re.compile(
    r"\b(engineer|developer|manager|analyst|consultant|designer|architect|lead|executive|specialist|"
    r"scientist|administrator|officer|associate|intern|accountant|tester)\b",
    re.I,
)
_COMPANY_HINT = re.compile(
    r"\b(pvt\.?|private|ltd\.?|limited|llp|inc\.?|technologies|solutions|services|systems|labs|"
    r"consulting|software|infotech|bank)\b",
    re.I,
)
_CITIES = (
    "Bengaluru", "Bangalore", "Mumbai", "Pune", "Hyderabad", "Chennai", "Delhi", "New Delhi", "Gurugram",
    "Gurgaon", "Noida", "Kolkata", "Ahmedabad", "Kochi", "Jaipur", "Chandigarh", "Indore", "Coimbatore",
    "Thiruvananthapuram", "Nagpur", "Lucknow", "Bhubaneswar", "Mysuru", "Vadodara", "Visakhapatnam",
)  # fmt: skip
_KNOWN_SKILLS = (
    "Java", "Python", "JavaScript", "TypeScript", "React", "Angular", "Node.js", "Spring", "Spring Boot",
    "SQL", "PostgreSQL", "MySQL", "Oracle", "AWS", "Azure", "GCP", "Docker", "Kubernetes", "Kafka",
    "Go", "C#", ".NET", "C++", "Kotlin", "Swift", "Android", "iOS", "Django", "Flask", "FastAPI",
    "Hadoop", "Spark", "Tableau", "Power BI", "Excel", "SAP", "Salesforce", "Selenium", "Figma",
    "Machine Learning", "Data Analysis", "Microservices", "REST", "GraphQL", "Terraform", "Linux",
)  # fmt: skip


@dataclass
class Parsed:
    text: str
    fields: dict[str, dict[str, Any]] = field(default_factory=dict)

    def put(self, key: str, value: Any, confidence: float) -> None:
        if value in (None, "", []):
            return
        self.fields[key] = {"value": value, "confidence": round(confidence, 2)}


def _lines(text: str) -> list[str]:
    return [ln.strip() for ln in text.splitlines() if ln.strip()]


def _is_heading(ln: str) -> bool:
    """A known section name, or a short line in another script (for example a Hindi heading)."""
    if _SECTION.match(ln):
        return True
    words = ln.split()
    return (
        0 < len(words) <= 4
        and not any(c.isascii() and c.isalpha() for c in ln)
        and any(c.isalpha() for c in ln)
    )


def _section(lines: list[str], names: tuple[str, ...]) -> list[str]:
    out: list[str] = []
    inside = False
    for ln in lines:
        if _is_heading(ln):
            m = _SECTION.match(ln)
            inside = bool(m) and m.group(1).lower() in names  # type: ignore[union-attr]
            continue
        if inside:
            out.append(ln)
    return out


_WORKING = re.compile(
    r"(?:currently\s+)?(?:working|employed)\s+(?:at|with)\s+([A-Z][\w&.\- ]{1,60}?)"
    r"(?:\s+as\s+(?:an?\s+)?([A-Z][\w ]{2,40}?))?(?=[.,;]|$|\s+(?:since|from|for)\b)",
    re.M,
)
_YEARS = re.compile(
    r"(19|20)\d{2}\s*(?:[–-]|to)\s*(?:present|current|now|date|till date|(19|20)\d{2})", re.I
)


def _job_line(lines: list[str]) -> tuple[str | None, str | None]:
    """The latest job line in the experience section, in its common shapes:
    'Employer | Title | 2019 – Present', 'Title, Employer (2019 - Present)', 'Title at Employer, 2019 to date'."""
    for ln in (
        _section(lines, ("experience", "work experience", "professional experience", "employment"))
        or lines
    ):
        if not _YEARS.search(ln):
            continue
        core = _YEARS.sub("", ln)
        core = re.sub(r"\(\s*\)|\(\s*$", "", core).strip(" ,.|–-()")
        m = re.match(r"^(.+?)\s+at\s+(.+)$", core)
        if m and _TITLE_WORDS.search(m.group(1)):
            return m.group(2).strip(" ,.("), m.group(1).strip(" ,.")
        parts = [
            x.strip(" .,()") for x in re.split(r"\s[|–—]\s|\s-\s|\||,\s", core) if x.strip(" .,()")
        ]
        if not parts:
            continue
        a, b = parts[0], (parts[1] if len(parts) > 1 else None)
        if b and _TITLE_WORDS.search(a) and not _TITLE_WORDS.search(b):
            a, b = b, a  # 'Title | Employer'
        return a, b
    return None, None


def _name(lines: list[str]) -> tuple[str | None, float]:
    for ln in lines[:6]:
        clean = re.sub(r"^(name|full name)\s*[:\-]\s*", "", ln, flags=re.I).strip()
        if _EMAIL.search(clean) or _PHONE.search(clean) or _SECTION.match(clean):
            continue
        if re.search(r"resume|curriculum|vitae|\bcv\b|profile", clean, re.I):
            continue
        words = clean.split()
        if 2 <= len(words) <= 4 and all(re.fullmatch(r"[A-Za-z][A-Za-z.'-]*", w) for w in words):
            return " ".join(w if w.isupper() and len(w) <= 2 else w.capitalize() for w in words), (
                0.9 if ln is lines[0] else 0.8
            )
    return None, 0.0


def _skills(lines: list[str], text: str) -> tuple[list[str], float]:
    block = _section(
        lines, ("skills", "technical skills", "key skills", "core skills", "areas of expertise")
    )
    if block:
        raw = re.split(r"[,|•;/·\x7f\u2022\u25aa\u25cf\u2023\uf0b7]|\s{2,}", " , ".join(block[:12]))
        items: list[str] = []
        for x in raw:
            s = re.sub(r"^[-*–\s]+|[\s.]+$", "", x).strip()
            s = re.sub(r"^(languages|frameworks|tools|databases|cloud)\s*:\s*", "", s, flags=re.I)
            if 1 <= len(s) <= 30 and s.lower() not in {i.lower() for i in items}:
                items.append(s)
        if items:
            return items[:25], 0.85
    found = [
        s for s in _KNOWN_SKILLS if re.search(rf"(?<![\w.]){re.escape(s)}(?![\w])", text, re.I)
    ]
    return found[:25], 0.6 if found else 0.0


def _experience(text: str) -> tuple[int | None, float]:
    best: tuple[int | None, float] = (None, 0.0)
    for m in _EXPERIENCE.finditer(text):
        months = round(float(m.group(1)) * 12) + (int(m.group(2)) if m.group(2) else 0)
        window = text[max(0, m.start() - 60) : m.end() + 60].lower()
        conf = 0.85 if "experience" in window else 0.6
        if conf > best[1]:
            best = (months, conf)
    return best


def _employer(lines: list[str], flat: str) -> tuple[str | None, float]:
    m = _WORKING.search(flat)
    if m:
        return m.group(1).strip(" .,"), 0.85
    for ln in lines:
        m2 = re.match(
            r"^(?:company|employer|current (?:company|employer|organi[sz]ation))\s*[:\-]\s*(.+)$",
            ln,
            re.I,
        )
        if m2:
            return m2.group(1).strip(" .,"), 0.85
    employer, _ = _job_line(lines)
    if employer:
        return employer, 0.75 if _COMPANY_HINT.search(employer) else 0.65
    return None, 0.0


def _title(lines: list[str], name: str | None, flat: str) -> tuple[str | None, float]:
    for ln in lines:
        m = re.match(
            r"^(?:designation|current (?:title|role|designation)|title|role)\s*[:\-]\s*(.+)$",
            ln,
            re.I,
        )
        if m:
            return m.group(1).strip(" .,"), 0.85
    for ln in lines[:4]:
        if (
            ln == name
            or _EMAIL.search(ln)
            or len(ln) > 50
            or len(ln.split()) < 2
            or _is_heading(ln)
        ):
            continue
        if _TITLE_WORDS.search(ln) and not _COMPANY_HINT.search(ln) and not re.search(r"\d", ln):
            return ln.strip(" .,|"), 0.85
    w = _WORKING.search(flat)
    if w and w.group(2):
        return w.group(2).strip(" .,"), 0.8
    _, title = _job_line(lines)
    if title and _TITLE_WORDS.search(title):
        return title, 0.75
    return None, 0.0


def _location(lines: list[str]) -> tuple[str | None, float]:
    for ln in lines:
        m = re.match(r"^(?:location|current location|city|address)\s*[:\-]\s*(.+)$", ln, re.I)
        if m:
            value = m.group(1).strip(" .,")
            city = next((c for c in _CITIES if c.lower() in value.lower()), None)
            return (city or value.split(",")[0]).strip(), 0.9 if city else 0.75
    for c in _CITIES:
        if re.search(rf"\b{re.escape(c)}\b", "\n".join(lines[:10])):
            return c, 0.7
    return None, 0.0


def parse_resume(text: str) -> Parsed:
    lines = _lines(text)
    p = Parsed(text=text)
    email = _EMAIL.search(text)
    p.put("email", email.group(0).lower() if email else None, 0.98)
    phone = _PHONE.search(text)
    if phone:
        digits = re.sub(r"\D", "", phone.group(0))[-10:]
        p.put("phone", f"+91{digits}", 0.95)
    name, c = _name(lines)
    p.put("name", name, c)
    flat = re.sub(r"\s*\n\s*", " ", text)
    title, c = _title(lines, name, flat)
    p.put("title", title, c)
    employer, c = _employer(lines, flat)
    p.put("employer", employer, c)
    location, c = _location(lines)
    p.put("location", location, c)
    months, c = _experience(text)
    p.put("experience_months", months, c)
    skills, c = _skills(lines, text)
    p.put("skills", skills, c)
    return p
