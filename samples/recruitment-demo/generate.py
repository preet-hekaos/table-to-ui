"""Builds the recruitment demo data set: one CSV per table, named in import order.

Deterministic (fixed seed), so re-running gives the same files. Run:  python3 generate.py
Every cell uses the table's own field labels as headers, so Import maps columns by itself.
Linked records (client, candidate, requirement ...) are written as the target's title.
"""
import csv, random, datetime as dt, pathlib

R = random.Random(2610)
OUT = pathlib.Path(__file__).parent
TODAY = dt.date(2026, 10, 30)


def d(offset):
    return (TODAY + dt.timedelta(days=offset)).isoformat()


def write(name, header, rows):
    with open(OUT / name, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)
    print(f"{name}: {len(rows)} rows")


# ---------------------------------------------------------------- skills
SKILLS = {
    "Backend": ["Python", "Django", "FastAPI", "Java", "Spring Boot", "Node.js", "Go", "PostgreSQL", "Kafka", "Redis"],
    "Frontend": ["React", "TypeScript", "Next.js", "Tailwind", "GraphQL"],
    "Data": ["Spark", "Airflow", "SQL", "dbt", "Snowflake", "Power BI"],
    "Cloud and DevOps": ["AWS", "Kubernetes", "Terraform", "Docker", "CI/CD"],
    "Quality": ["Selenium", "Cypress", "API testing"],
    "Product and design": ["Product strategy", "Figma", "User research", "Roadmapping"],
    "Business": ["Enterprise sales", "Account management", "Talent acquisition", "Financial modelling"],
}
write("01-skills.csv", ["Name", "Category"], [[s, c] for c, ss in SKILLS.items() for s in ss])

# ---------------------------------------------------------------- clients
CLIENTS = [
    # name, status, industry, city, site, fee%, min fee, pay days, notes
    ("Northwind Systems", "Active", "SaaS", "Bengaluru", "https://northwind.example.com", 8.33, 150000, 45, "Preferred vendor since 2024. Needs two shortlisted profiles within 5 working days."),
    ("Finverse Capital", "Active", "Fintech", "Mumbai", "https://finverse.example.com", 10, 250000, 30, "Strict on notice period (max 30 days). Background check before offer."),
    ("Medora Health", "Active", "Healthtech", "Hyderabad", "https://medora.example.com", 8.33, 120000, 60, "Hybrid roles, three days in office. Interviews on Tuesdays and Thursdays."),
    ("Kestrel Logistics", "Active", "Logistics", "Pune", "https://kestrel.example.com", 7.5, 100000, 45, "High-volume hiring. Prefers candidates from product companies."),
    ("Lumen Retail", "Active", "Retail", "Gurugram", "https://lumen.example.com", 8.33, 100000, 30, "Quarterly hiring plan; sends requirements on the first Monday."),
    ("Zenith Insurance", "Active", "Insurance", "Mumbai", "https://zenith.example.com", 9, 200000, 60, "Compliance-heavy. All offers need HR sign-off."),
    ("Atlas Manufacturing", "On hold", "Manufacturing", "Chennai", "https://atlas.example.com", 8, 100000, 45, "Hiring freeze until January. Keep warm."),
    ("Brightpath Education", "Prospect", "Edtech", "Noida", "https://brightpath.example.com", 8.33, 100000, 30, "Intro call held. Waiting for their budget approval."),
]
write("02-clients.csv", ["Name", "Status", "Industry", "City", "Website", "Fee (% of annual CTC)", "Minimum fee", "Payment terms (days)", "Terms and notes"], [list(c) for c in CLIENTS])
CL = {c[0]: c for c in CLIENTS}

