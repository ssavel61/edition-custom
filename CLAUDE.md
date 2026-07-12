# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Two independent components that ship via completely different mechanisms:

- **`edition-clean/`** — the Ghost theme for mindovermoney.ai (publishes the *Neural Gains Weekly* newsletter, *Founder's Corner*, and *Steal My Prompt*). Handlebars (`.hbs`) + committed compiled CSS/JS. A fork of Ghost's "Edition" theme.
- **`chat-agent/`** — a Cloudflare Worker that adds a RAG chat assistant to the site. Entirely separate infrastructure; it only *reads* Ghost content through the read-only Content API and never touches the theme or the Ghost site.

The theme and the worker are deployed and versioned independently. Changing one does not affect the other.

## Deploy model (important)

**Pushing to `main` auto-deploys the theme to the LIVE site.** `.github/workflows/deploy-theme.yml` triggers on pushes to `main`/`master` that touch `edition-clean/**`, validates with gscan (`--fatal`), zips `edition-clean/`, and uploads it to Ghost via `TryGhost/action-deploy-theme` (secrets `GHOST_ADMIN_API_URL` / `GHOST_ADMIN_API_KEY`). Feature branches do **not** deploy. Develop on a branch; merging to `main` is what goes live.

- **CI does not run a build step.** The workflow zips `edition-clean/` *as-is*, so whatever is committed under `edition-clean/assets/built/` is what ships. Editing a `.hbs` template is sufficient on its own. Changing the theme's source CSS/JS requires rebuilding locally (`cd edition-clean && npx gulp build`) and committing the regenerated `assets/built/*`. To avoid that round-trip, the custom page templates (`archive.hbs`, the chat widget, etc.) carry their styling in inline `<style>` blocks rather than the compiled stylesheet.
- Bump `edition-clean/package.json` `version` on meaningful theme changes (matches the existing commit history).
- The `chat-agent/` directory sits *outside* `edition-clean/`, so it is never included in the theme zip.

## Ghost 6 gotcha: the 100-result cap

Ghost 6 caps **every** `{{#get}}` query and Content API request at 100 results — `limit="all"` is silently truncated to 100. This recurs across the codebase; the fix is always to paginate:

- Templates: emit multiple `{{#get "posts" limit="100" page="N" ...}}` blocks (see `edition-clean/archive.hbs`, which renders an `archive-item` partial across pages 1–5).
- Worker ingestion: loop Content API `page=1,2,…` until a page returns `< 100` (see `chat-agent/src/ingest.js`).

## Theme architecture

- `default.hbs` is the site layout (header/footer/`{{{body}}}`); custom page templates render into it.
- Curated landing pages (`archive.hbs`, `founders-corner.hbs`, `prompt-library.hbs`) each pull an editable Ghost **Page** by slug via `{{#get "pages" filter="slug:..."}}` and render its title/body alongside a programmatic post list — so the copy is editable in Ghost Admin while the layout lives in the theme.
- **Content types are derived from internal tags**, not separate collections: tag slug `hash-founders-corner` → Founder's Corner, `hash-prompt-library` → Steal My Prompt, everything else → Newsletter. Client-side filter buttons (e.g. on `archive.hbs`) match on these slugs.
- Brand colors: dark `#2c353c`, teal accent `#8abfc5`.

## chat-agent architecture (RAG)

A single Cloudflare Worker (`chat-agent/`, deploy with `npx wrangler deploy`):

- `src/index.js` — routes: `POST /chat` (embed question → Vectorize search → Claude Haiku 4.5 answer, streamed back as SSE with cited sources), `POST /ingest` (auth'd via `x-ingest-secret`), and a daily cron — both run the ingest pipeline.
- `src/ingest.js` — Ghost Content API → chunk → embed (Workers AI `@cf/baai/bge-base-en-v1.5`, 768-dim) → upsert to Vectorize. Vector index must be created at 768 dims / cosine.
- Bindings (`wrangler.toml`): `VECTORIZE`, `AI`. Secrets (set via `wrangler secret put`, never committed): `ANTHROPIC_API_KEY`, `GHOST_CONTENT_API_KEY`, `INGEST_SECRET`.
- The Worker calls the Anthropic Messages API over raw `fetch` (no SDK dependency) using model `claude-haiku-4-5`.
- The site widget is `edition-clean/partials/chat-widget.hbs`, included from `default.hbs`. It is **inert until `CHAT_ENDPOINT` is set** to the deployed Worker's `/chat` URL — safe to ship before the backend exists.

See `chat-agent/README.md` for the full Cloudflare setup/deploy walkthrough.

## Commands

Theme (`edition-clean/`):
- `npx gscan edition-clean` — validate against Ghost (CI runs this with `--fatal`).
- `cd edition-clean && npx gulp build` — rebuild compiled CSS/JS into `assets/built/` (only needed when changing source styles, not templates).
- `cd edition-clean && npx gulp zip` — produce an uploadable theme zip.

Worker (`chat-agent/`):
- `cd chat-agent && npm install` — install wrangler.
- `npx wrangler dev` — run locally; `npx wrangler deploy` — deploy; `npx wrangler tail` — stream live logs (use this to debug a deployed Worker).

---

## ⚠️ THIS REPOSITORY IS PUBLIC

Everything committed here — code, comments, commit messages, docs — is visible to the open internet and permanently recorded in git history. Before writing anything to this repo:

- **NEVER** commit API keys, tokens, secrets, or credentials. Worker secrets live in `wrangler secret`, never in the repo.
- **NEVER** name Santosh's employer. Not in code, comments, commits, docs, or examples — and not even to restate this rule. Healthcare examples stay industry-general.
- Business strategy, subscriber data, and private context live in the **private** `ngw-dev` repo. Do not mirror them here.
- Sibling projects (`n8n`, `drive-reorg`, `podcast`) and the NGW operating docs are private. Reference them by name only.

## Current state and open work (as of 7.11.26)

### Owner context

This repo belongs to the NGW dev ecosystem. Business context, strategy docs, and sibling projects (n8n research agent, Drive reorganization, podcast planning) live in the private `ngw-dev` repo. Read `ngw-dev/CLAUDE.md` for how to work with Santosh: sequential approval gates, one question at a time, plan mode before non-trivial changes, no deploys without explicit approval, receipts before claims.

### First-session verification (do this before any Neura work)

The Worker deploys manually (`npx wrangler deploy` from `chat-agent/`), so committed code and deployed code can drift. Before editing anything, verify they match: pull the deployed Worker with `npx wrangler versions` / dashboard comparison or redeploy from a clean checkout and confirm behavior is unchanged via `/health` and one test chat. Record the result. Do not patch code you have not confirmed is the code in production.

**Status: QUEUED, not yet run.** This is the first task of the Neura fix session (target ~7.25.26). It was explicitly deferred out of the 7.11.26 architecture session.

### Neura eval baseline (measured 6.28.26)

A QA eval harness runs 9 fixed questions against the live widget in three buckets. Full harness spec: `Neura_Eval_Harness_Context_Doc_6.28.26.md` (mirrored in `ngw-dev/reference/`).

- **Baseline score: 4/9.**
- **Bucket A (counts/inventory, 3 questions): fails.** "How many issues are on the site?" Top-5 retrieval physically cannot see the full inventory. Failure tag: architecture limit, not fabrication. Neura hedging honestly is correct behavior against a real product gap.
- **Bucket B (recency/enumeration/superlative, 3 questions): fails** for the same reason. "List all Steal My Prompt titles" returns ~5 of ~38.
- **Bucket C (topic questions, 3 questions): passes.** These are controls. Any fix MUST NOT regress Bucket C.

### The planned fix: catalog-summary injection

**Design intent:** at ingest time (`src/ingest.js` already paginates every post), compute a compact catalog summary: total post count, count per content type, full title list per type with publish dates, newest and oldest post per type. Persist it (Workers KV is the expected store; decide in-session). At query time (`src/index.js`, `/chat` handler), inject the summary into the system prompt alongside retrieved chunks. Counts and "latest" answers then come from the catalog, not from retrieval.

**Constraints:**
- The summary must refresh on every ingest run (daily cron and manual `POST /ingest`) so it never goes stale relative to the index.
- Watch prompt size: full title lists for ~115 posts are fine today; note the growth ceiling in a code comment.
- No behavior change to Bucket C answering. Retrieved-chunk flow stays untouched.

**Acceptance criteria (receipts required):**
1. Re-run the eval harness after deploy. Bucket A converts to specific, correct figures (hedges = fail). Bucket B names the correct latest issue and Vol 1, and lists all SMP titles.
2. Bucket C remains 3/3.
3. Before/after scores recorded in a dated eval report (`Neura_Eval_Report_MM.DD.YY.md`) and pasted into the build log receipts section.
4. Target: 9/9. Anything at or above 8/9 with Bucket C intact is shippable; log the miss.

### Standing gotchas (already documented in this repo, do not relearn)

- Ghost 6 caps every Content API / `{{#get}}` query at 100 results regardless of `limit="all"`. Always paginate.
- Theme auto-deploys on push to `main`; the Worker does NOT. Backend changes require manual `npx wrangler deploy`.
- Re-index overwrites by deterministic chunk ID; shrinking posts can leave stale chunks until a full rebuild.
- The one external dependency that silently kills Neura is Anthropic API credit. Low-balance alert should be set in the Anthropic console.

### Deferred / parked (do not build unprompted)

- Instant indexing via Ghost publish webhook. `POST /ingest` is authenticated by the `x-ingest-secret` header; Ghost webhooks cannot send custom headers, so this needs a `?token=` query-param path added.
- Podcast/YouTube transcript ingestion (Phase 2). NOTE: the podcast is no longer deferred to 2027 — Season Zero was committed on 7.11.26 for September to late October 2026. Transcript ingestion remains parked regardless; do not build it unprompted.
- Learning-plans guided mode (Phase 3).
- Embedding upgrade to Voyage (only if retrieval quality demands it; Bucket C says it does not).
