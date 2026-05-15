#!/usr/bin/env python3
from __future__ import annotations

import csv
import re
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "content-calendar" / "ten80ten-2026-social-calendar"

BRAND_PRIMARY = "#1B1713"  # Core Charcoal
BRAND_ACCENT = "#FF6426"  # Hourglass Orange
BRAND_SECONDARY = "#F7F2E8"  # Warm Cream
BRAND_GOLD = "#C9BC72"  # Delegation Gold
BRAND_SILVER = "#B8B7B2"  # Protected Silver
BRAND_GRAPHITE = "#2C2925"  # Soft Graphite

BANNED = [
    "unlock",
    "elevate",
    "leverage",
    "harness",
    "in today's fast-paced world",
    "game-changer",
    "revolutionize",
    "empower",
    "boost your productivity",
    "take your business to the next level",
    "skyrocket",
    "supercharge",
    "embark on a journey",
    "in conclusion",
    "navigate the landscape",
    "robust solution",
    "seamless",
    "delve",
    "tapestry",
    "underscores",
    "moreover",
    "furthermore",
    "it's important to note",
]

OFF_BRAND_PROMPT_PATTERNS = [
    r"\bteal\b",
    r"\bnavy\b",
    "#0E2A47",
    "#1FB8C9",
    "#F5F1EA",
    "random gradients",
    "glitter",
]

MONTH_THEMES = {
    5: "The first handoff: make delegation feel safe, useful, and ready within 30 days.",
    6: "Time back by design: show the 10/80/10 Framework as a calm operating advantage.",
    7: "Capacity without drag: cost clarity, founder boundaries, and cleaner execution.",
    8: "Back-to-school for operators: working parents, ready support, and better first 30 days.",
    9: "Trusted global talent: culture, labor, and managed fit without low-value staffing cues.",
    10: "Operational calm: secure handoffs, login control, and mental load made visible.",
    11: "Founder operating season: entrepreneurship, holiday demand, and steadier follow-up.",
    12: "Close the year clean: apps, gratitude, reviews, and a smarter 2027 support map.",
}

PILLAR_DEFS = {
    "A": "The 10/80/10 Playbook, tactical delegation systems for recurring work.",
    "B": "Founder Reality, specific truths about admin, attention, and late-night work.",
    "C": "Talent Spotlight, humanizing the craft of virtual assistants and remote operators.",
    "D": "ROI Math + Proof, commercial posts grounded in costs, risk, and repeatable outcomes.",
    "E": "Cultural Moments + Holidays, US observances tied back to delegation and work-life balance.",
}

SOURCES_NOTE = """Competitive scan summary used for this plan:
- [BELAY LinkedIn](https://www.linkedin.com/company/belay-solutions): premium U.S.-based support, frequent LinkedIn thought leadership, polished corporate graphics.
- [MyOutDesk site](https://www.myoutdesk.com/) and [LinkedIn](https://my.linkedin.com/company/myoutdesk/): vertical staffing and ROI claims, especially real estate, healthcare, finance, and marketing.
- [Magic LinkedIn](https://www.linkedin.com/company/get-magic) and [site](https://getmagic.com/): AI-assisted assistant positioning, short pain-point posts, modern minimal style.
- [Wing Assistant LinkedIn](https://www.linkedin.com/company/wingassistant): frequent LinkedIn case-style posts with workflow ownership and vertical use cases.
- [Boldly LinkedIn](https://www.linkedin.com/company/workboldly): warm premium EA matching, culture, women-led and flexible-work storytelling.
- [Athena LinkedIn](https://www.linkedin.com/company/athenago/): talent-side aspiration, EA craft, CEO proximity, and cinematic people-led posts.
- [Time Etc LinkedIn](https://www.linkedin.com/company/time-etc-limited): founder overwhelm, task audits, and practical consultation CTAs.
- [Prialto LinkedIn](https://www.linkedin.com/company/prialto): SOPs, process documentation, managed service, and AI plus human judgment.
- [Virtual Latinos LinkedIn](https://www.linkedin.com/company/virtuallatinos): LATAM talent, community, remote jobs, and vetting.
- [OnlineJobs.ph LinkedIn](https://www.linkedin.com/company/onlinejobs-ph), [TaskBullet site](https://taskbullet.com/), and [Zirtual site](https://www.zirtual.com/virtual-assistants/): value-tier pricing, direct hiring, flexible hour buckets, and marketplace scale.
"""

HASHTAG_SETS = [
    {
        "LI": "#Ten80Ten #VirtualAssistants #Delegation #FounderOps #RemoteTeams",
        "IG": "#Ten80Ten #VirtualAssistant #FounderLife #Delegation #RemoteTeam #SmallBusinessOwner #OpsLife #AdminSupport #StartupOps #WorkLifeBalance #GlobalTalent #ContentEngine",
        "FB": "#Ten80Ten #SmallBusiness #Delegation #RemoteWork #FounderLife",
        "TT": "#Ten80Ten #FounderLife #Delegation #RemoteWork",
    },
    {
        "LI": "#Ten80Ten #Operations #SmallBusiness #RemoteTalent #FounderLife",
        "IG": "#Ten80Ten #Operations #SmallBusinessOwner #RemoteTalent #FounderTips #BusinessSystems #VirtualAssistantLife #DelegationTips #AdminHelp #TeamOps #WorkSmarter #Ten80TenContentEngine",
        "FB": "#Ten80Ten #Operations #SmallBusinessOwner #RemoteTalent #AdminHelp",
        "TT": "#OpsTok #SmallBusiness #VirtualAssistant #Ten80Ten",
    },
    {
        "LI": "#Ten80Ten #GlobalTalent #RemoteHiring #FounderSupport #BusinessSystems",
        "IG": "#Ten80Ten #GlobalTalent #RemoteHiring #VirtualAssistant #FounderSupport #BusinessSystems #WorkFromHomeTeam #RemoteOps #AdminSystems #HiringHelp #SMBOps #Delegation",
        "FB": "#Ten80Ten #GlobalTalent #RemoteHiring #FounderSupport #BusinessSystems",
        "TT": "#RemoteHiring #GlobalTalent #FounderTok #Ten80Ten",
    },
    {
        "LI": "#Ten80Ten #ContentEngine #SMBMarketing #LinkedInGrowth #VirtualAssistant",
        "IG": "#Ten80Ten #ContentEngine #SMBMarketing #LinkedInGrowth #VirtualAssistant #MarketingOps #ContentOps #FounderMarketing #SocialMediaOps #RemoteSupport #BusinessOwner #Delegation",
        "FB": "#Ten80Ten #ContentEngine #SMBMarketing #LinkedInGrowth #RemoteSupport",
        "TT": "#ContentOps #LinkedInGrowth #VirtualAssistant #Ten80Ten",
    },
    {
        "LI": "#Ten80Ten #FinanceOps #LegalOps #HealthcareOps #RemoteTeams",
        "IG": "#Ten80Ten #FinanceOps #LegalOps #HealthcareOps #RemoteTeams #AdminOps #BackOffice #VirtualAssistant #BusinessSupport #ClientOps #FounderOps #GlobalWork",
        "FB": "#Ten80Ten #FinanceOps #LegalOps #HealthcareOps #RemoteTeams",
        "TT": "#BackOffice #RemoteTeams #VirtualAssistant #Ten80Ten",
    },
]