# ---------------------------------------------------------------- contacts
CONTACTS = [
    ("Rhea Kapoor", "Northwind Systems", "Head of Engineering", "rhea.kapoor@northwind.example.com", "+91 98450 21001", "yes"),
    ("Sanjay Menon", "Northwind Systems", "Talent Partner", "sanjay.menon@northwind.example.com", "+91 98450 21002", "no"),
    ("Priya Iyer", "Finverse Capital", "VP, Technology", "priya.iyer@finverse.example.com", "+91 98200 22001", "yes"),
    ("Arjun Bhatt", "Finverse Capital", "HR Business Partner", "arjun.bhatt@finverse.example.com", "+91 98200 22002", "no"),
    ("Dr. Nisha Reddy", "Medora Health", "Chief Product Officer", "nisha.reddy@medora.example.com", "+91 99890 23001", "yes"),
    ("Vivek Joshi", "Kestrel Logistics", "Engineering Manager", "vivek.joshi@kestrel.example.com", "+91 98220 24001", "yes"),
    ("Meenal Kulkarni", "Kestrel Logistics", "HR Lead", "meenal.kulkarni@kestrel.example.com", "+91 98220 24002", "no"),
    ("Karan Malhotra", "Lumen Retail", "Director, Digital", "karan.malhotra@lumen.example.com", "+91 98100 25001", "yes"),
    ("Ishita Sen", "Zenith Insurance", "Head of Data", "ishita.sen@zenith.example.com", "+91 98330 26001", "yes"),
    ("Rajiv Nambiar", "Atlas Manufacturing", "Plant IT Head", "rajiv.nambiar@atlas.example.com", "+91 94440 27001", "yes"),
    ("Aditi Verma", "Brightpath Education", "Co-founder", "aditi.verma@brightpath.example.com", "+91 98110 28001", "yes"),
]
write("03-contacts.csv", ["Name", "Client", "Designation", "Email", "Phone", "Primary contact"], [list(c) for c in CONTACTS])

# ---------------------------------------------------------------- requirements
# title, client, contact, status, positions, filled, skills, location, minexp(m), maxexp(m), notice, budget min, max, target offset, brief, family
REQS = [
    ("Senior Backend Engineer", "Northwind Systems", "Rhea Kapoor", "Open", 2, 0, "Python, FastAPI, PostgreSQL, AWS", "Bengaluru", 60, 120, 60, 2400000, 3600000, 21, "Own the billing and metering services. Design APIs, mentor two mid-level engineers, be on the on-call rota.", "Backend"),
    ("Staff Frontend Engineer", "Northwind Systems", "Sanjay Menon", "Open", 1, 0, "React, TypeScript, Next.js", "Bengaluru", 84, 150, 60, 3000000, 4500000, 30, "Lead the design-system rebuild and the move to Next.js. Strong accessibility background.", "Frontend"),
    ("Lead Data Engineer", "Finverse Capital", "Priya Iyer", "Open", 1, 0, "Spark, Airflow, SQL, Snowflake", "Mumbai", 72, 132, 30, 3200000, 4800000, 14, "Build the risk-data platform. Batch and streaming, regulatory reporting, PII controls.", "Data"),
    ("Backend Engineer, Payments", "Finverse Capital", "Arjun Bhatt", "Open", 3, 1, "Java, Spring Boot, Kafka", "Mumbai", 48, 96, 30, 1800000, 2800000, 25, "Payments switch team. Idempotency, ledgers, reconciliation. Experience with card or UPI rails preferred.", "Backend"),
    ("Product Manager, Clinical Workflows", "Medora Health", "Dr. Nisha Reddy", "Open", 1, 0, "Product strategy, Roadmapping, User research", "Hyderabad", 72, 120, 45, 3000000, 4200000, 40, "Own the clinician-facing scheduling and charting experience. Healthcare domain a strong plus.", "Product"),
    ("Senior QA Automation Engineer", "Medora Health", "Dr. Nisha Reddy", "Open", 2, 0, "Selenium, Cypress, API testing", "Hyderabad", 60, 108, 45, 1600000, 2400000, 28, "Build the regression suite for the patient app and the lab integrations.", "Quality"),
    ("DevOps Engineer", "Kestrel Logistics", "Vivek Joshi", "Open", 2, 0, "AWS, Kubernetes, Terraform, CI/CD", "Pune", 48, 96, 45, 1800000, 2800000, 18, "Run fleet-tracking infrastructure across two regions. Cost and reliability focus.", "DevOps"),
    ("Full Stack Engineer", "Kestrel Logistics", "Meenal Kulkarni", "Open", 3, 0, "React, Node.js, PostgreSQL", "Pune", 36, 84, 45, 1400000, 2200000, 35, "Dispatcher console and driver app backend. High-volume, real-time updates.", "Frontend"),
    ("Senior Data Analyst", "Lumen Retail", "Karan Malhotra", "Open", 1, 0, "SQL, Power BI, dbt", "Gurugram", 48, 90, 30, 1500000, 2300000, 20, "Merchandising and pricing analytics. Weekly stakeholder reviews with category heads.", "Data"),
    ("Machine Learning Engineer", "Zenith Insurance", "Ishita Sen", "Open", 1, 0, "Python, Spark, Airflow", "Mumbai", 48, 96, 60, 2400000, 3800000, 45, "Claims-triage models. Work with actuarial and compliance teams on explainability.", "Data"),
    ("Engineering Manager", "Northwind Systems", "Rhea Kapoor", "On hold", 1, 0, "Python, Kafka, Roadmapping", "Bengaluru", 108, 168, 90, 5000000, 7000000, 60, "Paused while the org design is finalised. Resume in November.", "Backend"),
    ("Site Reliability Engineer", "Finverse Capital", "Priya Iyer", "Filled", 1, 1, "Kubernetes, Terraform, AWS", "Mumbai", 60, 108, 30, 2400000, 3400000, -20, "Filled in October.", "DevOps"),
    ("UX Designer", "Lumen Retail", "Karan Malhotra", "Filled", 1, 1, "Figma, User research", "Gurugram", 48, 96, 30, 1500000, 2300000, -35, "Filled in September.", "Product"),
    ("Account Executive, Enterprise", "Zenith Insurance", "Ishita Sen", "Closed", 1, 0, "Enterprise sales, Account management", "Mumbai", 60, 120, 60, 2000000, 3000000, -50, "Closed by the client: role merged into an internal opening.", "Business"),
]
write("04-requirements.csv",
      ["Title", "Client", "Client contact", "Status", "Positions", "Filled", "Skills", "Location", "Minimum experience", "Maximum experience",
       "Maximum notice (days)", "Budget from", "Budget up to", "Target date", "Opened on", "Filled on", "Brief"],
      [[r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[11], r[12], d(r[13]),
        d(r[13] - 45 - 3 * i), d(r[13] + 30 - 3 * i) if r[3] == "Filled" else "", r[14]] for i, r in enumerate(REQS)])
