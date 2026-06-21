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

Commit + push; the theme auto-deploys and the chat bubble appears on the site.
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