WORKFLOWS = [
    {
        "name": "inbox triage",
        "asset": "7-minute Loom",
        "tasks": "newsletter sorting, vendor replies, calendar holds, and client flags",
        "tools": "Gmail, Loom, and a shared Asana board",
        "review": "the 9-message exception list",
        "backlog": 47,
        "noun": "Gmail label",
        "industry": "founder operations",
    },
    {
        "name": "real estate listing prep",
        "asset": "one listing checklist",
        "tasks": "MLS notes, photographer scheduling, showing windows, and seller reminders",
        "tools": "Follow Up Boss, Google Drive, and a shared Notion checklist",
        "review": "the 12-line listing packet",
        "backlog": 22,
        "noun": "MLS packet",
        "industry": "real estate",
    },
    {
        "name": "month-end close",
        "asset": "screen recording of the close checklist",
        "tasks": "receipt chasing, invoice matching, vendor follow-ups, and folder cleanup",
        "tools": "QuickBooks, Google Drive, and a reconciliation spreadsheet",
        "review": "the 6-account variance note",
        "backlog": 38,
        "noun": "QuickBooks report",
        "industry": "finance and accounting",
    },
    {
        "name": "legal intake",
        "asset": "call rubric and intake script",
        "tasks": "form checks, conflict notes, appointment holds, and document requests",
        "tools": "Clio, Calendly, and a secure intake folder",
        "review": "the 5-client priority list",
        "backlog": 31,
        "noun": "Clio matter",
        "industry": "legal",
    },
    {
        "name": "e-commerce returns",
        "asset": "refund decision tree",
        "tasks": "return approvals, Shopify tags, carrier claims, and customer updates",
        "tools": "Shopify, Gorgias, and a returns tracker",
        "review": "the 14-order exception sheet",
        "backlog": 64,
        "noun": "Shopify order",
        "industry": "e-commerce",
    },
    {
        "name": "medical scheduling",
        "asset": "front-desk escalation map",
        "tasks": "appointment confirmations, insurance reminders, no-show follow-ups, and chart prep",
        "tools": "EHR queue, RingCentral, and a shared call log",
        "review": "the 8-patient escalation list",
        "backlog": 29,
        "noun": "EHR queue",
        "industry": "healthcare",
    },
    {
        "name": "LinkedIn growth",
        "asset": "voice memo with 3 story angles",
        "tasks": "draft sorting, comment lists, lead note capture, and post scheduling",
        "tools": "LinkedIn, Notion, and a content calendar",
        "review": "the 4-post approval queue",
        "backlog": 18,
        "noun": "Notion board",
        "industry": "marketing",
    },
    {
        "name": "sales follow-up",
        "asset": "deal rule sheet",
        "tasks": "CRM notes, second-touch emails, meeting reminders, and proposal nudges",
        "tools": "HubSpot, Gmail, and a shared Slack channel",
        "review": "the 11-deal watch list",
        "backlog": 41,
        "noun": "HubSpot stage",
        "industry": "sales operations",
    },
]

PAINS = [
    ("Your calendar is lying.", "6 meetings", "Calendly tab", "You were busy all day and still did not move the thing that pays the bills."),
    ("You are the bottleneck.", "18 approvals", "Slack thread", "Everyone is waiting because the business learned to route small choices back to you."),
    ("The late reply counts.", "11:47 PM", "vendor email", "That tiny reply still steals the hour your family thought was theirs."),
    ("Busy is not ownership.", "9 browser tabs", "Chrome window", "A packed screen can hide the fact that no one owns the next step."),
    ("Sunday dread has receipts.", "23 unread notes", "yellow legal pad", "The dread usually has names, invoices, forms, and follow-ups attached to it."),
    ("Your desk knows first.", "4 coffee cups", "invoice folder", "The mess shows up on the desk before it shows up in the P&L."),
]

TALENT_ROLES = [
    ("finance VA", "a Filipino woman in her early 30s", "Quezon City home office", "invoice matching", "QuickBooks report", 16),
    ("legal intake VA", "a Latina woman in her late 20s", "Bogota coworking nook", "client intake checks", "Clio matter", 12),
    ("e-commerce VA", "an Indian man in his mid 30s", "Bengaluru apartment workspace", "returns tracking", "Shopify order", 27),
    ("marketing VA", "a South African woman in her late 30s", "Cape Town home office", "comment list cleanup", "LinkedIn draft", 34),
    ("real estate operations VA", "a Pakistani man in his late 20s", "Lahore studio office", "listing packet prep", "MLS checklist", 19),
    ("medical scheduling VA", "a Filipino man in his early 30s", "Cebu home office", "appointment confirmation", "EHR queue", 21),
]

WORKFLOW_LABELS = {
    "inbox triage": "Inbox triage",
    "real estate listing prep": "Listing prep",
    "month-end close": "Month-end close",
    "legal intake": "Legal intake",
    "e-commerce returns": "Returns cleanup",
    "medical scheduling": "Medical scheduling",
    "LinkedIn growth": "LinkedIn growth",
    "sales follow-up": "Sales follow-up",
}

WORKFLOW_SHORT = {
    "inbox triage": "Inbox",
    "real estate listing prep": "Listings",
    "month-end close": "Close",
    "legal intake": "Intake",
    "e-commerce returns": "Returns",
    "medical scheduling": "Scheduling",
    "LinkedIn growth": "LinkedIn",
    "sales follow-up": "Follow-up",
}

A_HOOK_ENDINGS = [
    "needs a rule.",
    "belongs outside your head.",
    "starts with one Loom.",
    "needs a Friday review.",
    "breaks without an owner.",
    "gets cleaner in Asana.",
    "should survive Monday.",
    "needs fewer pings.",
    "gets the 10/80/10.",
    "needs one clean queue.",
    "works when written.",
    "should leave your desk.",
]

B_SUBJECTS = [
    ("The calendar", "is", "6 meetings", "Calendly tab"),
    ("The approvals", "are", "18 approvals", "Slack thread"),
    ("The late reply", "is", "11:47 PM", "vendor email"),
    ("The browser tabs", "are", "9 browser tabs", "Chrome window"),
    ("The Sunday notes", "are", "23 unread notes", "yellow legal pad"),
    ("The coffee cups", "are", "4 coffee cups", "invoice folder"),
]

B_HOOK_ENDINGS = [
    "not the job.",
    "stealing dinner.",
    "where time leaks.",
    "asking for an owner.",
    "not a badge.",
    "the warning sign.",
    "hiding unpaid work.",
    "keeping you stuck.",
    "too close to midnight.",
    "the operating tax.",
    "begging for a rule.",
    "showing the real cost.",
]

C_ROLE_LABELS = {
    "finance VA": "Finance VA",
    "legal intake VA": "Legal intake VA",
    "e-commerce VA": "E-commerce VA",
    "marketing VA": "Marketing VA",
    "real estate operations VA": "Real estate VA",
    "medical scheduling VA": "Medical scheduling VA",
}

C_HOOK_ENDINGS = [
    "catches the small leak.",
    "fixes the note trail.",
    "keeps the queue clean.",
    "turns checks into calm.",
    "spots the odd field.",
    "writes the useful update.",
    "makes Friday quieter.",
    "owns the follow-through.",
    "protects the next step.",
    "cleans the messy edge.",
    "notices what repeats.",
    "makes the board readable.",
    "carries the context forward.",
    "keeps clients unblocked.",
    "knows the exception list.",
    "makes details travel.",
]

D_HOOK_ENDINGS = [
    "costs more in fragments.",
    "has hidden hiring math.",
    "needs risk math.",
    "deserves a clean number.",
    "fails without ownership.",
    "has a review cost.",
    "gets expensive in Slack.",
    "should show up in rows.",
]

E_HOOK_ENDINGS = [
    "coverage needs names.",
    "work needs owners.",
    "queue needs coverage.",
    "cleanup needs receipts.",
    "pause needs a plan.",
    "follow-up needs rules.",
    "calendar needs a backup.",
    "handoff needs a timestamp.",
]

ANGLE_LINES = [
    "The failure mode is not laziness. It is a missing owner.",
    "The useful test is simple: could someone else move this by 80% before you look at it?",
    "The tiny mess is the signal. The system is asking for a name, a rule, and a review window.",
    "When the handoff is written, the founder stops being the default search bar.",
    "A clean queue is usually less glamorous than a big strategy deck. It is also what makes the week breathe.",
    "The goal is not to disappear from the work. The goal is to stop touching the part that repeats.",
    "A trained operator does not need your whole brain. They need the first 10% made plain.",
    "Friday review is where trust compounds: one note, one fix, one cleaner pass next week.",
]