REQD = {r[0]: r for r in REQS}

# ---------------------------------------------------------------- candidates
FIRST_M = ["Aarav", "Vikram", "Kabir", "Rohan", "Arnav", "Siddharth", "Nikhil", "Rahul", "Aditya", "Karthik", "Varun", "Harsh", "Manish", "Tarun", "Pranav", "Imran", "Deepak", "Gaurav", "Suresh", "Ankit", "Yash", "Mohit", "Akash", "Sandeep", "Rakesh"]
FIRST_F = ["Meera", "Ananya", "Diya", "Sneha", "Kavya", "Pooja", "Neha", "Riya", "Ishaan", "Shreya", "Tanvi", "Aditi", "Lakshmi", "Divya", "Sana", "Nandini", "Swati", "Pallavi", "Rashmi", "Jyoti", "Fatima", "Anjali", "Bhavna", "Mitali", "Radhika"]
LAST = ["Shah", "Nair", "Rao", "Desai", "Iyer", "Gupta", "Mehta", "Singh", "Patel", "Reddy", "Kulkarni", "Menon", "Joshi", "Chopra", "Bose", "Das", "Pillai", "Khan", "Sharma", "Verma", "Agarwal", "Banerjee", "Naidu", "Thakur", "Saxena", "Mishra", "Kapoor", "Hegde", "Bhatt", "Chatterjee"]
FAMILIES = {
    "Backend": (["Backend Engineer", "Senior Backend Engineer", "Software Engineer II", "Java Developer", "Platform Engineer"], ["Python", "Django", "FastAPI", "PostgreSQL", "AWS", "Java", "Spring Boot", "Kafka", "Redis", "Go", "Node.js"]),
    "Frontend": (["Frontend Engineer", "Senior Frontend Engineer", "Full Stack Engineer", "UI Engineer"], ["React", "TypeScript", "Next.js", "Tailwind", "GraphQL", "Node.js", "PostgreSQL"]),
    "Data": (["Data Engineer", "Senior Data Analyst", "Analytics Engineer", "ML Engineer"], ["Spark", "Airflow", "SQL", "dbt", "Snowflake", "Power BI", "Python"]),
    "DevOps": (["DevOps Engineer", "Site Reliability Engineer", "Cloud Engineer"], ["AWS", "Kubernetes", "Terraform", "Docker", "CI/CD"]),
    "Quality": (["QA Engineer", "SDET", "Senior QA Automation Engineer"], ["Selenium", "Cypress", "API testing", "CI/CD"]),
    "Product": (["Product Manager", "Senior Product Manager", "UX Designer", "Product Designer"], ["Product strategy", "Roadmapping", "Figma", "User research"]),
    "Business": (["Account Executive", "Senior Account Manager", "Talent Acquisition Lead"], ["Enterprise sales", "Account management", "Talent acquisition"]),
}
EMPLOYERS = ["Infosys", "TCS", "Wipro", "Flipkart", "Razorpay", "Swiggy", "Zoho", "Freshworks", "PhonePe", "Cred", "Paytm", "Ola", "Myntra", "Meesho", "Zomato", "HCL Technologies", "Tech Mahindra", "Cognizant", "Capgemini", "ThoughtWorks", "Mindtree", "Persistent Systems", "Nykaa", "Dunzo", "Practo"]
CITIES = ["Bengaluru", "Bengaluru", "Bengaluru", "Hyderabad", "Pune", "Mumbai", "Gurugram", "Chennai", "Noida", "Hyderabad", "Pune", "Mumbai"]
SOURCES = ["LinkedIn"] * 4 + ["Job board"] * 3 + ["Referral"] * 3 + ["Walk-in", "Import", "Other"]

