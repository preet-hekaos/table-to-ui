"""A synthetic corpus of Indian-style CVs with known answers, for the parser accuracy measurement.

Real CVs (200 in Indian formats, some not in English) are an owner action in the M1 PRD. Until they
arrive this corpus stands in: varied layouts, headings, phone and experience formats, PDF and DOCX,
and a share written partly in Hindi. Deterministic: the same seed gives the same files.
"""

import io
import random
from dataclasses import dataclass, field
from typing import Any

FIRST = ["Arjun", "Priya", "Rohan", "Ananya", "Vikram", "Kavya", "Rahul", "Sneha", "Aditya", "Meera",
         "Karthik", "Divya", "Siddharth", "Pooja", "Nikhil", "Lakshmi", "Amit", "Neha", "Suresh", "Isha"]  # fmt: skip
LAST = ["Menon", "Sharma", "Iyer", "Patel", "Reddy", "Nair", "Gupta", "Rao", "Kulkarni", "Singh",
        "Das", "Joshi", "Pillai", "Verma", "Bose", "Shetty", "Chopra", "Mehta", "Banerjee", "Krishnan"]  # fmt: skip
EMPLOYERS = ["Infosys Ltd", "Tata Consultancy Services", "Wipro Technologies", "HCL Technologies",
             "Tech Mahindra", "Mindtree Solutions", "Zoho Software", "Freshworks Technologies",
             "Razorpay Software Pvt Ltd", "Flipkart Internet Pvt Ltd", "HDFC Bank", "Accenture Solutions"]  # fmt: skip
TITLES = ["Software Engineer", "Senior Software Engineer", "Java Developer", "Data Analyst",
          "Business Analyst", "QA Engineer", "Product Manager", "DevOps Engineer", "Tech Lead",
          "Frontend Developer", "Data Scientist", "Solutions Architect"]  # fmt: skip
CITIES = [
    "Bengaluru",
    "Pune",
    "Hyderabad",
    "Chennai",
    "Mumbai",
    "Gurugram",
    "Noida",
    "Kochi",
    "Kolkata",
    "Ahmedabad",
]
SKILLS = ["Java", "Spring Boot", "Python", "SQL", "AWS", "React", "Node.js", "Docker", "Kubernetes",
          "Kafka", "PostgreSQL", "TypeScript", "Angular", "Selenium", "Power BI", "Excel", "Django", "Terraform"]  # fmt: skip


@dataclass
class Sample:
    name: str
    fmt: str  # pdf | docx
    data: bytes
    truth: dict[str, Any] = field(default_factory=dict)
    hindi: bool = False


def _phone(r: random.Random) -> tuple[str, str]:
    d = f"{r.choice('6789')}{r.randrange(10**8, 10**9)}"
    shown = r.choice(
        [f"+91 {d[:5]} {d[5:]}", f"0{d[:5]}-{d[5:]}", d, f"+91-{d}", f"(+91) {d[:5]} {d[5:]}"]
    )
    return shown, f"+91{d}"


def _experience(r: random.Random) -> tuple[str, int]:
    y = r.randrange(1, 18)
    m = r.choice([0, 0, 3, 6, 9])
    if m and r.random() < 0.5:
        return f"Total Experience: {y} years {m} months", y * 12 + m
    if m == 6 and r.random() < 0.5:
        return f"{y}.5 years of experience in building software", y * 12 + 6
    return r.choice(
        [
            f"{y}+ years of experience",
            f"Experience: {y} yrs",
            f"Over {y} years of professional experience",
        ]
    ), y * 12


