# Workflows

Two n8n workflows. Import both via **Workflows → Import from File**.

### `Transcript to ATS V1.json`
The main pipeline. Upload transcripts → extract → validate → resolve identity → upsert to Airtable → Slack summary.

After importing, open the **Config** node and set:
- `airtableBaseId` - your `app…` base id
- `slackChannelId` - a real `C…` channel id (the Slack node needs the id, not `#name`)

Then attach credentials:
- **Airtable Personal Access Token** on all six HTTP Request nodes (Search + five upserts)
- **OpenAI** on *Extract Structured Data*
- **Slack** on *Notify Run Summary* (deactivate it and *Alert Slack* if you're not using Slack)

### `ATS Error Handler.json`
Fires on any unhandled failure in the main workflow and posts an alert to Slack naming the node that broke.

After importing: activate it, then in the main workflow go to **Settings → Error Workflow** and select it. Set the **Alert Slack** node's channel to your `#belo-error-handler` channel id and invite the bot to it.

### Two Slack channels, on purpose
Routine reporting and alarms are kept apart:
- **`#belo-ats`** - the run summary the main workflow posts every run (set via `slackChannelId` in the main workflow's **Config** node).
- **`#belo-error-handler`** - unhandled-failure alerts from this error handler (set on its **Alert Slack** node).

So the everyday "N created / N flagged" noise doesn't bury a real failure alert.

> Credential ids in the exported JSON are placeholders. n8n lets you pick the real credential per node after import - nothing sensitive is committed.