EVENTS: dict[tuple[date, str], dict[str, str]] = {
    (date(2026, 5, 25), "AM"): {
        "name": "Memorial Day",
        "hook": "Some work can wait.",
        "angle": "founders can honor the day by giving the team a clean pause, not a surprise inbox cleanup",
    },
    (date(2026, 5, 27), "PM"): {
        "name": "The end of Mental Health Awareness Month",
        "hook": "The load has a receipt.",
        "angle": "mental load often hides inside tiny recurring decisions",
    },
    (date(2026, 5, 29), "AM"): {
        "name": "The Small Business Month wrap",
        "hook": "Small business needs systems.",
        "angle": "the strongest small companies stop making the founder the default owner",
    },
    (date(2026, 6, 1), "AM"): {
        "name": "Pride Month",
        "hook": "Respect shows up in systems.",
        "angle": "inclusive work is practical when expectations, pay, and communication are clear",
    },
    (date(2026, 6, 8), "PM"): {
        "name": "National Best Friends Day",
        "hook": "Your assistant is not backup.",
        "angle": "a trusted operator should be treated like a work partner, not a panic button",
    },
    (date(2026, 6, 20), "AM"): {
        "name": "Father's Day weekend",
        "hook": "Dad gets Sunday back.",
        "angle": "delegation protects the weekend before it protects the calendar",
    },
    (date(2026, 6, 20), "PM"): {
        "name": "Summer Solstice and National Selfie Day weekend",
        "hook": "Long days need limits.",
        "angle": "the longest day is a good moment to stop making work stretch forever",
    },
    (date(2026, 6, 26), "PM"): {
        "name": "National Take Your Dog to Work Day",
        "hook": "The dog noticed first.",
        "angle": "home-office interruptions are easier when admin has an owner",
    },
    (date(2026, 7, 4), "AM"): {
        "name": "Independence Day",
        "hook": "Independence from tiny tasks.",
        "angle": "freedom at work can be practical: fewer approvals, fewer pings, fewer founder-only chores",
    },
    (date(2026, 7, 6), "AM"): {
        "name": "The National Workaholics Day follow-up",
        "hook": "Workaholism wears a suit.",
        "angle": "the issue is not effort, it is a system that keeps rewarding founder overfunctioning",
    },
    (date(2026, 7, 15), "PM"): {
        "name": "National Hot Dog Day",
        "hook": "Keep the hot dog simple.",
        "angle": "some workflows need fewer toppings: one owner, one checklist, one review point",
    },
    (date(2026, 7, 17), "PM"): {
        "name": "World Emoji Day",
        "hook": "The emoji is not the update.",
        "angle": "remote work needs clear status notes, not vibes",
    },
    (date(2026, 7, 25), "AM"): {
        "name": "Parents' Day weekend",
        "hook": "Parents need cleaner handoffs.",
        "angle": "working parents do better when admin does not become a second shift",
    },
    (date(2026, 8, 15), "AM"): {
        "name": "National Relaxation Day",
        "hook": "Rest needs a handoff.",
        "angle": "real rest starts before the day off, with a written task owner",
    },
    (date(2026, 8, 17), "AM"): {
        "name": "Back-to-school season",
        "hook": "School forms meet founder forms.",
        "angle": "working parents need delegated admin at home and at work",
    },
    (date(2026, 8, 24), "PM"): {
        "name": "Back-to-school season",
        "hook": "The backpack has receipts.",
        "angle": "August shows founders which workflows have been living in their heads",
    },
    (date(2026, 8, 26), "AM"): {
        "name": "Women's Equality Day",
        "hook": "Equality needs operating room.",
        "angle": "women founders and operators need systems that stop admin from quietly landing on them",
    },
    (date(2026, 9, 1), "PM"): {
        "name": "Back-to-school season",
        "hook": "The school calendar wins.",
        "angle": "a shared family calendar and a shared work board solve different versions of the same problem",
    },
    (date(2026, 9, 7), "AM"): {
        "name": "Labor Day",
        "hook": "Labor deserves better design.",
        "angle": "good work design makes the right person own the right task",
    },
    (date(2026, 9, 11), "AM"): {
        "name": "Patriot Day",
        "hook": "Make room for quiet.",
        "angle": "some days call for restraint, clear coverage, and fewer performative posts",
    },
    (date(2026, 9, 15), "AM"): {
        "name": "Hispanic Heritage Month",
        "hook": "Culture is not a graphic.",
        "angle": "honor LATAM talent by naming craft, language skill, and client ownership clearly",
    },
    (date(2026, 9, 16), "PM"): {
        "name": "National Working Parents Day",
        "hook": "The second shift is real.",
        "angle": "delegation can give parents back the hour between dinner and bedtime",
    },
    (date(2026, 9, 29), "PM"): {
        "name": "National Coffee Day",
        "hook": "Coffee is not a system.",
        "angle": "the ritual helps, but the morning queue still needs an owner",
    },
    (date(2026, 10, 1), "AM"): {
        "name": "Cybersecurity Awareness Month",
        "hook": "Secure the handoff first.",
        "angle": "login management and access rules matter before the VA opens the first tab",
    },
    (date(2026, 10, 10), "AM"): {
        "name": "World Mental Health Day",
        "hook": "Mental load is operational.",
        "angle": "founder stress often starts as a workflow nobody owns",
    },
    (date(2026, 10, 13), "PM"): {
        "name": "National Work-Life Week",
        "hook": "Balance needs boring systems.",
        "angle": "work-life balance is built from repeated handoffs, not one big boundary speech",
    },
    (date(2026, 10, 16), "AM"): {
        "name": "National Boss's Day",
        "hook": "Good bosses delegate clearly.",
        "angle": "the best founder gift is a cleaner system for the people waiting on you",
    },
    (date(2026, 10, 31), "AM"): {
        "name": "Halloween",
        "hook": "The scariest task is vague.",
        "angle": "unclear ownership haunts a team longer than a missed deadline",
    },
    (date(2026, 10, 31), "PM"): {
        "name": "The Daylight Saving time-change weekend",
        "hook": "One hour is not enough.",
        "angle": "the extra hour disappears fast when the Monday handoff is still messy",
    },
    (date(2026, 11, 2), "AM"): {
        "name": "National Entrepreneurship Month",
        "hook": "Entrepreneurs need operators.",
        "angle": "founder courage matters, but operating support keeps the idea alive",
    },
    (date(2026, 11, 11), "AM"): {
        "name": "Veterans Day",
        "hook": "Service deserves clear support.",
        "angle": "team appreciation works best when the workload is handled with respect",
    },
    (date(2026, 11, 26), "AM"): {
        "name": "Thanksgiving",
        "hook": "Gratitude needs coverage.",
        "angle": "a real holiday pause starts with someone owning inbox triage",
    },
    (date(2026, 11, 27), "AM"): {
        "name": "Black Friday",
        "hook": "The sale needs operators.",
        "angle": "e-commerce founders need support in tickets, returns, and promo timing",
    },
    (date(2026, 11, 28), "AM"): {
        "name": "Small Business Saturday",
        "hook": "Small businesses run on follow-up.",
        "angle": "the missed customer message is often the most expensive task",
    },
    (date(2026, 11, 30), "AM"): {
        "name": "Cyber Monday",
        "hook": "Cyber Monday needs owners.",
        "angle": "orders, tickets, and exceptions need names beside them before traffic spikes",
    },
    (date(2026, 12, 1), "AM"): {
        "name": "Giving Tuesday",
        "hook": "Giving starts with time.",
        "angle": "leaders with margin can show up for causes, teams, and customers better",
    },
    (date(2026, 12, 4), "PM"): {
        "name": "Hanukkah",
        "hook": "Light the workload clearly.",
        "angle": "holiday coverage is kinder when the handoff is written before sunset",
    },
    (date(2026, 12, 11), "PM"): {
        "name": "National App Day",
        "hook": "Apps do not own work.",
        "angle": "tools help, but a named operator makes the system move",
    },
    (date(2026, 12, 24), "AM"): {
        "name": "Christmas Eve",
        "hook": "Close the laptop cleanly.",
        "angle": "holiday peace starts with a 10-minute review and one clear coverage note",
    },
    (date(2026, 12, 25), "AM"): {
        "name": "Christmas Day",
        "hook": "The inbox can wait.",
        "angle": "a real pause is a managed workflow, not a wish",
    },
    (date(2026, 12, 28), "AM"): {
        "name": "The year-end reflection arc",
        "hook": "Count the returned hours.",
        "angle": "year-end review should include the work you stopped doing yourself",
    },
    (date(2026, 12, 29), "AM"): {
        "name": "The year-end reflection arc",
        "hook": "Audit the repeat tasks.",
        "angle": "2027 planning starts with the chores that repeated 52 times",
    },
    (date(2026, 12, 30), "AM"): {
        "name": "The year-end reflection arc",
        "hook": "Write the January handoff.",
        "angle": "the first workday of 2027 should not depend on memory",
    },
    (date(2026, 12, 31), "AM"): {
        "name": "New Year's Eve",
        "hook": "End the year lighter.",
        "angle": "the cleanest resolution is one task the founder will stop owning",
    },
}


