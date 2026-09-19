# Mind Over Money — RAG Chat Backend

A Cloudflare Worker that powers the on-site chat agent. It pulls your Ghost
content, embeds it into a vector database, and answers reader questions with
Claude Haiku 4.5 — citing and linking the source posts.

```
browser widget ──▶ Worker /chat ──▶ embed question (Workers AI)
                                  ──▶ search (Vectorize)
                                  ──▶ answer + sources (Claude Haiku 4.5, streamed)

cron / POST /ingest ──▶ Ghost Content API ──▶ chunk ──▶ embed ──▶ Vectorize
```

## What you need

- A **Cloudflare account** (free tier is fine to start).
- An **Anthropic API key** — https://console.anthropic.com → API Keys.
- A **Ghost Content API key** — Ghost Admin → Settings → Integrations →
  "Add custom integration" → copy the **Content API Key**.

## One-time setup

```bash
cd chat-agent
npm install                 # installs wrangler (the Cloudflare CLI)
npx wrangler login          # opens a browser to connect your Cloudflare account

# Create the vector index (768 dims matches the bge embedding model):
npx wrangler vectorize create mindovermoney-content --dimensions=768 --metric=cosine

# Store your secrets (you'll be prompted to paste each value):
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put GHOST_CONTENT_API_KEY
npx wrangler secret put INGEST_SECRET     # invent any long random string
```

## Deploy

```bash
npx wrangler deploy
```

Wrangler prints your Worker URL, e.g.
`https://mindovermoney-chat.<your-subdomain>.workers.dev`.

## Index your content (first run)

The cron re-indexes daily, but kick off the first build manually:

```bash
curl -X POST https://mindovermoney-chat.<your-subdomain>.workers.dev/ingest \
  -H "x-ingest-secret: <the INGEST_SECRET you set>"
# → {"posts":N,"chunks":M,"indexed_at":"..."}
```

## Connect the website

Open `edition-clean/partials/chat-widget.hbs` in this repo and paste your
Worker's chat URL into `CHAT_ENDPOINT`:

```js
var CHAT_ENDPOINT = "https://mindovermoney-chat.<your-subdomain>.workers.dev/chat";
```

Theme deployment is a separately approved manual workflow. A commit or push does not deploy the theme.
(While `CHAT_ENDPOINT` is empty the widget stays hidden, so the theme is safe
to ship before the Worker exists.)

## Re-indexing on publish (optional but recommended)

So new posts appear in chat within seconds instead of next-day:

Ghost Admin → Settings → Integrations → your integration → **Add webhook**
- Event: **Post published**
- Target URL: `https://mindovermoney-chat.<your-subdomain>.workers.dev/ingest`

> Note: Ghost webhooks can't send the `x-ingest-secret` header. Either rely on
> the daily cron, or add a `?token=` query check to `/ingest` if you want
> webhook-triggered indexing — ask and I'll wire it up.

## Costs (rough)

At low traffic this runs within Cloudflare's free tier for Workers, Vectorize,
and Workers AI. Each chat is a Claude Haiku 4.5 call (~$1 / 1M input,
~$5 / 1M output tokens) — typically well under a cent per conversation.

## Files

| File | Purpose |
|---|---|
| `wrangler.toml` | Worker config: bindings, vars, cron |
| `src/index.js` | HTTP routes + streaming chat handler |
| `src/ingest.js` | Ghost → chunk → embed → Vectorize pipeline |


## Approved episode transcripts

Neura can answer questions about released podcast episodes using privately ingested program transcripts. It does not publish transcript files or offer a transcript-download route. The theme is unchanged.

- `src/episodes.js` binds each transcript hash and final-media hash to an approved episode/video identity. The deployment-controlled `EPISODE_RELEASES` manifest is maintained privately, outside this public repository. `keep_vars = true` preserves the current manifest on ordinary code deployments; an absent manifest disables episode intake and retrieval. Never overwrite that authority with a sample during deployment.
- `EPISODE_CATALOG` is an HTTP service binding to the existing public episode catalog. Same-account workers.dev calls need that binding. Unavailable or withdrawn releases cannot supply episode evidence.
- `POST /episode-ingest` and `POST /episode-verify` require `x-ingest-secret` matching the separate `EPISODE_INGEST_SECRET`. The original `INGEST_SECRET` remains scoped to article ingestion. Keep both values out of source, command arguments, logs and chat.
- Import while the exact revision is disabled. Verify every expected vector ID, namespace and text hash, then similarity-query readiness. Enable only that verified revision. Vector reads use batches of 20. Mutations are asynchronous, so upload acknowledgement alone is not activation proof.
- Specific episode questions combine semantic similarity and subject-word matching within approved revision namespaces. Missing episodes abstain instead of substituting old announcements. Full-transcript requests are refused.
- Existing articles stay in the default namespace (omit `namespace`; an empty string is distinct). Metadata mode is `all`. The daily article cron preserves separate episode readiness keys.
- Program-only coverage excludes opening/closing narration. Citations point to the public video; timestamps are not asserted. Corrected or withdrawn revisions are excluded logically; physical cleanup of old vectors needs an explicit exact-ID operation. Model refusal is not an absolute guarantee against reconstruction through repeated questions.

For another episode, approve its delivered transcript and media identity, update private authority disabled, import, verify, enable and run scoped acceptance checks. Website publication does not automatically ingest a transcript.

Local checks: `npm test` (mocked providers; no live model calls). Deployment, transcript transfer and paid live checks require their own authorized scope. Capture the previous Worker version before deployment for rollback. Operational approvals and live receipts belong in private project records.


## Show navigation links

`src/directory.js` serves common “where can I watch/listen/follow?” questions directly from the curated show directory, before model calls. Keep these show-level links aligned with the published podcast hub. Navigation SSE sources carry `kind: navigation`; the widget renders six links under “Links”, while ordinary article sources keep the four-link limit. This feature requires coordinated Worker and widget deployment. Validate both components and keep their rollback versions separately.
