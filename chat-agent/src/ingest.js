// Ingestion pipeline: pull posts from the Ghost Content API, split them into
// chunks, embed each chunk with Workers AI, and upsert the vectors into
// Vectorize. Runs on a daily cron and on demand via the authenticated
// POST /ingest endpoint (see index.js).

const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5"; // 768-dimensional embeddings

export async function ingestAll(env) {
  const posts = await fetchAllPosts(env);

  // Flatten every post into chunk records.
  const records = [];
  for (const post of posts) {
    const chunks = chunkText(post.plaintext || "");
    chunks.forEach((text, index) => records.push({ post, index, text }));
  }

  // Embed and upsert in batches. bge handles arrays of text in one call.
  const BATCH = 50;
  let indexed = 0;
  for (let i = 0; i < records.length; i += BATCH) {
    const slice = records.slice(i, i + BATCH);
    const embedding = await env.AI.run(EMBEDDING_MODEL, {
      // Prefix each chunk with its title so the embedding captures topic context.
      text: slice.map((r) => `${r.post.title}\n\n${r.text}`),
    });

    const vectors = slice.map((r, j) => ({
      id: `${r.post.id}-${r.index}`,
      values: embedding.data[j],
      metadata: {
        title: r.post.title,
        url: r.post.url,
        type: postType(r.post),
        published_at: r.post.published_at || "",
        // Vectorize caps metadata at 10 KiB/vector; keep the stored excerpt modest.
        text: r.text.slice(0, 4000),
      },
    }));

    await env.VECTORIZE.upsert(vectors);
    indexed += vectors.length;
  }

  return {
    posts: posts.length,
    chunks: indexed,
    indexed_at: new Date().toISOString(),
  };
}

// Ghost 6 caps every Content API page at 100 results, so we page through.
async function fetchAllPosts(env) {
  const base = env.GHOST_API_URL.replace(/\/$/, "");
  const key = env.GHOST_CONTENT_API_KEY;
  const all = [];

  for (let page = 1; page <= 50; page++) {
    const url =
      `${base}/ghost/api/content/posts/?key=${key}` +
      `&limit=100&page=${page}&include=tags&formats=plaintext`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Ghost Content API ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    const posts = data.posts || [];
    all.push(...posts);
    if (posts.length < 100) break; // last page
  }

  return all;
}

// Map Ghost internal tags to a human-readable content type.
function postType(post) {
  const slugs = (post.tags || []).map((t) => t.slug);
  if (slugs.includes("hash-founders-corner")) return "Founder's Corner";
  if (slugs.includes("hash-prompt-library")) return "Steal My Prompt";
  return "Neural Gains Weekly";
}

// Split text into overlapping chunks, preferring sentence boundaries.
function chunkText(text, size = 1800, overlap = 200) {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];

  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const boundary = clean.lastIndexOf(". ", end);
      if (boundary > start + size * 0.5) end = boundary + 1;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = end - overlap;
  }
  return chunks;
}
