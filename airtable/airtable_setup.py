#!/usr/bin/env python3
"""
Belo ATS - Airtable schema bootstrap.

Creates the six tables and all fields the workflow writes to, using the
Airtable Meta API. You run this once, against your own base, with your own
token. It does not touch any data - only schema.

USAGE
  1. Create an empty base by hand in Airtable (New base -> Start from scratch).
     Delete the default "Table 1" later, or leave it; it's ignored.
  2. Grab the base id from the URL: airtable.com/appXXXXXXXXXXXXXX/...  -> appXXXX...
  3. Create a Personal Access Token at airtable.com/create/tokens with scopes:
        data.records:read, data.records:write, schema.bases:read, schema.bases:write
     and add THIS base to the token's access list.
  4. Run:
        export AIRTABLE_TOKEN="patXXXX..."
        export AIRTABLE_BASE_ID="appXXXX..."
        python3 airtable_setup.py

Re-running is safe: tables that already exist are skipped, missing fields are added.
"""
import json, os, sys, urllib.request, urllib.error

TOKEN = os.environ.get("AIRTABLE_TOKEN", "").strip()
BASE  = os.environ.get("AIRTABLE_BASE_ID", "").strip()
if not TOKEN or not BASE:
    sys.exit("Set AIRTABLE_TOKEN and AIRTABLE_BASE_ID environment variables first.")

API = "https://api.airtable.com/v0/meta/bases/" + BASE
HDR = {"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"}

def call(method, url, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, headers=HDR, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        return {"_error": e.code, "_body": body}

# ---- field type shorthands -------------------------------------------------
def txt(name):    return {"name": name, "type": "singleLineText"}
def long(name):   return {"name": name, "type": "multilineText"}
def num(name, p=0): return {"name": name, "type": "number", "options": {"precision": p}}
def date(name):   return {"name": name, "type": "date", "options": {"dateFormat": {"name": "iso"}}}
def check(name):  return {"name": name, "type": "checkbox", "options": {"icon": "check", "color": "greenBright"}}
def msel(name):   return {"name": name, "type": "multipleSelects", "options": {"choices": []}}

# ---- table definitions (primary field FIRST) -------------------------------
TABLES = {
    "Candidates": [
        txt("Candidate Key"), txt("Full Name"), txt("Preferred Name"),
        txt("First Name Key"), txt("Surname Key"), txt("Aliases"),
        txt("Current Role"), txt("Current Company"), long("Company History"),
        txt("Seniority"), txt("Location"), txt("Preferred Location"), txt("Remote Preference"),
        num("Current Base"), num("Current OTE"), num("Desired Base"), num("Desired OTE"),
        txt("Equity Importance"),
        msel("Skills"), msel("Methodologies"), msel("Languages"), msel("Preferred Industries"), msel("Tags"),
        txt("Education"), long("Career Goal"), txt("Timing Constraints"),
        date("Last Conversation Date"),
        check("Needs Review"), long("Review Reason"), num("Match Score"), long("Match Signals"),
    ],
    "Companies": [
        txt("Company Name"), txt("Industry"), txt("Relationship"),
    ],
    "Conversations": [
        txt("Conversation ID"), txt("Title"), date("Date"), txt("Type"), txt("Source Type"),
        txt("Recruiter"), txt("Participants"), txt("Duration"), long("Summary"),
        txt("Sentiment"), long("Next Action"), check("Confidential"), txt("File Name"),
        num("Extraction Confidence", 2), long("Unclear"), long("Raw Transcript"),
        num("Base At Time"), num("OTE At Time"), num("Desired Base At Time"), num("Desired OTE At Time"),
        txt("Role At Time"), txt("Company At Time"), txt("Location At Time"),
    ],
    "Opportunities": [
        txt("Opportunity Key"), txt("Role"), txt("Stage"), txt("Status"),
        num("Base"), num("OTE"), txt("Equity"), long("Recruiter Notes"), date("Last Updated"),
    ],
    "Interviews": [
        txt("Interview Key"), date("Date"), txt("Stage"), txt("Interviewer"),
        txt("Outcome"), long("Strengths"), long("Weaknesses"), long("Feedback"),
    ],
    "Review Queue": [
        txt("Conversation ID"), txt("File Name"), txt("Title"), date("Date"),
        txt("Stage"), long("Reason"), long("Raw Transcript"), txt("Status"),
    ],
}

# ---- link fields added in a SECOND pass (need target table ids) ------------
LINKS = {
    "Conversations":  [("Candidate", "Candidates")],
    "Opportunities":  [("Candidate", "Candidates"), ("Company Hiring", "Companies")],
    "Interviews":     [("Opportunity", "Opportunities"), ("Source Conversation", "Conversations")],
}

def load_schema():
    res = call("GET", API + "/tables")
    if "_error" in res:
        sys.exit("Could not read base schema (%s): %s" % (res["_error"], res["_body"]))
    return {t["name"]: t for t in res["tables"]}

print("Reading current schema...")
existing = load_schema()

# pass 1: create tables (scalar fields only)
for name, fields in TABLES.items():
    if name in existing:
        have = {f["name"] for f in existing[name]["fields"]}
        for f in fields:
            if f["name"] not in have:
                r = call("POST", API + "/tables/" + existing[name]["id"] + "/fields", f)
                print(("  + field %s.%s" % (name, f["name"])) + ("  ERR %s %s" % (r["_error"], r["_body"]) if "_error" in r else ""))
        print("= table exists: " + name)
    else:
        r = call("POST", API + "/tables", {"name": name, "fields": fields})
        if "_error" in r:
            print("! create %s FAILED %s: %s" % (name, r["_error"], r["_body"]))
        else:
            print("+ created table: " + name)

existing = load_schema()  # refresh to get ids of newly created tables

# pass 2: add link fields
for tbl, links in LINKS.items():
    have = {f["name"] for f in existing[tbl]["fields"]}
    for field_name, target in links:
        if field_name in have:
            print("= link exists: %s.%s" % (tbl, field_name)); continue
        payload = {"name": field_name, "type": "multipleRecordLinks",
                   "options": {"linkedTableId": existing[target]["id"]}}
        r = call("POST", API + "/tables/" + existing[tbl]["id"] + "/fields", payload)
        print(("+ link %s.%s -> %s" % (tbl, field_name, target)) + ("  ERR %s %s" % (r["_error"], r["_body"]) if "_error" in r else ""))

print("\nDone. Open the base and confirm six tables. Then set this base id in the n8n Config node:")
print("   " + BASE)