# Family mix: 60 candidates
mix = ["Backend"] * 16 + ["Frontend"] * 11 + ["Data"] * 12 + ["DevOps"] * 7 + ["Quality"] * 6 + ["Product"] * 5 + ["Business"] * 3
R.shuffle(mix)
names, used = [], set()
while len(names) < 60:
    n = f"{R.choice(FIRST_M + FIRST_F)} {R.choice(LAST)}"
    if n not in used:
        used.add(n); names.append(n)
# fixed leading names so the headline demo records read naturally
FIXED = ["Aarav Shah", "Meera Nair", "Kabir Rao", "Vikram Desai"]
for i, n in enumerate(FIXED):
    if n in names:
        names.remove(n)
    names.insert(i, n)
names = names[:60]
mix[0], mix[1], mix[2], mix[3] = "Backend", "Backend", "Backend", "Data"

CANDS = []
for i, (name, fam) in enumerate(zip(names, mix)):
    titles, pool = FAMILIES[fam]
    exp = R.choice([30, 42, 54, 60, 72, 84, 96, 108, 120, 144])
    title = titles[min(len(titles) - 1, exp // 48)] if fam != "Business" else R.choice(titles)
    skills = ", ".join(R.sample(pool, min(len(pool), R.randint(3, 5))))
    ctc = int((6 + exp / 12 * R.uniform(1.6, 2.6)) * 100000 / 5000) * 5000
    exp_ctc = int(ctc * R.uniform(1.15, 1.4) / 5000) * 5000
    notice = R.choice([0, 15, 30, 30, 45, 60, 60, 90])
    first, last = name.split(" ", 1)
    email = f"{first.lower()}.{last.lower()}{R.randint(1, 99) if i > 3 else ''}@example.in".replace(" ", "")
    phone = f"+91 9{R.randint(1000, 9999)} {R.randint(10000, 99999)}"
    CANDS.append(dict(name=name, email=email, phone=phone, title=title, employer=R.choice(EMPLOYERS), loc=R.choice(CITIES),
                      notice=notice, status="Active", skills=skills, exp=exp, source=R.choice(SOURCES), ctc=ctc, ectc=exp_ctc, fam=fam))
C = {c["name"]: c for c in CANDS}
# two near-duplicates, for the Duplicate candidates screen: same person, new email and phone
dup_src = C["Aarav Shah"]
CANDS.append({**dup_src, "email": "aarav.shah.work@example.in", "phone": "+91 98450 77012", "source": "Walk-in", "ctc": dup_src["ctc"] + 100000})
dup2 = CANDS[7]
CANDS.append({**dup2, "name": dup2["name"].replace(" ", "  ", 1).title(), "email": "alt." + dup2["email"], "phone": "+91 98860 12345", "source": "Import"})
# fix the last one's name to be a plain near-match (same name, different case)
CANDS[-1]["name"] = dup2["name"].upper()
for c in CANDS[-8:-2]:
    c["status"] = "Archived"
for c in CANDS[:4]:
    c["notice"] = 30
CANDS[0].update(current_title="Senior Backend Engineer", skills="Python, FastAPI, PostgreSQL, AWS, Kafka", exp=84, notice=30)
CANDS[0].update(title="Senior Backend Engineer", ctc=2600000, ectc=3300000, employer="Razorpay", loc="Bengaluru")
# ---------------------------------------------------------------- submissions
FAM_OF_REQ = {r[0]: r[15] for r in REQS}
POOL = {fam: [c for c in CANDS[:60] if c["fam"] == fam and c["status"] == "Active"] for fam in FAMILIES}
STAGES_OPEN = ["Sourced", "Sourced", "Screened", "Screened", "Submitted", "Submitted", "Client shortlisted", "Client shortlisted", "Interview", "Interview", "Offer", "Rejected", "Rejected", "Withdrawn", "On hold"]
REASONS = ["Skills mismatch", "Pay mismatch", "Notice too long", "Client declined", "Candidate withdrew"]
FEEDBACK = ["Strong fundamentals; wants to see a system-design round.", "Good communicator, a little light on production experience.", "Team liked the take-home. Moving to panel.", "Pay expectations are at the top of the range.", "Impressive depth on distributed systems."]
SUBS = []  # dicts
used_pairs = set()
for req in REQS:
    title, client, contact, status, pos, filled = req[:6]
    fam = req[15]
    pool = POOL.get(fam, [])[:]
    R.shuffle(pool)
    if status == "Open":
        count = R.randint(5, 8)
        stages = R.sample(STAGES_OPEN, k=min(count, len(STAGES_OPEN)))
    elif status == "On hold":
        count, stages = 2, ["Screened", "On hold"]
    elif status == "Filled":
        count, stages = 3, ["Placed", "Rejected", "Withdrawn"]
    else:
        count, stages = 2, ["Rejected", "Withdrawn"]
    if title == "Backend Engineer, Payments":
        stages = ["Placed", "Interview", "Submitted", "Offer", "Screened", "Sourced"]
        count = 6
    for cand, stage in zip(pool[:count], stages):
        if (cand["name"], title) in used_pairs:
            continue
        used_pairs.add((cand["name"], title))
        SUBS.append(dict(cand=cand, req=req, stage=stage))
# make sure the headline records exist
for name, rtitle, stage in [("Aarav Shah", "Senior Backend Engineer", "Sourced"), ("Meera Nair", "Senior Backend Engineer", "Screened")]:
    if (name, rtitle) not in used_pairs:
        used_pairs.add((name, rtitle)); SUBS.append(dict(cand=C[name], req=REQD[rtitle], stage=stage))
    else:
        for s in SUBS:
            if s["cand"]["name"] == name and s["req"][0] == rtitle:
                s["stage"] = stage

rows, SUBNAME = [], {}
for i, s in enumerate(SUBS):
    c, r, stage = s["cand"], s["req"], s["stage"]
    summary = f"{c['name']} for {r[0]}"
    SUBNAME[id(s)] = summary
    s["summary"] = summary
    when = d(-R.randint(2, 40))
    submitted_on = when if stage in ("Submitted", "Client shortlisted", "Interview", "Offer", "Placed") else ""
    contact = r[2] if stage in ("Submitted", "Client shortlisted", "Interview", "Offer", "Placed") else ""
    reason = R.choice(REASONS) if stage == "Rejected" else ""
    fb = R.choice(FEEDBACK) if stage in ("Client shortlisted", "Interview", "Offer", "Placed") else ""
    note = R.choice(["", "", "Referred by a current team member.", "Open to relocation.", "Counter-offer risk: current employer is retaining.", "Prefers hybrid."])
    s["submitted_on"] = submitted_on
    rows.append([summary, c["name"], r[0], stage, contact, submitted_on, reason, fb, note])
write("08-submissions.csv", ["Summary", "Candidate", "Requirement", "Stage", "Client contact", "Submitted on", "Reason for rejection", "Client feedback", "Note"], rows)

# ---------------------------------------------------------------- consent (must be imported before submissions)
cons = []
shared = {s["cand"]["name"] for s in SUBS if s["stage"] in ("Submitted", "Client shortlisted", "Interview", "Offer", "Placed")}
for c in CANDS[:60]:
    cons.append([c["name"], "Store profile", "Given", d(-R.randint(30, 200))])
    if c["name"] in shared:
        cons.append([c["name"], "Share with clients", "Given", d(-R.randint(5, 60))])
    elif R.random() < 0.25:
        cons.append([c["name"], "Contact for new roles", R.choice(["Given", "Withdrawn"]), d(-R.randint(5, 90))])
write("06-consent-records.csv", ["Candidate", "Purpose", "Status", "Date"], cons)
# candidates sharing the same name (the near-duplicates) would collide on lookup; keep the originals only
# ---------------------------------------------------------------- interviews
iv = []
TODAY_N = 0
for s in SUBS:
    st = s["stage"]
    if st not in ("Interview", "Offer", "Placed", "Rejected"):
        continue
    if st == "Rejected" and R.random() < 0.6:
        continue
    c, r = s["cand"], s["req"]
    rounds = 2 if st in ("Offer", "Placed") else 1
    for rd in range(1, rounds + 1):
        past = st in ("Offer", "Placed", "Rejected") or rd < rounds
        status = "Done" if past else R.choice(["Scheduled", "Scheduled", "Done"])
        outcome = ""
        if status == "Done":
            outcome = "Fail" if st == "Rejected" else ("Pass" if (st in ("Offer", "Placed") or rd < rounds) else R.choice(["Pass", ""]))
        label = ["Technical round", "Panel with hiring manager"][rd - 1] if rounds == 2 else R.choice(["Technical round", "System design", "Managerial round"])
        when = d(-R.randint(3, 25)) if status == "Done" else d(R.randint(0, 9))
        if status == "Scheduled" and TODAY_N < 3:
            when, TODAY_N = d(0), TODAY_N + 1  # a few interviews happen today, so the Home card has something to show
        fb = {"Pass": "Clear thinker, strong on trade-offs. Recommend moving ahead.", "Fail": "Struggled with fundamentals under time pressure.", "": ""}[outcome] if status == "Done" else ""
        mode = R.choice(["Video", "Video", "Phone", "In person"])
        link = f"https://meet.example.com/{R.randint(100, 999)}-{R.randint(1000, 9999)}" if mode == "Video" else ""
        iv.append([f"{label}: {s['summary']}", s["summary"], when, f"{R.choice([10, 11, 12, 14, 15, 16])}:{R.choice(['00', '30'])}", link, mode, status, fb, outcome, R.choice(["Panel of 2", "Hiring manager + lead", "Engineering director"])])
write("09-interviews.csv", ["Summary", "Submission", "Scheduled on", "Time", "Meeting link", "Mode", "Status", "Feedback", "Outcome", "Panel (client side)"], iv)
# interview summaries must be unique-ish for readability; duplicates across rounds are prefixed by round name

# ---------------------------------------------------------------- offers
off, pls = [], []
n_decl = 0
for s in SUBS:
    st, c, r = s["stage"], s["cand"], s["req"]
    if st not in ("Offer", "Placed"):
        continue
    ctc = min(r[12], int(c["ectc"] / 5000) * 5000)
    ctc = max(ctc, r[11])
    if st == "Placed":
        off.append([f"Offer: {s['summary']}", s["summary"], ctc, d(-R.randint(2, 20)), "Accepted", d(-R.randint(25, 45)), ""])
        client = CL[r[1]]
        fee = max(int(ctc * client[5] / 100), client[6])
        pls.append([f"Placement: {s['summary']}", c["name"], r[1], r[0], s["summary"], d(-R.randint(2, 20)), ctc, fee, "Joined"])
    else:
        status = ["Sent", "Draft", "Sent"][len(off) % 3]
        off.append([f"Offer: {s['summary']}", s["summary"], ctc, d(R.randint(10, 35)), status, d(-R.randint(1, 6)) if status == "Sent" else "", ""])
write("10-offers.csv", ["Summary", "Submission", "Annual CTC", "Joining date", "Status", "Sent on", "Reason for declining"], off)
write("11-placements.csv", ["Summary", "Candidate", "Client", "Requirement", "Submission", "Start date", "Annual CTC", "Fee", "Status"], pls)

# ---------------------------------------------------------------- tasks
active = [s for s in SUBS if s["stage"] not in ("Rejected", "Withdrawn", "Placed")]
TASKS = [
    ("Call {c} about the {r} role", -3, "Open"), ("Send {c}'s profile to {cl}", -1, "Open"), ("Collect updated CV from {c}", 0, "Open"),
    ("Confirm interview slot with {c}", 1, "Open"), ("Share interview feedback with {c}", 2, "Open"), ("Check notice-period buy-out with {c}", 4, "Open"),
    ("Follow up with {cl} on {r}", 6, "Open"), ("Prepare {c} for the panel round", 3, "Open"), ("Reference check for {c}", 7, "Open"),
    ("Send intro email to {c}", -6, "Done"), ("Screening call with {c}", -4, "Done"), ("Verify consent for {c}", -9, "Done"),
]
tk = []
for i, (t, off_, st) in enumerate(TASKS * 2):
    s = active[(i * 3) % len(active)]
    tk.append([t.format(c=s["cand"]["name"], r=s["req"][0], cl=s["req"][1]), st, d(off_ + R.randint(0, 2)), s["cand"]["name"], s["req"][0]])
write("12-tasks.csv", ["Title", "Status", "Due date", "Candidate", "Requirement"], tk)

# ---------------------------------------------------------------- interactions
KIND_TXT = {
    "Call": ["Intro call: walked through the role and pay range.", "Catch-up call on the interview outcome.", "Notice-period discussion."],
    "Email": ["Sent the JD and the company overview.", "Shared the shortlist with feedback requested.", "Sent revised pay breakup."],
    "Meeting": ["Weekly pipeline review.", "On-site visit to meet the hiring team.", "Quarterly business review."],
    "WhatsApp": ["Confirmed the interview time.", "Quick check-in; candidate is still interested.", "Sent the location pin for the office."],
    "Note": ["Candidate is considering a counter-offer.", "Client prefers product-company backgrounds.", "Budget may stretch by 10% for the right profile."],
}
ia = []
for i in range(36):
    kind = R.choice(list(KIND_TXT))
    txt = R.choice(KIND_TXT[kind])
    if i % 3 == 0:
        cl = R.choice([c for c in CLIENTS if c[1] != "Prospect"])[0]
        ia.append([f"{kind}: {cl}", kind, "", cl, d(-R.randint(0, 40)), txt])
    else:
        s = R.choice(SUBS)
        ia.append([f"{kind} with {s['cand']['name']}", kind, s["cand"]["name"], "", d(-R.randint(0, 40)), txt])
write("13-interactions.csv", ["Summary", "Kind", "Candidate", "Client", "Date", "Details"], ia)
for s_ in SUBS:
    if s_["stage"] == "Placed":
        s_["cand"]["status"] = "Placed"
write("05-candidates.csv",
      ["Full name", "Email", "Phone", "Current title", "Current employer", "Location", "Notice period (days)", "Status", "Skills", "Total experience", "Source", "Current CTC", "Expected CTC"],
      [[c["name"], c["email"], c["phone"], c["title"], c["employer"], c["loc"], c["notice"], c["status"], c["skills"], c["exp"], c["source"], c["ctc"], c["ectc"]] for c in CANDS])

print("done")