@dataclass
class Post:
    post_id: str
    date: str
    day: str
    time_et: str
    pillar: str
    format: str
    hook: str
    visual_concept: str
    gpt_image_2_prompt: str
    aspect_ratios: str
    caption_linkedin: str
    caption_instagram: str
    caption_facebook: str
    caption_tiktok: str
    hashtags: str
    cta: str


def day_abbr(d: date) -> str:
    return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d.weekday()]


def month_name(m: int) -> str:
    return date(2026, m, 1).strftime("%B")


def smart_topic(idx: int) -> dict[str, object]:
    return WORKFLOWS[idx % len(WORKFLOWS)]


def smart_pain(idx: int) -> tuple[str, str, str, str]:
    return PAINS[idx % len(PAINS)]


def smart_talent(idx: int) -> tuple[str, str, str, str, str, int]:
    return TALENT_ROLES[idx % len(TALENT_ROLES)]


def normal_pillar(d: date, slot: str) -> str:
    if d == date(2026, 5, 15) and slot == "PM":
        return "B"
    if slot == "AM":
        return ["A", "D", "A", "B", "A", "E"][d.weekday()]
    return ["B", "C", "D", "C", "E", "C"][d.weekday()]


def normal_format(pillar: str, slot: str, idx: int) -> str:
    if pillar == "A":
        return "Carousel (5 slides)" if idx % 3 != 0 else "Reel (15s)"
    if pillar == "B":
        return "Single Image" if slot == "AM" else "Reel (15s)"
    if pillar == "C":
        return "Reel (15s)" if idx % 2 == 0 else "Single Image"
    if pillar == "D":
        return "Carousel (4 slides)" if idx % 2 == 0 else "Single Image"
    if pillar == "E":
        return "Single Image" if slot == "AM" else "TikTok (22s)"
    return "Single Image"


def aspect_for(fmt: str) -> str:
    if "Reel" in fmt or "TikTok" in fmt or "Video" in fmt:
        return "LI 9:16, IG 9:16, FB 4:5, TT 9:16"
    if "Carousel" in fmt:
        return "LI 4:5, IG 4:5, FB 4:5, TT 9:16 slide video"
    return "LI 4:5, IG 4:5, FB 1:1, TT 9:16"


def article_for(noun: str) -> str:
    lower = noun.lower()
    if lower.startswith(("ehr", "mls", "e-commerce")):
        return "an"
    return "an" if noun[:1].lower() in {"a", "e", "i", "o", "u"} else "a"


def cta_for(pillar: str, topic: dict[str, object] | None = None) -> str:
    if pillar == "A":
        return "Message PLAYBOOK for the handoff map"
    if pillar == "B":
        return "Message INBOX for the first handoff"
    if pillar == "C":
        return "Message ROLE for the fit brief"
    if pillar == "D":
        return "Start Hiring with the cost worksheet"
    return "Message COVERAGE for the handoff checklist"


def prompt_for(pillar: str, fmt: str, hook: str, idx: int, topic: dict[str, object] | None = None, event: str | None = None) -> str:
    ratio = "9:16" if ("Reel" in fmt or "TikTok" in fmt or "Video" in fmt) else "4:5"
    if "Carousel" in fmt or pillar in {"A", "D"}:
        workflow = topic["name"] if topic else "delegation workflow"
        noun = topic["noun"] if topic else "shared checklist"
        article = article_for(noun)
        return (
            f"Vector flat illustration, a crisp operating workflow for {workflow} with a founder icon, a virtual assistant icon, and {article} {noun} moving across three labeled stages, "
            f"set on a warm cream editorial canvas with three rounded cards, diagonal hourglass-transfer accents, and a compact progress strip, "
            f"soft studio light, orthographic front view, balanced grid, sharp hierarchy, "
            f"main diagram centered with negative space upper-left for title text, "
            f"color palette: warm cream {BRAND_SECONDARY} background, core charcoal {BRAND_PRIMARY} type and panels, hourglass orange {BRAND_ACCENT} on the action arrow, delegation gold {BRAND_GOLD} on divider lines, protected silver {BRAND_SILVER} on the center triangle, "
            f"materials: matte paper texture, soft graphite {BRAND_GRAPHITE} micro-lines, crisp card edges, "
            f"style reference: premium B2B editorial system, "
            f"mood: clear, trusted, organized, "
            f"Aspect ratio {ratio}. Text reads exactly: \"{hook}\" in clean heavy sans, Lato/Inter-like, large, core charcoal {BRAND_PRIMARY}, placed upper-left. Reserve lower-right logo-safe space for the supplied Ten80Ten hourglass mark added after generation. Final style: vector flat illustration, crisp edges."
        )

    role, subject, place, task, noun, num = smart_talent(idx)
    if pillar == "C":
        article = article_for(noun)
        role_article = article_for(role)
        return (
            f"Editorial photograph, {subject} working as {role_article} {role}, seated upright and reviewing {article} {noun} with a focused half-smile, "
            f"in a natural-light {place} with a small desk, laptop stand, notebook, and one plant near the window, "
            f"soft morning window light from camera-left, warm 3400K, gentle fill from a cream wall, "
            f"shot on 50mm f/1.8, eye-level medium close-up, shallow depth of field, "
            f"subject on the right third with negative space upper-left, "
            f"color palette: warm cream walls {BRAND_SECONDARY}, core charcoal {BRAND_PRIMARY} laptop case and chair, hourglass orange {BRAND_ACCENT} on one sticky note beside the keyboard, delegation gold {BRAND_GOLD} on a slim notebook tab, protected silver {BRAND_SILVER} in the laptop body, natural skin tones, "
            f"materials: matte ceramic mug, woven notebook cover, linen curtain, brushed aluminum, "
            f"style reference: premium documentary office photography, "
            f"mood: attentive, trusted, ready, "
            f"Aspect ratio {ratio}. Text reads exactly: \"{hook}\" in clean heavy sans, Lato/Inter-like, core charcoal {BRAND_PRIMARY}, placed upper-left. Reserve lower-right logo-safe space for the supplied Ten80Ten hourglass mark added after generation. Photorealistic."
        )

    if pillar == "B":
        hook_text, number, noun, sentence = smart_pain(idx)
        article = article_for(noun)
        return (
            f"Editorial photograph, a founder in their early 40s writing a coverage note beside {article} {noun} and an open laptop, "
            f"in a quiet American townhouse kitchen with warm cream tile, a wooden stool, and a tidy folder shelf, "
            f"warm pendant light from camera-right at 3000K, soft shadows and a small practical light from the laptop, "
            f"shot on 35mm f/1.8, slightly high angle, medium-wide framing, shallow depth of field, "
            f"founder lower-left with empty wall space upper-right, "
            f"color palette: warm cream tile {BRAND_SECONDARY}, core charcoal {BRAND_PRIMARY} laptop sleeve, hourglass orange {BRAND_ACCENT} on a sticky note attached to the {noun}, delegation gold {BRAND_GOLD} on a brass pen, protected silver {BRAND_SILVER} in the laptop body, "
            f"materials: polished stone, matte phone case, brushed brass pen, paper texture, "
            f"style reference: premium editorial founder-life photography, "
            f"mood: honest, composed, relieved, "
            f"Aspect ratio {ratio}. Text reads exactly: \"{hook}\" in clean heavy sans, Lato/Inter-like, core charcoal {BRAND_PRIMARY}, placed upper-right. Reserve lower-right logo-safe space for the supplied Ten80Ten hourglass mark added after generation. Photorealistic."
        )

    event_name = event or "seasonal work moment"
    return (
        f"Editorial photograph, a small-business founder in their late 30s reviewing a simple coverage note on a laptop while a remote teammate appears in a small video-call tile, "
        f"in a sunlit home office with a wooden desk, wall calendar, and one framed family photo, "
        f"soft afternoon window light from camera-left, neutral 3800K, gentle fill from a white wall, "
        f"shot on 50mm f/2.0, eye-level medium shot, natural depth of field, "
        f"laptop and hands on the lower third with negative space top-center, "
        f"color palette: warm cream wall {BRAND_SECONDARY}, core charcoal {BRAND_PRIMARY} notebook and screen UI, hourglass orange {BRAND_ACCENT} on a calendar marker for {event_name}, delegation gold {BRAND_GOLD} on a thin divider card, protected silver {BRAND_SILVER} in the laptop body, "
        f"materials: brushed aluminum laptop, paper calendar, matte ceramic pen cup, linen curtain, "
        f"style reference: premium documentary office photography, "
        f"mood: thoughtful, calm, ready, "
        f"Aspect ratio {ratio}. Text reads exactly: \"{hook}\" in clean heavy sans, Lato/Inter-like, core charcoal {BRAND_PRIMARY}, placed top-center. Reserve lower-right logo-safe space for the supplied Ten80Ten hourglass mark added after generation. Photorealistic."
    )


