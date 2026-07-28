# Transcript to ATS

Turns raw recruiter call transcripts into structured, relational candidate data in an Airtable ATS. Built for  Belo technical assessment.

**Transcript in, structured candidate and job data out, end to end.** n8n for orchestration, GPT-4o for extraction, Airtable for the ATS.

![Uploading Transcript to ATS.png…]()




---

## The problem this actually solves

The brief looks like an extraction task. It isn't. Anyone can pipe a transcript through an LLM and get fields out. The hard part is that **candidates recur and evolve over time, and identity is ambiguous.**

The sample data plants both failure modes on purpose:

- **Priyanka Raghavan / Priya Raghavan** - one person, two names. String matching never connects them.
- **Two different David Chens** - one a mid-market AE at Fentra in London, one a VP at Arden Cyber in Edinburgh, with overlapping tenures. String matching fuses them into one incoherent record.

So this is built around **identity resolution and preserving history**, not around extraction. A naive build fails both directions: it splits Priya into four records, or merges the two Davids into one.

Result on the sample set: **4 candidate records** (one Priya, two Davids with the Arden one flagged), **8 conversations**, **2 opportunities**, interviews including both rounds of Tom's Quorra day, and an empty review queue.

---

## How it works

```
Upload transcripts
 │
 ▼
Parse + sort by date (ascending) ← newest data must win, so it writes last
 │
 ▼
Loop, one at a time (batch size 1) ← sequential; parallel would race and duplicate
 │
 ▼
Extract structured JSON (GPT-4o, temp 0) ← the model only extracts, never decides
 │
 ▼
Validate schema ← reject bad data before it hits Airtable
 │
 ▼
Resolve identity ★ ← merge / flag / create (the core of the build)
 │
 ▼
Upsert Candidate → Conversation → Opportunity → Interview (idempotent, deterministic keys)
 │
 ▼
Run summary → Slack ← every run reports; silence is the alarm
```

Failed or unparseable transcripts branch to a **Review Queue** instead of stopping the run.

---

## The identity resolver - the heart of it

The rule is **not** a similarity threshold. A threshold treats silence as disagreement, which forks a candidate every time a call is short or is with a client rather than the candidate.

The rule is: **merge on a name match unless the transcript contradicts it.**

- **Corroboration** - both sides state something and it agrees (shared employer, same location, same education).
- **Contradiction** - both sides state something and it clashes (different city with no shared employer).
- **Silence** - neither. Silence is not evidence.

Three invariants that hold for transcripts never seen before:

1. Never silently merge two people → a contradiction always splits and flags.
2. Never silently split one person → any un-merged name match gets flagged.
3. Never decide between two equally plausible records → flag.

**Flag, don't merge** when ambiguous. A wrong merge quietly fuses two real people's histories and is unrecoverable; a flagged duplicate costs a recruiter ten seconds. There's also a compliance angle: a candidate can request their data, so the system should be able to hand them *their* record, not a fused one.

---

## Schema

Five core tables plus a review queue. Each table has a different rate of change or is a different entity; collapsing them would force overwriting the history the brief asks to preserve.

| Table | Holds | Why separate |
|---|---|---|
| **Candidates** | current state, one row per person | primary field is a slug, not the name - two people are both "David Chen" |
| **Conversations** | immutable dated log, one row per transcript, snapshots comp/role at that time | this is what makes "understand the journey over six months" work |
| **Companies** | employers and hiring companies | shared entities that opportunities link to |
| **Opportunities** | one row per candidate + company | the "journey through a role"; keyed on company, not role text ("EAE" vs "Enterprise Account Executive") |
| **Interviews** | one row per round, hangs off Opportunity | a transcript can hold several rounds (Tom's Quorra day = Elena + Priyesh) |
| **Review Queue** | anything that failed or is ambiguous | bad data never enters the main tables |

Full field lists and the design rationale are in [`docs/SETUP.md`](docs/SETUP.md).

---

## What happens when it can't parse a transcript

Failure is handled as a spectrum, not a single event:

1. **API failure** (timeout, rate limit) → the LLM node retries, then routes to the Review Queue. The run continues; one bad transcript doesn't stop the rest.
2. **Malformed / incomplete output** → JSON mode plus schema validation catch it before Airtable. Missing name, type, or date, or low confidence → Review Queue.
3. **Ambiguous identity** → record created but flagged for review, with the reason written down.
4. **Confident but wrong extraction** → the one case no automated check catches. Mitigated by prompt rules, temperature 0, and - most importantly - keeping identity decisions in deterministic code so a mis-read field can't cause a wrong merge.

**How you'd know before the client did:** every run posts a Slack summary (processed / created / flagged); the `Needs Review` view is the human queue; and a separate [`ATS Error Handler`](workflows/ATS%20Error%20Handler.json) workflow fires on any unhandled error and names the node that failed.

---

## Setup

See [`docs/SETUP.md`](docs/SETUP.md) for the full walkthrough. In short:

1. Create an empty Airtable base, grab the `app…` id.
2. Create a Personal Access Token (`data.records:read/write`, `schema.bases:read/write`) with the base added.
3. Run [`airtable/airtable_setup.py`](airtable/airtable_setup.py) to build all six tables and fields.
4. Import the two workflows from [`workflows/`](workflows/) into n8n, attach Airtable / OpenAI / Slack credentials, set the base id and Slack channel in the **Config** node.
5. Run the workflow and upload the transcripts.

---

## Tests

The identity logic is validated outside n8n, so it's checkable without burning API calls:

- [`tests/test_e2e.js`](tests/test_e2e.js) - all eight transcripts in date order; confirms 4 records, one Priya, two Davids, one flagged.
- [`tests/test_generalization.js`](tests/test_generalization.js) - unseen cases: a candidate who changes job *and* city, a name matching two existing people.
- [`tests/test_full.js`](tests/test_full.js) - date parsing across formats, and Airtable key stability.

```bash
node tests/test_e2e.js
```

---

## Known limitations / what I'd do next

- **Blocking is the weak link.** Matching blocks on exact surname, then scores within that. A married name or spelling variant misses the block entirely and creates a duplicate that *doesn't* get flagged - the one failure that escapes the flag-don't-merge safety net. Fix: a stable identifier (email/phone) as the primary match key, plus phonetic blocking. Blocking should be generous; matching should be conservative.
- **LLM adjudicator for the flagged band** - deterministic first, model only on cases it genuinely can't decide.
- **Companies is populated from opportunities only**, so it holds hiring companies; employers live as text history on the candidate. Would normalise both with a relationship type.
- **Concurrency guard** for automated high-frequency ingestion (a per-candidate lock), so two same-person transcripts can't race.
- **Timeline view** - the data model supports the journey; an Airtable interface would present it on one screen.
- **Summary labelling** - a flagged-new record is currently counted as "updated"; should read "created and flagged."
