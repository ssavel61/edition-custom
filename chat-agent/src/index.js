// Mind Over Money RAG chat backend (Cloudflare Worker).
//
// Routes:
//   POST /chat    — answer a question using retrieved content (streamed, SSE)
//   POST /ingest  — re-index all content (requires x-ingest-secret header)
//   GET  /health  — liveness check
// Cron (see wrangler.toml) re-indexes daily.

import { ingestAll } from "./ingest.js";

const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
const CHAT_MODEL = "claude-haiku-4-5";
const TOP_K = 6;

const SYSTEM_PROMPT = `You are the guide for "Mind Over Money" by Santosh Savel — a body of work \
about applying AI in real life and business, published as the Neural Gains Weekly newsletter, \
Founder's Corner essays, and the "Steal My Prompt" series.

Your job is to help readers find and understand the most relevant content for their question, \
so they don't have to search manually. You can recommend pieces to read, summarize ideas across \
them, and assemble simple learning paths from the material.

Rules:
- Answer ONLY from the retrieved excerpts provided in the context. Do not invent facts, titles, \
or URLs.
- When you reference a piece, cite it inline like [1], [2] matching the numbered excerpts, and \
weave in its title.
- If the excerpts don't cover the question, say so plainly and suggest the closest related \
content or browsing the archive at /archive/. Never fabricate an answer.
- Be warm, concise, and practical. Short paragraphs. Get to the recommendation quickly.`;

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

  const contextBlocks = matches
    .map(
      (m, i) =>
        `[${i + 1}] ${m.metadata.title} (${m.metadata.type})\n` +
        `URL: ${m.metadata.url}\n${m.metadata.text}`,
    )
    .join("\n\n---\n\n");

  // De-duplicate sources by URL for the citation list shown to the reader.
  const seen = new Set();
  const sources = [];
  for (const m of matches) {
    const u = m.metadata.url;
    if (!seen.has(u)) {
      seen.add(u);
      sources.push({ title: m.metadata.title, url: u, type: m.metadata.type });
    }
  }

  // 3. Ask Claude, streaming the answer back.
  const anthropicMessages = messages.slice(-10).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content || ""),
  }));

  const system = [
    { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    {
      type: "text",
      text:
        "Retrieved excerpts for this question (cite as [1], [2], …):\n\n" +
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
      max_tokens: 1024,
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