def linkedin_caption(pillar: str, hook: str, idx: int, topic: dict[str, object] | None = None, event: dict[str, str] | None = None) -> str:
    angle = ANGLE_LINES[idx % len(ANGLE_LINES)]
    if pillar == "A":
        t = topic or smart_topic(idx)
        return (
            f"{hook}\n\n"
            f"A founder does not need another ritual. They need a handoff small enough to survive Monday.\n\n"
            f"{angle}\n\n"
            f"Here is the 10/80/10 version for {t['name']}:\n\n"
            f"First 10%: you record a {t['asset']} and define the line your VA should bring back to you.\n\n"
            f"Middle 80%: your VA owns {t['tasks']} inside {t['tools']}. One board update lands before 4 PM ET.\n\n"
            f"Final 10%: you review {t['review']}, answer the odd edge case, and tighten the checklist for next week.\n\n"
            f"Imagine a {t['backlog']}-item backlog. You should not touch all {t['backlog']}. You should touch the 3 that carry judgment, money, or client risk.\n\n"
            f"The trust signal is the managed layer: screening, onboarding, login management, time tracking, e-timesheets, and one clear review loop.\n\n"
            f"That is the frame.\n\n"
            f"Less heroic typing. More work leaving your desk with a name beside it.\n\n"
            f"We would rather see 1 boring workflow owned clearly than 10 exciting ideas trapped in the founder's inbox.\n\n"
            f"If this is the workflow slowing your day, message PLAYBOOK and we will map the first handoff."
        )
    if pillar == "B":
        pain_hook, number, noun, sentence = smart_pain(idx)
        return (
            f"{hook}\n\n"
            f"It says {number}. It does not show the 14 tiny decisions hiding between them, the {noun} you keep reopening, or the approval someone is waiting on before they can finish their work.\n\n"
            f"{sentence}\n\n"
            f"{angle}\n\n"
            f"We see this with founders all the time: the company is not short on effort. It is short on owners for the repeatable work.\n\n"
            f"The fix is not a dramatic reorg. Pick one recurring chore this week. Record the first 10%. Give a screened, onboarded operator the middle 80%. Review the final 10% on Friday.\n\n"
            f"Start with one thing.\n\n"
            f"If that one thing gives you back 45 minutes a day, you just found almost 4 hours a week that were hiding in plain sight.\n\n"
            f"That is enough room for the sales call, the school pickup, or the quiet hour your brain has been asking for.\n\n"
            f"Message INBOX if the second shift is the thing you need to stop carrying."
        )
    if pillar == "C":
        role, subject, place, task, noun, num = smart_talent(idx)
        return (
            f"{hook}\n\n"
            f"The best remote operators rarely look dramatic on camera. They look like a clean {noun}, a calm update, and a client who did not have to ask twice.\n\n"
            f"This week’s talent-side story is about the craft behind {task}: checking the small fields, catching the weird exception, and leaving a note the next person can understand in 20 seconds.\n\n"
            f"{angle}\n\n"
            f"A good {role} is not just fast. They are specific. They know which detail can wait and which one can create a mess by 3 PM ET.\n\n"
            f"That is why Ten80Ten screens, onboards, and manages for ownership, not just task completion.\n\n"
            f"The quiet win: {num} clean updates in one queue, all with context attached.\n\n"
            f"That is what trust looks like before it becomes a testimonial: fewer pings, fewer repeats, and a founder who can see the status without asking.\n\n"
            f"Message ROLE if you want to see what this support role could own in your company."
        )
    if pillar == "D":
        t = topic or smart_topic(idx)
        return (
            f"{hook}\n\n"
            f"A full-time remote hire through Ten80Ten starts at $10,000/year. That number matters, but the real math is bigger than salary.\n\n"
            f"Add the 6 weeks a founder can spend interviewing, the 3 tools a new operator has to learn, and the 17 small follow-ups that keep slipping while everyone says they are busy.\n\n"
            f"{angle}\n\n"
            f"Then compare that to a managed remote operator with training, login management, time tracking, e-timesheets, and a 6-month Perfect Hire Guarantee.\n\n"
            f"The point is controlled capacity: lower risk on work that already has a shape.\n\n"
            f"For {t['industry']}, the best starting place is usually {t['name']}: one workflow, one owner, one Friday review.\n\n"
            f"When the owner is clear, the spreadsheet gets easier to believe.\n\n"
            f"You are not buying an extra pair of hands. You are buying back the operating attention that 29 tiny tasks keep taking.\n\n"
            f"Start Hiring if this is the math your team needs to see on paper."
        )
    e = event or {"name": "This week", "angle": "the work still needs a clear owner"}
    return (
        f"{hook}\n\n"
        f"{e['name']} is a bad day for generic wallpaper. It is a good day to look at how work actually moves through a small company.\n\n"
        f"The useful angle: {e['angle']}.\n\n"
        f"{angle}\n\n"
        f"That can be as small as a 10-minute coverage note, a 3-line inbox rule, or one shared Asana board that says who owns what before the team logs off.\n\n"
        f"Ten80Ten makes that handoff easier to trust with screened talent, clear onboarding, monitoring, and practical operating tools.\n\n"
        f"We like holidays because they reveal the truth. If the business cannot pause for 24 hours, the founder is probably still carrying too much of the operating system in their head.\n\n"
        f"Write the handoff before the moment arrives.\n\n"
        f"Your future self gets the cleaner morning.\n\n"
        f"The work does not need a speech. It needs 1 named owner and a note the team can trust.\n\n"
        f"That is the difference between stepping away and checking your phone under the table.\n\n"
        f"Message COVERAGE if your next break needs a cleaner plan."
    )


def instagram_caption(pillar: str, hook: str, idx: int, topic: dict[str, object] | None = None, event: dict[str, str] | None = None) -> str:
    angle = ANGLE_LINES[idx % len(ANGLE_LINES)]
    if pillar == "A":
        t = topic or smart_topic(idx)
        return (
            f"{hook}\n\n"
            f"Try the 10/80/10 version of {t['name']} this week. You own the first 10%: record a {t['asset']} and write the rule for what comes back to you. Your VA owns the middle 80% inside {t['tools']}. You own the final 10%: review {t['review']} and tighten the checklist.\n\n"
            f"{angle}\n\n"
            f"The Ten80Ten difference is the managed layer: screened talent, onboarding, login management, time tracking, and e-timesheets, so support feels organized instead of risky.\n\n"
            f"That is how a {t['backlog']}-item backlog stops living in your head.\n\n"
            f"One workflow. One owner. One review.\n\n"
            f"That is practical time back.\n\n"
            f"Message PLAYBOOK if this is the handoff you need first."
        )
    if pillar == "B":
        _, number, noun, sentence = smart_pain(idx)
        return (
            f"{hook}\n\n"
            f"The {noun} is not the real problem. The problem is that {number} keeps turning into 14 more tiny choices that only you can answer.\n\n"
            f"{sentence}\n\n"
            f"{angle}\n\n"
            f"We would start smaller than you think: one recurring chore, one Loom, one shared board, one Friday review. Ten80Ten pairs the operator with screening, onboarding, and monitoring so the handoff feels safe, not like another management job.\n\n"
            f"The first handoff does not have to fix the company. It has to prove your desk is not the only place work can move.\n\n"
            f"That is practical time back.\n\n"
            f"Message INBOX if the second shift needs to end."
        )
    if pillar == "C":
        role, _, _, task, noun, num = smart_talent(idx)
        return (
            f"{hook}\n\n"
            f"A strong {role} does more than finish {task}. They leave the {noun} cleaner than they found it, write the note someone else needs, and spot the odd detail before it becomes a Friday problem.\n\n"
            f"{angle}\n\n"
            f"The quiet win is the part buyers rarely see: {num} updates with context, not just boxes checked.\n\n"
            f"Ten80Ten screens, onboards, and manages for that kind of ownership because trust is built in the small handoffs.\n\n"
            f"That is the work behind the work.\n\n"
            f"That is practical time back.\n\n"
            f"Message ROLE for the first support brief."
        )
    if pillar == "D":
        t = topic or smart_topic(idx)
        return (
            f"{hook}\n\n"
            f"Ten80Ten full-time remote hires start at $10,000/year, but the cleaner number is risk. How long does hiring take? Who trains the person? Who checks the work? What happens if the fit is wrong?\n\n"
            f"{angle}\n\n"
            f"Training, login management, time tracking, e-timesheets, and a 6-month Perfect Hire Guarantee make the number easier to trust.\n\n"
            f"For {t['industry']}, we would start with {t['name']}: 1 workflow, 1 owner, 1 Friday review.\n\n"
            f"That is where the savings become visible.\n\n"
            f"That is practical time back.\n\n"
            f"Start Hiring when you want the worksheet."
        )
    e = event or {"name": "This week", "angle": "the work still needs a clear owner"}
    return (
        f"{hook}\n\n"
        f"{e['name']} does not need a generic graphic. It needs a useful reminder: {e['angle']}.\n\n"
        f"{angle}\n\n"
        f"Coverage gets easier when the operator is screened, onboarded, and working from a written rule.\n\n"
        f"Write the 3-line coverage note. Name the person watching the inbox. Put the Asana board where the team can see it.\n\n"
        f"A holiday feels different when the work has an owner.\n\n"
        f"That is practical time back.\n\n"
        f"Message COVERAGE for the checklist."
    )


