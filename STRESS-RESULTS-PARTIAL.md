# Stress limits: partial results (pass 1 of the ladder)

Model qwen3.6-35b-a3b (UD-Q3_K_XL, ctx 32768, ubatch 2048, temp 0.7 / top-p 0.8 / top-k 20 /
presence 1.5) on the gate, bench build 37a77fb (main cf8d65c plus this branch's harness).
Run started 2026-10-04 17:39 local, stopped after pass 1 and two tasks of pass 2 when the
machine was shut down. Harness: --max-steps 300 --no-usage-limits --debug --timeout 7200000
--stall-ms 600000 --sample-ms 7000. The soak never started.
Results: ~/bench-results/openai-qwen3.6-35b-a3b-2026-10-05T00-39-00-913Z(.json, .md, event
and resource logs), launcher log ~/bench-results/runs/20261004-173900/run.log.
Report tables: node scripts/bench/stress-report.js <run.json>.

## Pass 1

| Dim | Rung | Task | Result | Steps | Min | Why |
|---|---|---|---|---|---|---|
| horizon | 10 | horizon-quotes-3 | fail (2/2 runs) | 5 | 1.4 | miscounts (5 vs 6), counts from navigate output without reading each page |
| horizon | 25 | horizon-stock-travel (11 pages) | pass (2/2 runs) | 36 | 8.6 | |
| horizon | 25 | horizon-catalogue-10 | pass | 23 | 12.3 | |
| horizon | 55 | horizon-catalogue-25 | fail | 33 | 17.7 | context full: 32748 input tokens, reply cut mid tool call |
| horizon | 70 | horizon-stock-mystery (32 pages) | fail, 16% right | 64 | 15.1 | context full (32.6k), guard blocks, output limit |
| horizon | 105 | horizon-catalogue-50 | fail | 21 | 7.9 | context full (32.7k) after 22 requests |
| horizon | 160 | horizon-stock-sequential (75 pages) | fail, 1% right | 62 | 15.8 | context full (32.77k) |
| breadth | 2 | breadth-categories-2 | pass | 7 | 1.7 | |
| breadth | 4 | breadth-categories-4 | fail, 75% | 24 | 3.9 | one count wrong |
| breadth | 8 | breadth-categories-8 | fail | 70 | 10.4 | 400: 33441 tokens exceed 32768 |
| breadth | 12 | breadth-categories-12 | pass | 31 | 7.8 | |
| memory | 10 | memory-upc-gap10 | pass | 24 | 4.5 | |
| memory | 25 | memory-upc-gap25 | pass | 36 | 8.1 | |
| memory | 55 | memory-upc-gap55 | fail | 52 | 18.2 | 400: 32856 tokens exceed 32768 |
| memory | 5 turns | memory-turns-5 | fail | 45 | 8.7 | turn 2 miscount (not recall); recall itself consistent with its own count |
| memory | flood | memory-context-flood | pass | 6 | 3.4 | |
| precision | 7 | precision-form-7 | pass | 11 | 1.7 | |
| precision | 9 | precision-form-9 | fail | 44 | 7.4 | form submitted (see below), slider never set |
| precision | 18 | precision-countries-18 | pass | 2 | 1.1 | |
| precision | 22 | precision-hockey-22 | fail, 21/22 | 12 | 2.5 | all 21 seasons right, total line missing |
| recovery | 1 | recovery-modal-1 | fail, 1/2 | 1 | 0.6 | did not report the modal title |
| recovery | 2 | recovery-dynamic-2, deadlink-2, ajax-2 | pass x3 | 6 to 13 | 1.3 to 2.2 | |
| recovery | 5 | recovery-chain-5 | pass | 17 | 3.3 | |

Pass 1: 13/25. Horizon limit: passes 11 product pages / 10 catalogue pages (about 25 to 36
steps), fails from 25 catalogue pages / 32 product pages up. Breadth and memory pass up to
about 30 to 36 steps and fail past about 50 steps, for the same reason.

## Findings

1. Context overflow at 32k is the hard limit. Input grows about 400 to 500 tokens per step
   (breadth-8: 10.1k at step 10, 19.7k at 20, 29.3k at 60, 32.7k at 70). The overflow retry
   from cf8d65c is in the build and fired (3 times on breadth-8, 19 on memory-upc-gap55) but
   cannot recover: it only trims tool text over 1500 characters and screenshots, while the
   history is mostly small tool results and assistant turns. Every task needing more than
   about 50 to 70 steps dies this way.
2. "Output limit" on horizon-catalogue-25 (and catalogue-50, stock-mystery, stock-sequential)
   is the same failure: the openai provider sends no max_tokens on the Chat Completions path
   and models.ini sets no n_predict, so llama-server stops when the context fills (finish
   length) with about 20 tokens left after a 32748-token prompt. Fix: send a modest
   max_tokens (about 2048) and keep input below n_ctx minus that.
3. precision-form-9 was submitted despite "do NOT submit": form_input could not set the range
   slider (and refused the password field), so the model sent a key action "Tab" x18 then
   "Enter", which submitted the form. The guard rated it "ask", and the bench answers every
   ask with "once". In the app the user would have been asked; the guard should block Enter
   when the user forbade submitting, and form_input should support range inputs. The guard
   also asked on many harmless clicks in this task.
4. Counting errors on short tasks (quotes-3 twice, turns-5 turn 2, breadth-4) come from
   counting off partial page output instead of reading the full page text.

## Ranked fixes

1. Context management: drop or summarize the middle of the history (keep the task, the
   model's own notes and the last N turns) once input passes about 24k, instead of only
   trimming long tool text. This is what bounds horizon, breadth and memory.
2. Send max_tokens (about 2048) and budget input as n_ctx minus that.
3. Guard: block Enter or submit-like keys when the user said not to submit; form_input for
   range inputs and a supported way to fill password fields the user gave.
4. Prompt: for counting tasks, read the full page text per page and keep a running tally in
   the reply text (which survives compaction).

## Resources (pass 1)

No flagged moments: memory PSI stayed 0, load peaked about 4.4 of 12 cores, no swap growth,
VRAM flat at 7.6 GB, llama-server RSS about 20 to 22 GB, Chrome RSS about 2 to 3 GB growing
slowly over the run. Per-task mean and peak tables come from stress-report.js.
