// Ingestion pipeline: pull posts from the Ghost Content API, split them into
// chunks, embed each chunk with Workers AI, and upsert the vectors into
// Vectorize. Also writes a catalog of everything published to KV, which the
// chat route injects into the system prompt (see index.js). Runs on a daily
// cron and on demand via the authenticated POST /ingest endpoint.

const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5"; // 768-dimensional embeddings

// KV key holding the rendered catalog. Read by handleChat in index.js.
export const CATALOG_KEY = "catalog";

// Neural Gains Weekly launched with a personal-finance and investing lens and moved
// to AI education for professionals in early 2026. Five published Steal My Prompt
// volumes (1, 5, 6, 7, 20) still state the original framing in their prompt text —
// Vol. 7 defines the 10-Minute Win as "a workflow for personal finance or investing
// beginners." They stay published: they are accurate history, and rewriting an
// archive to match current strategy would not be.
//
// But they are also the most authoritative on-site definition of what the newsletter
// is, so retrieval surfaces them and the model repeats a positioning retired months
// ago — faithfully, which is exactly the problem. index.js marks these excerpts
// [ARCHIVE] so the model cannot read the stale claim without reading the correction.
//
// Detected here, per POST, rather than per chunk: "this piece reflects the old
// framing" is a property of the piece. The positioning statement sits in the opening
// chunk, but later chunks carry finance examples with no such statement — judging a
// chunk on its own text alone leaves those unmarked.
const RETIRED_POSITIONING =
  /personal[- ]finance (?:and|or) investing|theme:\s*personal finance|pillars of neural gains|personal finance or investing beginners|personal-finance lens|use personal-finance examples/i;

// Section order in the rendered catalog. Matches the values postType() returns.
const SECTION_ORDER = [
  "Neural Gains Weekly",
  "Founder's Corner",
  "Steal My Prompt",
];

export async function ingestAll(env) {
  const posts = await fetchAllPosts(env);

  // Flatten every post into chunk records.
  const records = [];
  for (const post of posts) {
    const chunks = chunkText(post.plaintext || "");
    // Judged once, on the whole post, then carried by every chunk it produces.
    const archive = RETIRED_POSITIONING.test(post.plaintext || "");
    chunks.forEach((text, index) =>
      records.push({ post, index, text, archive }),
    );
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
        // True for posts that still state the retired personal-finance positioning.
        // index.js marks these excerpts [ARCHIVE] before the model reads them.
        archive: r.archive,
        // Vectorize caps metadata at 10 KiB/vector; keep the stored excerpt modest.
        text: r.text.slice(0, 4000),
      },
    }));

    await env.VECTORIZE.upsert(vectors);
    indexed += vectors.length;
  }

  const catalog = buildCatalog(posts);
  await env.CATALOG.put(CATALOG_KEY, catalog.text);

  return {
    posts: posts.length,
    chunks: indexed,
    catalog: catalog.counts,
    indexed_at: new Date().toISOString(),
  };
}

// Render every post as a plain-text inventory: totals, newest and oldest per
// section, and the full title list.
//
// Counts, dates and ordering are properties of the whole set, not of any single
// chunk — "39 issues" appears nowhere in the text of any post. Similarity search
// therefore cannot retrieve them at any top-K. The catalog puts those facts in
// front of the model directly, so they never depend on retrieval.
//
// Titles and dates only. Body text stays in Vectorize, where it belongs.
function buildCatalog(posts) {
  const sections = new Map();
  for (const post of posts) {
    const type = postType(post);
    if (!sections.has(type)) sections.set(type, []);
    sections.get(type).push({
      title: post.title || "(untitled)",
      published_at: post.published_at || "",
    });
  }

  // Known sections first, in a stable order; anything new lands after them.
  const names = [
    ...SECTION_ORDER.filter((s) => sections.has(s)),
    ...[...sections.keys()].filter((s) => !SECTION_ORDER.includes(s)),
  ];

  const lines = [
    "CATALOG — the complete inventory of everything published on the site.",
    "This is authoritative and exhaustive: nothing exists that is not listed here.",
    `Rebuilt: ${day(new Date().toISOString())}`,
    `Total posts: ${posts.length}`,
    "",
  ];

  const counts = {};
  for (const name of names) {
    const items = sections.get(name);
    // Newest first. ISO-8601 dates sort correctly as strings.
    items.sort((a, b) => b.published_at.localeCompare(a.published_at));
    counts[name] = items.length;

    lines.push(`${name} — ${items.length} posts`);
    lines.push(`  Most recent: ${items[0].title} (${day(items[0].published_at)})`);
    const oldest = items[items.length - 1];
    lines.push(`  First ever: ${oldest.title} (${day(oldest.published_at)})`);
    lines.push("  All titles, newest first:");
    for (const item of items) {
      lines.push(`    - ${item.title} (${day(item.published_at)})`);
    }
    lines.push("");
  }

  return { text: lines.join("\n"), counts };
}

function day(iso) {
  return (iso || "").slice(0, 10) || "undated";
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