def _lines(r: random.Random, hindi: bool) -> tuple[list[tuple[str, str]], dict[str, Any]]:
    first, last = r.choice(FIRST), r.choice(LAST)
    name = f"{first} {last}"
    email = f"{first.lower()}.{last.lower()}{r.randrange(1, 99)}@{r.choice(['gmail.com', 'yahoo.co.in', 'outlook.com'])}"
    phone_shown, phone = _phone(r)
    title, employer, city = r.choice(TITLES), r.choice(EMPLOYERS), r.choice(CITIES)
    exp_text, months = _experience(r)
    skills = r.sample(SKILLS, r.randrange(4, 9))
    out: list[tuple[str, str]] = []
    out.append(("h1", name.upper() if r.random() < 0.3 else name))
    if r.random() < 0.6:
        out.append(("p", title))
    out.append(("p", f"{email} | {phone_shown}" if r.random() < 0.5 else f"Email: {email}"))
    if not any(phone_shown in t for _, t in out):
        out.append(("p", f"Mobile: {phone_shown}"))
    if r.random() < 0.85:
        out.append(
            (
                "p",
                r.choice(
                    [
                        f"Location: {city}, India",
                        f"Current Location: {city}",
                        f"{city}, India",
                        f"Address: 12, MG Road, {city} 560001",
                    ]
                ),
            )
        )
    else:
        city = ""  # no location given; the right answer is to leave it empty
    out.append(("h2", "प्रोफ़ाइल सारांश" if hindi else r.choice(["Summary", "Profile", "Objective"])))
    out.append(
        (
            "p",
            f"{exp_text}. Currently working at {employer} as {title}."
            if r.random() < 0.5
            else exp_text + ".",
        )
    )
    out.append(
        (
            "h2",
            "कौशल"
            if hindi and r.random() < 0.5
            else r.choice(["Skills", "Technical Skills", "Key Skills", "Areas of expertise"]),
        )
    )
    style = r.random()
    if style < 0.25:
        out += [("p", f"- {s}") for s in skills]  # one per line
    elif style < 0.4:
        out.append(("p", f"Languages: {', '.join(skills[:2])}"))
        out.append(("p", f"Tools: {', '.join(skills[2:])}"))
    else:
        out.append(("p", r.choice([", ".join(skills), " | ".join(skills), " • ".join(skills)])))
    out.append(
        (
            "h2",
            "कार्य अनुभव"
            if hindi
            else r.choice(["Experience", "Work Experience", "Professional Experience"]),
        )
    )
    start = 2026 - months // 12
    out.append(
        (
            "p",
            r.choice(
                [
                    f"{employer} | {title} | {start} – Present",
                    f"{title}, {employer} ({start} - Present)",
                    f"{title} at {employer}, {start} to date",
                ]
            ),
        )
    )
    out.append(("p", "Worked on services, reviews and releases with the team."))
    out.append(("h2", "Education"))
    out.append(
        (
            "p",
            r.choice(
                [
                    "B.E. Computer Science, VTU",
                    "B.Tech, IIT Madras",
                    "MCA, Pune University",
                    "B.Sc, Delhi University",
                ]
            ),
        )
    )
    truth = {
        "name": name,
        "email": email,
        "phone": phone,
        "title": title,
        "employer": employer,
        "location": city or None,
        "experience_months": months,
        "skills": skills,
    }
    return out, truth


def _pdf(lines: list[tuple[str, str]]) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate

    buf = io.BytesIO()
    styles = getSampleStyleSheet()
    style = {"h1": styles["Title"], "h2": styles["Heading2"], "p": styles["Normal"]}
    story = [Paragraph(t.replace("&", "&amp;"), style[k]) for k, t in lines]
    SimpleDocTemplate(buf, pagesize=A4).build(story)
    return buf.getvalue()


def _docx(lines: list[tuple[str, str]]) -> bytes:
    import docx

    d = docx.Document()
    for k, t in lines:
        if k == "h1":
            d.add_heading(t, level=0)
        elif k == "h2":
            d.add_heading(t, level=1)
        else:
            d.add_paragraph(t)
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


def corpus(n: int = 200, seed: int = 2026) -> list[Sample]:
    r = random.Random(seed)  # noqa: S311 - test data, not security
    out = []
    for i in range(n):
        hindi = i % 10 == 9  # one in ten partly in Hindi
        lines, truth = _lines(r, hindi)
        fmt = "pdf" if i % 2 == 0 else "docx"
        data = _pdf(lines) if fmt == "pdf" else _docx(lines)
        out.append(Sample(f"cv-{i:03d}.{fmt}", fmt, data, truth, hindi))
    return out


def score(truth: dict[str, Any], got: dict[str, Any]) -> dict[str, bool]:
    """Per field: did the parser get it right? Skills count when 80% overlap."""
    res: dict[str, bool] = {}
    for k, want in truth.items():
        v = (got.get(k) or {}).get("value")
        if k == "skills":
            a = {s.lower() for s in want}
            b = {str(s).lower() for s in (v or [])}
            res[k] = bool(a) and len(a & b) / len(a | b) >= 0.8 if b else False
        elif want is None:
            res[k] = v in (None, "")
        elif isinstance(want, str):
            res[k] = isinstance(v, str) and v.strip().lower() == want.lower()
        else:
            res[k] = v == want
    return res