def facebook_caption(pillar: str, hook: str, idx: int, topic: dict[str, object] | None = None, event: dict[str, str] | None = None) -> str:
    angle = ANGLE_LINES[idx % len(ANGLE_LINES)]
    if pillar == "A":
        t = topic or smart_topic(idx)
        return f"{hook}\n\nTry this with {t['name']}: you set up the first 10%, your VA owns the middle 80%, and you review the final 10%. A {t['backlog']}-item backlog feels different when only 3 items truly need you. {angle} Time back without extra chaos. Start small."
    if pillar == "B":
        _, number, noun, sentence = smart_pain(idx)
        return f"{hook}\n\nThe {noun} is only the clue. {number} turns into a pile of tiny choices when no one else owns the workflow. Pick 1 recurring chore this week and hand off the middle 80%. {angle} Time back without extra chaos. Start small."
    if pillar == "C":
        role, _, _, task, noun, num = smart_talent(idx)
        return f"{hook}\n\nA good {role} makes {task} feel calmer. The win is not flashy: {num} clean updates, one clear {noun}, and fewer follow-up questions for the founder. {angle} Time back without extra chaos. Start small."
    if pillar == "D":
        t = topic or smart_topic(idx)
        return f"{hook}\n\nRemote hires through Ten80Ten start at $10,000/year, with a 6-month Perfect Hire Guarantee. For {t['industry']}, start with 1 workflow like {t['name']} and measure what leaves the founder’s desk. {angle} Time back without extra chaos. Start small."
    e = event or {"name": "this week", "angle": "the work still needs a clear owner"}
    return f"{hook}\n\nFor {e['name']}, skip the generic greeting. The useful reminder is simple: {e['angle']}. Write the 3-line handoff before the team logs off. {angle} Time back without extra chaos. Start small."


def tiktok_caption(hook: str, idx: int) -> str:
    overlays = [
        "Overlay: 10% setup / 80% delegate / 10% review",
        "Overlay: The task needs an owner, not another tab",
        "Overlay: Record once, hand off daily, review Friday",
        "Overlay: Founder math starts with the work you stop doing",
        "Overlay: One workflow. One owner. One review.",
    ]
    return f"{hook} Use 10/80/10 on 1 task. {overlays[idx % len(overlays)]} Start Hiring."


