# CLAUDE.md

This is model-neutral project guidance. The filename remains `CLAUDE.md` for compatibility with existing tools and references; every AI collaborator must follow it. `AGENTS.md` is a discovery adapter only.

## What this repo is

Two independent components that ship via completely different mechanisms:

- **`edition-clean/`** — the Ghost theme for mindovermoney.ai (publishes the *Neural Gains Weekly* newsletter, *Founder's Corner*, and *Steal My Prompt*). Handlebars (`.hbs`) + committed compiled CSS/JS. A fork of Ghost's "Edition" theme.
- **`chat-agent/`** — a Cloudflare Worker that adds a RAG chat assistant to the site. Entirely separate infrastructure; it only *reads* Ghost content through the read-only Content API and never touches the theme or the Ghost site.

The theme and the worker are deployed and versioned independently. Changing one does not affect the other.

## Deploy model (important)

**Theme deployment is manual in this revision.** `.github/workflows/deploy-theme.yml` has only a `workflow_dispatch` trigger. Saving, pushing or merging source does not deploy once this workflow revision is on GitHub. Earlier revisions auto-deploy qualifying pushes to `main`/`master`; verify the actual remote workflow before pushing an older branch.

An explicitly approved manual run validates with gscan (`--fatal`), zips `edition-clean/`, and uploads it to Ghost via `TryGhost/action-deploy-theme` (secrets `GHOST_ADMIN_API_URL` / `GHOST_ADMIN_API_KEY`). Review the selected branch and exact artifact before running it. A commit or push approval does not authorize a workflow run. Theme deployment does not update Ghost routes, navigation or code injection; those are separately managed settings.

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

This repo belongs to the NGW dev ecosystem. Business context, strategy docs, and sibling projects (n8n research agent, Drive reorganization, podcast planning) live in the private `ngw-dev` repo. On Santosh's machine, `ngw-dev/WORKING_AGREEMENT.md` and `ngw-dev/context/ABOUT_SANTOSH.md` define the private cross-model working contract. Do not copy that private context here. This repository remains self-sufficient for public-repo safety, validation, and deployment boundaries.

### Neura eval: 4/9 → 9/9, SHIPPED 7.13.26

A QA eval harness runs 9 fixed questions against the live widget in three buckets — A: counts/inventory, B: recency/enumeration, C: topic questions (controls). Full harness spec: `Neura_Eval_Harness_Context_Doc_6.28.26.md` (mirrored in `ngw-dev/reference/`).

**Baseline 6.28.26: 4/9.** Buckets A and B failed wholesale — top-5 retrieval physically cannot see the full inventory, so "how many issues are on the site?" was unanswerable. Failure tag: architecture limit, not fabrication.

**Now 9/9 with Bucket C at 3/3** (measured 7.13.26 against the live Worker, version `b50594dc`). Two fixes got it there.

**1. Catalog-summary injection (7.12.26).** `src/ingest.js` renders a full inventory — totals, newest/oldest, every title with its date — into Workers KV on every index run; `src/index.js` injects it into the system prompt. Counts, dates and listings no longer depend on retrieval, because they are properties of the whole set and appear in the text of no single chunk. Took the score to 8/9.

**2. [ARCHIVE] marking of the retired positioning (7.13.26).** The last failure was C3 — *"What is a 10-Minute Win?"* — which was logged for two weeks as a hallucination. **It was not one.** Neural Gains Weekly launched with a personal-finance and investing lens and moved to AI education for professionals in early 2026. Five published Steal My Prompt volumes (1, 5, 6, 7, 20) publish the newsletter's own content-generation prompts, and those prompts still state the original framing — Vol. 7 defines the 10-Minute Win outright as *"a workflow for personal finance or investing beginners."* Retrieval surfaced those posts and the model repeated them, **faithfully**. It was quoting the corpus. The eval was measuring the content and blaming the model.

The posts stay published — they are accurate history. Instead, `ingest.js` judges each **post** against a retired-positioning pattern and stamps every chunk it produces; `index.js` prefixes those excerpts with an `[ARCHIVE]` note. Verified against all 124 posts: exactly those 5 flag, all 14 of their chunks carry the marker, no other post is touched.

**Two design rules worth keeping, both learned by getting them wrong first:**

- **Put the correction next to the evidence, not in a rule the model must remember.** A global "ignore that framing" line in the system prompt asks the model to hold an instruction while reading text that contradicts it. The `[ARCHIVE]` note travels *with* the excerpt, so the stale claim cannot be read without the correction.
- **Judge the post, not the chunk.** "This piece reflects the old framing" is a property of the piece. The positioning statement sits in the opening chunk, but later chunks carry finance examples with no such statement — judging each chunk on its own text leaves those unmarked. That is why the flag is computed at ingest, where the whole post is visible.

**When a control fails, the corpus is a suspect — not just the model.**

### Verifying deployed code matches committed code

The Worker deploys manually (`npx wrangler deploy` from `chat-agent/`), so committed and deployed code can drift. As of 7.13.26 they match: `795b295` was deployed as version `b50594dc` and the 9/9 eval was run against it. Re-confirm before patching code you have not verified is what is in production.

### Standing gotchas (already documented in this repo, do not relearn)

- Ghost 6 caps every Content API / `{{#get}}` query at 100 results regardless of `limit="all"`. Always paginate.
- Theme deployment requires an approved manual workflow run in this revision; the Worker separately requires `npx wrangler deploy`. Neither deployment follows automatically from a source commit.
- Re-index overwrites by deterministic chunk ID; shrinking posts can leave stale chunks until a full rebuild.
- The one external dependency that silently kills Neura is Anthropic API credit. Low-balance alert should be set in the Anthropic console.

### Deferred / parked (do not build unprompted)

- Instant indexing via Ghost publish webhook. `POST /ingest` is authenticated by the `x-ingest-secret` header; Ghost webhooks cannot send custom headers, so this needs a `?token=` query-param path added.
- Podcast/YouTube transcript ingestion (Phase 2). NOTE: the podcast is no longer deferred to 2027 — Season Zero was committed on 7.11.26 for September to late October 2026. Transcript ingestion remains parked regardless; do not build it unprompted.
- Learning-plans guided mode (Phase 3).
- Embedding upgrade to Voyage (only if retrieval quality demands it; Bucket C says it does not).
