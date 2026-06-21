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
