# edition-custom

Source for [mindovermoney.ai](https://www.mindovermoney.ai), home of the Neural Gains Weekly newsletter and the Explore AI Out Loud podcast. It has two parts: a customized Ghost theme and Neura, the site's RAG chat agent.

| Folder | What it is |
| --- | --- |
| [`edition-clean/`](edition-clean/) | Ghost theme based on Ghost's open-source [Edition](https://github.com/TryGhost/Edition) theme, with custom templates for the archive, Founder's Corner, the prompt library, the podcast hub, and newsletter signup |
| [`chat-agent/`](chat-agent/) | Neura, a Cloudflare Worker that answers reader questions from the published archive and approved podcast transcripts, and cites its sources |

## How Neura works

    browser widget ──▶ Worker /chat ──▶ embed question (Workers AI, bge-base-en-v1.5)
                                     ──▶ search (Vectorize)
                                     ──▶ answer + sources (Claude Haiku 4.5, streamed)

    daily cron / POST /ingest ──▶ Ghost Content API ──▶ chunk ──▶ embed ──▶ Vectorize

- Counts, dates, and post listings are answered from a catalog in Workers KV instead of retrieval, because no single chunk contains them.
- Older posts that state a retired positioning stay published, but ingest stamps them as archive. The model reads the correction next to the stale claim.
- Secrets are set with `wrangler secret put` and never committed.

Setup steps are in [`chat-agent/README.md`](chat-agent/README.md). Run the tests with:

```bash
node --test chat-agent/test/*.test.mjs
```

## Deployment

Theme deploys run only through a manually triggered GitHub Actions workflow, so a push never changes the live site. The Worker deploys separately with `npx wrangler deploy`.

## License

MIT. See [`LICENSE`](LICENSE). The theme in `edition-clean/` is derived from Ghost's Edition theme, which is MIT licensed by the Ghost Foundation, and its original notice is kept in [`edition-clean/LICENSE`](edition-clean/LICENSE).
