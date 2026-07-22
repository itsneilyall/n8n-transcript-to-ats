# Belo Technical Assessment - Transcript → ATS

Transcript in, structured relational candidate data in Airtable. n8n + GPT-4o + Airtable REST API.

---

## 1. Airtable schema

Six tables. **The primary field of each table must be the key column named below** - Airtable resolves linked records by primary field, so the primary field has to be unique. That constraint is what forces `Candidate Key` (a slug) to be primary on Candidates rather than `Full Name`: the sample data contains two different people both called David Chen.

### Candidates - latest state, one row per human

| Field | Type | Notes |
|---|---|---|
| **Candidate Key** | Single line text | **PRIMARY.** e.g. `raghavan-priyanka-xf5gd6` |
| Full Name | Single line text | |
| Preferred Name | Single line text | Priya |
| First Name Key | Single line text | normalised, used for matching |
| Surname Key | Single line text | normalised, **the lookup key** |
| Aliases | Single line text | comma-separated; Priyanka, Priya |
| Current Role | Single line text | |
| Current Company | Single line text | |
| Company History | Long text | comma-separated, cumulative - the match signal |
| Seniority | Single select | SDR, AE, Senior AE, Enterprise AE, Lead, Director, VP, CRO, Other |
| Location | Single line text | |
| Preferred Location | Single line text | |
| Remote Preference | Single line text | |
| Current Base / Current OTE | Number (integer) | GBP |
| Desired Base / Desired OTE | Number (integer) | GBP |
| Equity Importance | Single select | Low, Medium, High |
| Skills | Multiple select | |
| Methodologies | Multiple select | MEDDIC, Command of the Message |
| Languages | Multiple select | |
| Preferred Industries | Multiple select | |
| Tags | Multiple select | the 3 - 4 tags the brief asks for |
| Education | Single line text | |
| Career Goal | Long text | |
| Timing Constraints | Single line text | |
| Last Conversation Date | Date | staleness guard |
| Needs Review | Checkbox | **the human queue** |
| Review Reason | Long text | |
| Match Score | Number | |
| Match Signals | Long text | audit trail for the merge decision |
| Conversations | Link → Conversations | auto-created by the reverse link |
| Opportunities | Link → Opportunities | auto-created |

> Leave every single-select and multiple-select **with no options defined**. The API calls use `typecast: true`, which creates options on the fly.

### Conversations - immutable log, one row per transcript

| Field | Type |
|---|---|
| **Conversation ID** | Single line text - **PRIMARY**, deterministic hash |
| Candidate | Link → Candidates |
| Title | Single line text |
| Date | Date |
| Type | Single select - First Call, Catch-up, Interview Prep, Client Feedback, Offer Discussion, Other |
| Source Type | Single select - Candidate, Client, Internal |
| Recruiter | Single line text |
| Participants | Single line text |
| Duration | Single line text |
| Summary | Long text |
| Sentiment | Single select |
| Next Action | Long text |
| Confidential | Checkbox |
| File Name | Single line text |
| Extraction Confidence | Number (decimal) |
| Unclear | Long text |
| Raw Transcript | Long text |
| Base At Time / OTE At Time / Desired Base At Time / Desired OTE At Time | Number |
| Role At Time / Company At Time / Location At Time | Single line text |

The `* At Time` fields are the point that ChatGPT's design missed: **comp is a time series, not a scalar.** Priya goes 70/140 → 82/155, and her ask goes 85/170 → 95/180. Candidates holds *current*; Conversations holds the trajectory. That's what makes "come back in six months and understand the journey" actually work.

### Companies

| Field | Type |
|---|---|
| **Company Name** | Single line text - **PRIMARY** |
| Industry | Single line text |
| Relationship | Single select - Current Employer, Previous Employer, Hiring Company, Mentioned |

Created automatically via `typecast` when an Opportunity links to it.

### Opportunities - one row per candidate × company × role

| Field | Type |
|---|---|
| **Opportunity Key** | Single line text - **PRIMARY** |
| Candidate | Link → Candidates |
| Company Hiring | Link → Companies |
| Role | Single line text |
| Stage | Single select |
| Status | Single select |
| Base / OTE | Number |
| Equity | Single line text |
| Recruiter Notes | Long text |
| Last Updated | Date |
| Interviews | Link → Interviews (auto) |

### Interviews - hangs off Opportunity, not Candidate

| Field | Type |
|---|---|
| **Interview Key** | Single line text - **PRIMARY** |
| Opportunity | Link → Opportunities |
| Date | Date |
| Stage | Single line text |
| Interviewer | Single line text |
| Outcome | Single line text |
| Strengths / Weaknesses / Feedback | Long text |
| Source Conversation | Link → Conversations |

Transcript 7 (Sam ↔ Rachel Osei) is a **client** call about Priya, not a call with Priya. It writes an Interview record and a Conversation with `Source Type = Client`. It must not overwrite Priya's self-reported profile. That's why `source_type` exists.

### Review Queue

