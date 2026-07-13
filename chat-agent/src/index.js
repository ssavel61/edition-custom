// Mind Over Money RAG chat backend (Cloudflare Worker).
//
// Routes:
//   POST /chat    — answer a question using retrieved content (streamed, SSE)
//   POST /ingest  — re-index all content (requires x-ingest-secret header)
//   GET  /health  — liveness check
// Cron (see wrangler.toml) re-indexes daily.

import { ingestAll, CATALOG_KEY } from "./ingest.js";

const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
const CHAT_MODEL = "claude-haiku-4-5";
const TOP_K = 5;

// Answers are normally a few sentences, but "list every X" is a legitimate
// question now that the catalog is in the prompt, and a full section runs to
// 40+ titles. 700 tokens truncated those mid-list. Output is billed per token
// generated, so a generous ceiling costs nothing on the short answers.
const MAX_TOKENS = 4000;

const SYSTEM_PROMPT = `You are Neura, the AI assistant for Neural Gains Weekly — Santosh Savel's \
content engine that helps non-technical professionals build real skills with AI.

The content is organized as:
- Neural Gains Weekly: the flagship weekly issue, which includes segments like 10-Minute Win (a \
quick do-it-today workflow), AI Education (plain-English explainers of AI concepts), and Signals \
Over Noise (what actually matters in the week's AI news).
- Founder's Corner: short essays on building and leading with AI.
- Steal My Prompt: ready-to-use prompts, with the model and context needed to run them.
A podcast and YouTube are on the way.

Your job is to help readers quickly find and understand the most relevant pieces for their \
question.

You are given two sources, and they answer different kinds of questions:

- The CATALOG is the complete, authoritative inventory of everything published: how many pieces \
exist in each section, their titles, and when each one went out. Use it for questions about \
counts, dates, ordering, what is newest or first, and what exists. Answer those with confidence \
and give the actual number or the actual list — the whole set is in front of you, so do not hedge, \
do not guess, and do not say you cannot confirm a total.
- The EXCERPTS are the writing itself. Use them for questions about substance — what a piece says, \
where to start, how to do something. A title alone tells you a piece exists; it does not tell you \
what the piece says, so never describe content you have only seen a title for.

How to answer:
- Be brief. Lead with the answer in the first sentence. Keep it to a few short sentences or a \
short bulleted list. No preamble, no restating the question, no sign-off.
- Refer to pieces by section and title in plain language (e.g., "the Steal My Prompt on email \
threads," "this week's Signals Over Noise"). If neither the catalog nor the excerpts cover the \
question, say so in one line and suggest the closest related piece or browsing the archive at \
/archive/. Never invent facts, titles, or URLs.
- Do not list the catalog unless you are asked what exists. When you are asked to list, give the \
complete list, not a sample.
- Do NOT use bracketed citation markers like [1] or [2], and do not print URLs — the reader is \
already shown clickable source links below your answer.
- Warm, direct, plain English. No jargon, no hype, no filler.`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }), env);
    }
    if (url.pathname === "/health") {
      return cors(new Response("ok"), env);
    }
    if (url.pathname === "/chat" && request.method === "POST") {
      return cors(await handleChat(request, env), env);
    }
    if (url.pathname === "/ingest" && request.method === "POST") {
      return cors(await handleIngest(request, env), env);
    }
    return cors(new Response("Not found", { status: 404 }), env);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(ingestAll(env));
  },
};

async function handleChat(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) return json({ error: "no_user_message" }, 400);
  const query = String(lastUser.content || "").slice(0, 2000);

  // 1. Embed the question.
  const embedding = await env.AI.run(EMBEDDING_MODEL, { text: query });
  const vector = embedding.data[0];

  // 2. Retrieve the most relevant chunks.
  const result = await env.VECTORIZE.query(vector, {
    topK: TOP_K,
    returnMetadata: true,
  });
  const matches = result.matches || [];

  // Existing vectors may still carry the old "Newsletter" label; present it as
  // the flagship brand until the next re-index refreshes the stored metadata.
  const sectionOf = (m) =>
    m.metadata.type === "Newsletter" ? "Neural Gains Weekly" : m.metadata.type;

  const contextBlocks = matches
    .map(
      (m) =>
        `## ${m.metadata.title} (${sectionOf(m)})\n` +
        String(m.metadata.text || "").slice(0, 1100),
    )
    .join("\n\n");

  // De-duplicate sources by URL for the citation list shown to the reader.
  const seen = new Set();
  const sources = [];
  for (const m of matches) {
    const u = m.metadata.url;
    if (!seen.has(u)) {
      seen.add(u);
      sources.push({ title: m.metadata.title, url: u, type: sectionOf(m) });
    }
  }

  // 3. Load the catalog written by the last index run. A miss (before the first
  // ingest, or a KV hiccup) simply omits the block — chat still answers topic
  // questions from the excerpts, exactly as it did before the catalog existed.
  let catalog = null;
  try {
    catalog = await env.CATALOG.get(CATALOG_KEY);
  } catch {
    catalog = null;
  }

  // 4. Ask Claude, streaming the answer back. The static prompt and the catalog
  // are both stable between questions, so the per-question excerpts go last.
  const anthropicMessages = messages.slice(-10).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content || ""),
  }));

  const system = [
    { type: "text", text: SYSTEM_PROMPT },
    ...(catalog
      ? [{ type: "text", text: catalog, cache_control: { type: "ephemeral" } }]
      : []),
    {
      type: "text",
      text:
        "Excerpts from Mind Over Money to answer from:\n\n" +
        (contextBlocks || "No relevant content was found."),
    },
  ];

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      max_tokens: MAX_TOKENS,
      stream: true,
      system,
      messages: anthropicMessages,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    return json({ error: "llm_error", detail: await upstream.text() }, 502);
  }

  return new Response(relaySSE(upstream.body, sources), {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
    },
  });
}

// Translate Anthropic's SSE stream into a simpler one for the browser:
//   event: sources  → the cited posts (sent first)
//   event: token    → one chunk of answer text
//   event: done     → end of answer
function relaySSE(upstreamBody, sources) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";

  return new ReadableStream({
    async start(controller) {
      controller.enqueue(
        encoder.encode(`event: sources\ndata: ${JSON.stringify(sources)}\n\n`),
      );

      const reader = upstreamBody.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let nl;
          while ((nl = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data) continue;
            try {
              const evt = JSON.parse(data);
              if (
                evt.type === "content_block_delta" &&
                evt.delta &&
                evt.delta.type === "text_delta"
              ) {
                controller.enqueue(
                  encoder.encode(
                    `event: token\ndata: ${JSON.stringify(evt.delta.text)}\n\n`,
                  ),
                );
              }
            } catch {
              // ignore keep-alives / non-JSON lines
            }
          }
        }
      } catch (e) {
        controller.enqueue(
          encoder.encode(`event: error\ndata: ${JSON.stringify(String(e))}\n\n`),
        );
      }
      controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
      controller.close();
    },
  });
}

async function handleIngest(request, env) {
  if (request.headers.get("x-ingest-secret") !== env.INGEST_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }
  try {
    return json(await ingestAll(env));
  } catch (e) {
    return json({ error: "ingest_failed", detail: String(e) }, 500);
  }
}

// --- helpers ---

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function cors(response, env) {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", env.ALLOWED_ORIGIN || "*");
  headers.set("access-control-allow-methods", "POST, GET, OPTIONS");
  headers.set("access-control-allow-headers", "content-type, x-ingest-secret");
  return new Response(response.body, { status: response.status, headers });
}
