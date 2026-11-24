# How Neura is evaluated

Neura answers reader questions from the newsletter archive. This page records how its answers are checked, what the first check found, and what changed as a result.

**Result: 4 of 9 correct on June 28, 2026; 9 of 9 on July 13, 2026**, measured against the live Worker.

## The check

Nine fixed questions are asked through the live site widget and each answer is marked right or wrong. The questions fall into three groups:

| Group | What it asks | Example |
| --- | --- | --- |
| A. Counts and inventory | Facts about the archive as a whole | "How many issues are on the site?" |
| B. Recency and listing | The newest items, or a list of them | "What was the most recent issue?" |
| C. Topic questions (controls) | What a specific piece says | "What is a 10-Minute Win?" |

Group C is the control: ordinary retrieval should answer these, so a failure there points to something other than the retrieval design.

## Baseline: 4 of 9

Groups A and B failed completely. The cause was the design, not a made-up answer. Neura retrieved the five passages closest to the question. A count or a "newest" answer is a property of the whole archive and appears in the text of no single passage, so retrieval could never surface it.

## Fix 1: answer whole-archive questions from a catalog (8 of 9)

On every index run, `src/ingest.js` now writes a full inventory to Workers KV: totals, the newest and oldest items, and every title with its date. `src/index.js` puts that inventory into the system prompt. Counts, dates and listings no longer depend on retrieval.

## Fix 2: the last failure was the content, not the model (9 of 9)

One control question kept failing: "What is a 10-Minute Win?" For two weeks it was logged as a hallucination. It was not one.

The newsletter began with a personal-finance focus and later moved to AI education for professionals. Five older posts still describe the original focus, and one of them defines the 10-Minute Win in those terms. Retrieval surfaced those posts and the model repeated them accurately. The check was measuring the content and blaming the model.

The posts stay published because they are accurate history. `src/ingest.js` now judges each post against a retired-focus pattern and stamps every passage that post produces. `src/index.js` prefixes those passages with an `[ARCHIVE]` note. Checked against all 124 posts at the time: exactly those five are flagged, all 14 of their passages carry the note, and no other post is touched.

## Two rules this produced

- **Put the correction next to the evidence.** A general instruction in the system prompt to ignore the old focus asks the model to hold a rule while reading text that contradicts it. The `[ARCHIVE]` note travels with the passage, so the stale claim cannot be read without its correction.
- **Judge the post, not the passage.** "This piece reflects the old focus" is true of the whole piece. Later passages in the same post carry the old examples without restating the focus, so judging each passage alone leaves them unmarked. The flag is set at ingest, where the whole post is visible.

And one habit: when a control question fails, treat the content as a suspect, not only the model.

## Limits

- Nine questions is a small set. It was built to find design faults, and it found two; it is not a measure of answer quality across every question a reader might ask.
- The check is run by hand against the live site. It is not part of the automated tests, and the question list and its scoring notes are kept outside this repository.
- The 9 of 9 result was measured on July 13, 2026. The assistant has changed since, including answers drawn from podcast episodes, and the nine questions have not been re-scored against every later version.

## What runs automatically

`npm test` in this folder runs 75 unit tests with mocked providers, so no live model is called. They cover the show-link directory, episode transcript handling and the widget's session behaviour. A GitHub Actions workflow runs them on every push and pull request.