def hook_a(seq: int, topic: dict[str, object]) -> str:
    label = WORKFLOW_LABELS[str(topic["name"])]
    ending = A_HOOK_ENDINGS[(seq // len(WORKFLOWS)) % len(A_HOOK_ENDINGS)]
    return f"{label} {ending}"


def hook_b(seq: int) -> str:
    subject, verb, _, _ = B_SUBJECTS[seq % len(B_SUBJECTS)]
    ending = B_HOOK_ENDINGS[(seq // len(B_SUBJECTS)) % len(B_HOOK_ENDINGS)]
    return f"{subject} {verb} {ending}"


def hook_c(seq: int) -> str:
    role, *_ = smart_talent(seq)
    label = C_ROLE_LABELS[role]
    ending = C_HOOK_ENDINGS[(seq // len(TALENT_ROLES)) % len(C_HOOK_ENDINGS)]
    return f"{label} {ending}"


def hook_d(seq: int, topic: dict[str, object]) -> str:
    label = WORKFLOW_LABELS[str(topic["name"])]
    ending = D_HOOK_ENDINGS[(seq // len(WORKFLOWS)) % len(D_HOOK_ENDINGS)]
    return f"{label} {ending}"


def hook_e(d: date, seq: int, topic: dict[str, object]) -> str:
    month = d.strftime("%B")
    label = WORKFLOW_SHORT[str(topic["name"])]
    ending = E_HOOK_ENDINGS[(seq // len(WORKFLOWS)) % len(E_HOOK_ENDINGS)]
    return f"{month} {label} {ending}"


def concept_for(d: date, pillar: str, fmt: str, idx: int, seq: int, topic: dict[str, object] | None = None, event: dict[str, str] | None = None) -> tuple[str, str]:
    if event:
        return (
            event["hook"],
            f"{fmt} tied to {event['name']}. The viewer sees a founder setting a written coverage note before stepping away, with one hourglass-orange marker showing the task owner and a calm workspace that feels human rather than ceremonial.",
        )
    if pillar == "A":
        t = topic or smart_topic(idx)
        hook = hook_a(seq, t)
        return hook, f"{fmt} showing the 10/80/10 Framework applied to {t['name']}. The visual moves from founder setup to VA ownership to a tight Friday review, with one orange diagonal transfer line carrying the work across the frame."
    if pillar == "B":
        _, number, noun, sentence = smart_pain(idx)
        hook = hook_b(seq)
        return hook, f"{fmt} built around a real-feeling founder moment: {number}, one {noun}, and the quiet realization that small tasks have become a second shift. The scene is intimate, specific, and lightly cinematic."
    if pillar == "C":
        role, subject, place, task, noun, num = smart_talent(idx)
        article = article_for(role)
        hook = hook_c(seq)
        return hook, f"{fmt} spotlighting the craft of {article} {role} without inventing a testimonial. The viewer sees {task}, a clean {noun}, and the small visual proof of {num} organized updates."
    if pillar == "D":
        t = topic or smart_topic(idx)
        hook = hook_d(seq, t)
        return hook, f"{fmt} using clean numbers, cost framing, and a workflow slice from {t['industry']}. The visual compares founder-owned admin with a managed remote operator, using hourglass orange only for the decision point."
    hook = hook_e(d, seq, topic or smart_topic(idx))
    return hook, f"{fmt} connecting a timely US observance to delegation and founder work-life balance. The image uses a real workspace cue, not holiday wallpaper."


def pillar_for(d: date, slot: str) -> str:
    return "E" if EVENTS.get((d, slot)) else normal_pillar(d, slot)


def build_post(d: date, slot: str, idx: int, pillar_seq: int) -> Post:
    event = EVENTS.get((d, slot))
    pillar = pillar_for(d, slot)
    content_idx = pillar_seq
    topic = smart_topic(content_idx)
    fmt = normal_format(pillar, slot, idx)
    if event and slot == "PM":
        fmt = "TikTok (22s)"
    elif event:
        fmt = "Single Image"
    hook, visual = concept_for(d, pillar, fmt, content_idx, pillar_seq, topic, event)
    prompt = prompt_for(pillar, fmt, hook, content_idx, topic, event["name"] if event else None)
    li = linkedin_caption(pillar, hook, content_idx, topic, event)
    ig = instagram_caption(pillar, hook, content_idx, topic, event)
    fb = facebook_caption(pillar, hook, content_idx, topic, event)
    tt = tiktok_caption(hook, idx)
    h = HASHTAG_SETS[idx % len(HASHTAG_SETS)]
    hashtags = f"LI: {h['LI']} | IG: {h['IG']} | FB: {h['FB']} | TT: {h['TT']}"
    post_id = f"T80T-{d.isoformat()}-{slot}"
    return Post(
        post_id=post_id,
        date=d.isoformat(),
        day=day_abbr(d),
        time_et="09:00" if slot == "AM" else "17:30",
        pillar=pillar,
        format=fmt,
        hook=hook,
        visual_concept=visual,
        gpt_image_2_prompt=prompt,
        aspect_ratios=aspect_for(fmt),
        caption_linkedin=li,
        caption_instagram=ig,
        caption_facebook=fb,
        caption_tiktok=tt,
        hashtags=hashtags,
        cta=cta_for(pillar, topic),
    )


def all_dates() -> list[date]:
    d = date(2026, 5, 15)
    end = date(2026, 12, 31)
    dates: list[date] = []
    while d <= end:
        if d.weekday() != 6:
            dates.append(d)
        d += timedelta(days=1)
    return dates


def qc(posts: list[Post]) -> list[str]:
    errors: list[str] = []
    prev_hash = None
    week_pillars: dict[tuple[int, int], set[str]] = {}
    hooks_seen: dict[str, str] = {}
    first_lines_seen: dict[str, str] = {}
    for p in posts:
        y, w, _ = date.fromisoformat(p.date).isocalendar()
        week_pillars.setdefault((y, w), set()).add(p.pillar)
        if p.day == "Sun":
            errors.append(f"{p.post_id}: Sunday post")
        if p.time_et not in {"09:00", "17:30"}:
            errors.append(f"{p.post_id}: bad time")
        for field_name in ["caption_linkedin", "caption_instagram", "caption_facebook", "caption_tiktok"]:
            txt = getattr(p, field_name).lower()
            for banned in BANNED:
                if banned in txt:
                    errors.append(f"{p.post_id}: banned phrase in {field_name}: {banned}")
            if not any(ch.isdigit() for ch in txt):
                errors.append(f"{p.post_id}: no specific number in {field_name}")
        if p.hook in hooks_seen:
            errors.append(f"{p.post_id}: duplicate hook also used by {hooks_seen[p.hook]}: {p.hook}")
        hooks_seen[p.hook] = p.post_id
        first_line = p.caption_linkedin.splitlines()[0].strip()
        if first_line in first_lines_seen:
            errors.append(f"{p.post_id}: duplicate LinkedIn opener also used by {first_lines_seen[first_line]}: {first_line}")
        first_lines_seen[first_line] = p.post_id
        if len(first_line.replace(".", "").split()) > 8:
            errors.append(f"{p.post_id}: first line too long")
        if "?" in first_line:
            errors.append(f"{p.post_id}: first line question")
        if first_line[:1].isdigit():
            errors.append(f"{p.post_id}: first line starts with stat")
        if BRAND_ACCENT not in p.gpt_image_2_prompt:
            errors.append(f"{p.post_id}: missing hourglass orange accent")
        for required_color in [BRAND_PRIMARY, BRAND_SECONDARY, BRAND_GOLD, BRAND_SILVER]:
            if required_color not in p.gpt_image_2_prompt:
                errors.append(f"{p.post_id}: missing brand color {required_color} in image prompt")
        prompt_lower = p.gpt_image_2_prompt.lower()
        for pattern in OFF_BRAND_PROMPT_PATTERNS:
            if re.search(pattern.lower(), prompt_lower):
                errors.append(f"{p.post_id}: off-brand prompt pattern: {pattern}")
        if "Aspect ratio" not in p.gpt_image_2_prompt:
            errors.append(f"{p.post_id}: missing aspect ratio")
        li_len = len(p.caption_linkedin)
        if not 800 <= li_len <= 1500:
            errors.append(f"{p.post_id}: LinkedIn caption length {li_len} outside 800-1500")
        ig_words = len(p.caption_instagram.split())
        if not 90 <= ig_words <= 200:
            errors.append(f"{p.post_id}: Instagram caption word count {ig_words} outside 90-200")
        fb_words = len(p.caption_facebook.split())
        if not 50 <= fb_words <= 120:
            errors.append(f"{p.post_id}: Facebook caption word count {fb_words} outside 50-120")
        tt_len = len(p.caption_tiktok)
        if not 100 <= tt_len <= 150:
            errors.append(f"{p.post_id}: TikTok caption length {tt_len} outside 100-150")
        prompt_words = len(re.findall(r"\b[\w#'/.-]+\b", p.gpt_image_2_prompt))
        if not 80 <= prompt_words <= 180:
            errors.append(f"{p.post_id}: GPT-Image-2 prompt word count {prompt_words} outside 80-180")
        if prev_hash == p.hashtags:
            errors.append(f"{p.post_id}: repeated hashtag set")
        prev_hash = p.hashtags
    for week, pillars in week_pillars.items():
        if "B" not in pillars or "C" not in pillars:
            errors.append(f"ISO week {week}: missing Pillar B or C")
    return errors


def write_month(month: int, posts: list[Post]) -> None:
    mp = [p for p in posts if int(p.date[5:7]) == month]
    lines: list[str] = []
    lines.append(f"# Ten80Ten Content Calendar — {month_name(month)} 2026")
    lines.append("")
    lines.append(f"Theme: {MONTH_THEMES[month]}")
    lines.append("")
    lines.append("## Abbreviated Calendar")
    lines.append("")
    lines.append("| Post ID | Date | Day | Time ET | Pillar | Format | Hook | Visual Short | CTA |")
    lines.append("|---|---:|---|---:|---|---|---|---|---|")
    for p in mp:
        visual_short = p.visual_concept.replace("|", "/")
        if len(visual_short) > 145:
            visual_short = visual_short[:142] + "..."
        lines.append(f"| {p.post_id} | {p.date} | {p.day} | {p.time_et} | {p.pillar} | {p.format} | {p.hook} | {visual_short} | {p.cta} |")
    lines.append("")
    lines.append("## Expanded Production Entries")
    lines.append("")
    for p in mp:
        lines.append(f"### {p.post_id} — {p.hook}")
        lines.append("")
        lines.append(f"- Date: {p.date} ({p.day})")
        lines.append(f"- Time ET: {p.time_et}")
        lines.append(f"- Pillar: {p.pillar} — {PILLAR_DEFS[p.pillar]}")
        lines.append(f"- Format: {p.format}")
        lines.append(f"- Aspect ratios: {p.aspect_ratios}")
        lines.append(f"- Visual concept: {p.visual_concept}")
        lines.append(f"- GPT-Image-2 prompt: {p.gpt_image_2_prompt}")
        lines.append("")
        lines.append("LinkedIn caption:")
        lines.append("")
        lines.append(p.caption_linkedin)
        lines.append("")
        lines.append("Instagram caption:")
        lines.append("")
        lines.append(p.caption_instagram)
        lines.append("")
        lines.append("Facebook caption:")
        lines.append("")
        lines.append(p.caption_facebook)
        lines.append("")
        lines.append("TikTok caption:")
        lines.append("")
        lines.append(p.caption_tiktok)
        lines.append("")
        lines.append(f"Hashtags: {p.hashtags}")
        lines.append("")
        lines.append(f"CTA: {p.cta}")
        lines.append("")
    (OUT / f"{month:02d}-{month_name(month).lower()}.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_index(posts: list[Post], errors: list[str]) -> None:
    lines = [
        "# Ten80Ten 2026 Social Calendar",
        "",
        "Date range: May 15, 2026 through December 31, 2026.",
        "",
        "Cadence: Monday through Saturday, two posts per day, 09:00 ET and 17:30 ET. Sundays are excluded; Sunday observances are handled on Saturday or the next Monday as noted inside the relevant month.",
        "",
        f"Total production entries: {len(posts)}.",
        "",
        "Brand colors from `Ten80Ten_Full_Brand_Guidelines_A4.pdf`:",
        f"- Core Charcoal: `{BRAND_PRIMARY}`",
        f"- Hourglass Orange: `{BRAND_ACCENT}`",
        f"- Delegation Gold: `{BRAND_GOLD}`",
        f"- Protected Silver: `{BRAND_SILVER}`",
        f"- Warm Cream: `{BRAND_SECONDARY}`",
        f"- Soft Graphite: `{BRAND_GRAPHITE}`",
        "",
        "## Monthly Themes",
        "",
    ]
    for m in range(5, 13):
        lines.append(f"- {month_name(m)}: {MONTH_THEMES[m]}")
    lines.extend([
        "",
        "## Files",
        "",
    ])
    for m in range(5, 13):
        fname = f"{m:02d}-{month_name(m).lower()}.md"
        lines.append(f"- [{month_name(m)} 2026](./{fname})")
    lines.extend([
        "- [All posts CSV](./all-posts.csv)",
        "- [CMO brand audit](./CMO-BRAND-AUDIT.md)",
        "- [Distribution bonus](./distribution-bonus.md)",
        "",
        "## Pillars",
        "",
    ])
    for k, v in PILLAR_DEFS.items():
        lines.append(f"- {k}: {v}")
    lines.extend(["", "## Competitive Intelligence", "", SOURCES_NOTE.strip(), ""])
    lines.append("## Quality Control")
    lines.append("")
    if errors:
        lines.append("QC found issues:")
        for e in errors:
            lines.append(f"- {e}")
    else:
        lines.append("QC passed: no Sunday posts, each week includes Pillar B and Pillar C, all prompts include hourglass orange and aspect ratio, captions avoid banned language, captions include a specific number, hooks are unique, openers are unique, and hashtag sets do not repeat back-to-back.")
    lines.append("")
    (OUT / "README.md").write_text("\n".join(lines), encoding="utf-8")


def write_distribution_bonus() -> None:
    lines = [
        "# Distribution Bonus",
        "",
        "## Scheduling Cheatsheet",
        "",
        "- Monday to Saturday, schedule the morning post at 09:00 ET with LinkedIn as primary. Repurpose to Facebook within the same hour.",
        "- Monday to Saturday, schedule the evening post at 17:30 ET with Instagram and TikTok as primary. Repurpose to Facebook between 18:00 and 19:00 ET.",
        "- Batch by format: shoot all founder-reality stills in one 90-minute block, produce all carousel covers in one design batch, and record Talent Spotlight clips in 3-question interviews.",
        "- Approval rhythm: Monday theme check, Wednesday midweek copy pass, Friday next-week asset lock. Use one shared sheet with columns for owner, asset status, caption status, and scheduled URL.",
        "- For carousels, publish the full carousel on LinkedIn and Instagram; turn the same frames into a 9:16 slide video for TikTok.",
        "- For Reel/TikTok concepts, export 9:16 first, then crop a 4:5 cut for LinkedIn and Facebook when needed.",
        "",
        "## Repurposing Matrix",
        "",
        "| Source Post | LinkedIn | Instagram | Facebook | TikTok |",
        "|---|---|---|---|---|",
        "| Pillar A carousel | Full educational carousel with caption | Carousel or Reel using slide motion | 4:5 image plus shorter caption | 20-second slide video with hook overlay |",
        "| Pillar B founder POV | Single image with longer story | Still or Reel with desk/kitchen scene | Friendlier 80-word version | POV clip with 1 hard truth overlay |",
        "| Pillar C talent spotlight | Craft-focused profile | Reel with workspace B-roll | Team appreciation post | Day-in-the-life micro-clip |",
        "| Pillar D ROI proof | Cost breakdown carousel | Single stat card plus caption | Practical small-business math | Spreadsheet screen-record with voiceover |",
        "| Pillar E timely post | Observance angle with restraint | Visual cue tied to day | Community-friendly note | One-line timely hook plus fast edit |",
        "",
        "## Evergreen Swap Ideas",
        "",
        "1. The 3-line inbox rule every founder should write.",
        "2. What to hand off before your first vacation day.",
        "3. The 10/80/10 version of CRM cleanup.",
        "4. A remote assistant's morning checklist.",
        "5. The $10,000/year remote hire math, shown plainly.",
        "6. What a good Friday review actually looks like.",
        "7. The founder task that feels small but costs 5 hours.",
        "8. A secure login handoff for new VAs.",
        "9. First 30 days with a VA: week-by-week expectations.",
        "10. The difference between help and ownership.",
        "11. AI plus VA: 7 admin categories where humans still matter.",
        "12. The Asana board that replaces 14 Slack pings.",
        "",
    ]
    (OUT / "distribution-bonus.md").write_text("\n".join(lines), encoding="utf-8")


def write_cmo_audit(posts: list[Post]) -> None:
    lines = [
        "# CMO Brand Audit",
        "",
        "Verdict: the first generated calendar was not client-ready. It was strategically useful, but the visual system used placeholder navy/teal colors, several hooks repeated too often, and the captions leaned educational before they built enough commercial confidence.",
        "",
        "This rebuild aligns the production system to `Ten80Ten_Full_Brand_Guidelines_A4.pdf` and treats every post as a buyer-confidence asset, not just a content slot.",
        "",
        "## Brand Corrections Applied",
        "",
        "- Replaced placeholder navy/teal with the official system: Core Charcoal `#1B1713`, Hourglass Orange `#FF6426`, Delegation Gold `#C9BC72`, Protected Silver `#B8B7B2`, Warm Cream `#F7F2E8`, and Soft Graphite `#2C2925`.",
        "- Rewrote image prompts around the PDF's visual language: light editorial base, controlled charcoal contrast, orange as the action cue, gold dividers, silver protected-core details, diagonal hourglass-transfer accents, rounded cards, and simple arrows.",
        "- Added logo-safe space to every image prompt. The supplied Ten80Ten hourglass mark should be placed after generation; prompts do not ask the model to recreate the wordmark.",
        "- Reframed captions around the brand message pattern: problem -> relief -> trust signal -> clear CTA.",
        "- Added managed-fit trust signals across captions: screening, onboarding, login management, time tracking, e-timesheets, monitoring, and the 6-month Perfect Hire Guarantee where commercially relevant.",
        "- Replaced soft CTAs with message/click behavior: Message PLAYBOOK, Message INBOX, Message ROLE, Message COVERAGE, and Start Hiring.",
        "",
        "## CMO Judgment",
        "",
        "Are these stronger for client acquisition now? Yes, materially. The posts now sell the feeling Ten80Ten needs to own: calm operating relief with proof that the handoff is managed, not risky.",
        "",
        "The best-performing concepts should be Pillar B founder-reality posts and Pillar D ROI posts. They name the buyer's pain in plain language, then connect it to time back, managed support, and a low-friction next step.",
        "",
        "The visual prompts are also more ownable now. A founder scrolling past cream, charcoal, orange, gold, and silver posts with diagonal transfer cues should start to recognize Ten80Ten before seeing the logo.",
        "",
        "## Production Guardrails",
        "",
        "- Do not let GPT-Image-2 generate the Ten80Ten wordmark. Add the supplied logo or standalone hourglass mark in post-production.",
        "- Keep orange sparse. It should guide the eye to the action, not fill the background.",
        "- Keep photography professional and optimistic. Founder pain can be real, but the final frame should imply relief and control.",
        "- Do not crop out the logo-safe space when resizing to 9:16.",
        "- For carousels, use the same cream base, charcoal type, orange action arrow, gold divider, and silver core triangle across every slide.",
        "",
        "## QC Snapshot",
        "",
        f"- Total posts: {len(posts)}",
        f"- Unique hooks: {len({p.hook for p in posts})}",
        f"- Unique LinkedIn openers: {len({p.caption_linkedin.splitlines()[0] for p in posts})}",
        "- Image prompts: 80-180 words, official colors only, hourglass orange present in every prompt.",
        "- Captions: LinkedIn 800-1,500 chars, Instagram 90-200 words, Facebook 50-120 words, TikTok 100-150 chars.",
        "",
    ]
    (OUT / "CMO-BRAND-AUDIT.md").write_text("\n".join(lines), encoding="utf-8")


def write_csv(posts: list[Post]) -> None:
    with (OUT / "all-posts.csv").open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(Post.__dataclass_fields__.keys()))
        writer.writeheader()
        for p in posts:
            writer.writerow(p.__dict__)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    posts: list[Post] = []
    idx = 0
    pillar_counts: dict[str, int] = {}
    for d in all_dates():
        for slot in ("AM", "PM"):
            pillar = pillar_for(d, slot)
            pillar_seq = pillar_counts.get(pillar, 0)
            pillar_counts[pillar] = pillar_seq + 1
            posts.append(build_post(d, slot, idx, pillar_seq))
            idx += 1
    errors = qc(posts)
    for m in range(5, 13):
        write_month(m, posts)
    write_csv(posts)
    write_distribution_bonus()
    write_cmo_audit(posts)
    write_index(posts, errors)
    print(f"Wrote {len(posts)} posts to {OUT}")
    if errors:
        print("QC ERRORS:")
        for e in errors:
            print(e)
        raise SystemExit(1)
    print("QC passed")


if __name__ == "__main__":
    main()