| Field | Type |
|---|---|
| **Conversation ID** | Single line text - **PRIMARY** |
| File Name / Title | Single line text |
| Date | Date |
| Stage | Single select - Extraction, Validation |
| Reason | Long text |
| Raw Transcript | Long text |
| Status | Single select - Open, Resolved |

Then add a **grid view on Candidates filtered to `Needs Review` is checked**. That's the first thing a reviewer should see when they open the base.

---

## 2. Import

1. `Transcript to ATS V1.json` → n8n → Import from File.
2. `ATS Error Handler.json` → import, save, copy its workflow ID.
3. Main workflow → Settings → Error Workflow → pick the error handler.
4. Credentials to attach:
 - **Airtable Personal Access Token** (`airtableTokenApi`) - scopes `data.records:read`, `data.records:write`, `schema.bases:read`; grant access to the base.
 - **OpenAI** (`openAiApi`).
 - **Slack** (`slackApi`) - optional; if you skip it, disable *Notify Run Summary* and *Alert Slack*.
5. Open the **Config** node and set:
 - `airtableBaseId` → your `app…` id (from the base URL)
 - `transcriptsPath` → `/data/transcripts/*.txt`
 - `slackChannelId` → a real `C…` id (Slack node requires the ID, not `#name`)
 - `mergeThreshold` 70 / `reviewThreshold` 40 - leave unless you want to see the bands move
6. Put the eight `.txt` files where n8n can read them. On Railway, mount a volume at `/data` and upload, or swap *Read Transcript Files* for a Form Trigger with file upload if the filesystem is awkward.
7. Execute. Expect: **5 candidates created, 3 updated** - with **David Chen (Arden Cyber) flagged for review** as a name collision.

---

## 3. The two decisions worth defending

**Identity resolution, not name matching.** The sample data contains both failure modes on purpose:

- *Priyanka Raghavan* / *Priya Raghavan* → **same person, two names.** Normalising the string never turns "priya" into "priyanka".
- *David Chen* (Fentra, mid-market AE, London, Econ @ Nottingham) / *David Chen* (Arden Cyber, VP Sales, Edinburgh, 44, ex-Sophos) → **two people, one name.** Their tenures overlap; one man cannot be at Fentra three years and Arden five.

So `Resolve Identity` blocks on surname and scores a composite: first-name/alias (+40 exact, +30 prefix), shared employer history (+30, +20 for two or more), location (+15), and **−40 for a different city with zero shared employers**. ≥70 merges. 40 - 69 creates a new record and flags it. Below 40 creates cleanly - unless the full name collides exactly, in which case it *still* flags, because a human should confirm that.

Priya scores **80** → merge. The second David scores **0** → separate record, flagged, with the reasoning written into `Review Reason`.

**Flag, don't merge.** Wrongly merging two humans is unrecoverable - you can't tell whose history is whose afterwards. A flagged duplicate costs a recruiter thirty seconds. Asymmetric cost, so the default is conservative.

**Ordering.** Transcripts are sorted **date ascending** and processed **one at a time** (batch size 1). Candidates holds latest state; process in file order and March overwrites July. Process in parallel and two transcripts for the same person race on the lookup and create duplicates. Plus a staleness guard: if a transcript is older than `Last Conversation Date`, the conversation is still logged but the profile state is left alone.

**Idempotency.** Every table upserts on a deterministic key via `PATCH … performUpsert`. Run it ten times, get one set of records, which makes re-runs and retries safe.

---

## 4. What happens when a transcript can't be parsed, and how you'd know

1. GPT-4o at temperature 0 in JSON mode, retried twice. On final failure the node's **error output** routes to the Review Queue - one bad transcript does not stop the other seven.
2. `Validate & Normalize` schema-checks before anything touches Airtable: no name, no conversation type, no role *and* no company, or self-reported confidence < 0.5 → Review Queue.
3. Ambiguous identity → record created but `Needs Review` checked, with the score and signals written down.
4. **Every run posts a Slack summary** - N processed / created / updated / to review / flagged, per-transcript. Silence is the alarm.
5. A separate **Error Trigger** workflow catches anything unhandled and names the node that blew up.

The base itself is the monitoring surface: the `Needs Review` view is where a human looks.

---

## 5. What I'd do next (ran out of the 2 - 3 hours)

- **LLM adjudicator for the 40 - 69 band.** The deterministic scorer is auditable and cheap, which is why it's the first pass, but the grey zone should get a second opinion: hand the existing record and the new transcript to a model and ask "same person?" with a rationale. Deterministic first, LLM only where it's ambiguous.
- **Cumulative Company History union server-side.** Right now each transcript writes the history it knows; a merge should union with what's already in Airtable rather than replace.
- **Conflict detection.** When July says the company is "Nexa Health" and March said "Nexler", that's a rename, not a contradiction - but the system can't tell yet. Worth surfacing field-level diffs on merge.
- **Candidate timeline view:** an Airtable interface showing a candidate's conversations, opportunities, and interviews on one page, in date order. The data model supports it; I didn't build the view in the time available.
