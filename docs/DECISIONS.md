# Decisions

What changed in how Browsby stops tasks, checks pages and builds the extension, and what to do if a change causes trouble. Line numbers are as of the commits named; `scripts/stop-check.js` covers every entry and runs with `npm run check`.

## 2026-10-02

### 1. Stop ends a task at once

Stop now ends the task immediately, whatever the agent is waiting on: a model request that ignores the cancel, a safety check, or a page script that never returns. The panel shows "Stopped.", the browser is released, the conversation is saved in a state the model accepts, and a new task can start right away. Before, the task kept counting as running until the stuck call returned, so the next request got "A task is already running."

The stopped run may still be waiting in the background. Before every event, permission prompt, browser action and history write, it checks whether it was stopped, so nothing it does afterwards reaches the user, the browser or the conversation.

- Symptom to watch for: text, a tool call or a prompt from a task the user stopped showing up after "Stopped.", or a conversation that fails to continue after a Stop (a provider error about missing tool results).
- Where: `Agent.stop` and `#closeHistory` in `src/agent.js:244`, and the signal-aware `#emit` and `#ask` helpers at `src/agent.js:667`. Commit `1f5fe42`.
- Revert: `git revert 1f5fe42`. That brings back the "already running" bug.

### 2. Q1: the next task waits up to 5 seconds for the last one to release the browser

After a Stop, releasing the browser (removing the Agent tab group, detaching the debugger) runs in the background. The next task waits for it, but for no more than 5 seconds, so a release that hangs cannot block the new task.

- Symptom to watch for: a new task that starts while Chrome's debugging banner or the Agent tab group from the previous task is still being removed, or a task that takes about 5 seconds to begin right after a Stop.
- Tune: `ENDING_WAIT_MS` in `src/agent.js:23` (used at `src/agent.js:309`).

### 3. Q2: what the model is told about a tool call that Stop interrupted

If Stop comes while a browser action runs, its result reads "Stopped by the user before this finished; its outcome is unknown." Actions that had already finished keep their real results. The model sees this the next time the user writes, so it knows the action may or may not have happened.

- Symptom to watch for: the model assuming an interrupted click or form entry did happen, or repeating it without checking the page.
- Tune: the text at `src/agent.js:271`.

### 4. A safety scan cut short by Stop is not remembered

The content scan that looks for prompt injection used to remember a scan cut short by Stop as "no injection found". That page was then treated as clean for the rest of the conversation. A stopped scan is now forgotten, and the page is scanned again the next time it is read.

- Symptom to watch for: the same page being scanned again after a Stop (expected, and costs one extra safety check).
- Where: `src/guard.js:193`. Commit `f16ecb2`. Do not revert this one: it is a security fix.

### 5. A safety scan that failed is not remembered

In the same way, a scan that failed for any other reason (no network, a server error, a timeout) was remembered as "no injection found", so one passing error marked a page clean for the session. A failed scan still lets the agent read the page, as before, and the safety check on actions still gates what happens next. It is no longer remembered, so the next read of that page scans again. A scan that completes is remembered as before.

- Symptom to watch for: when the safety model is down, every read of a page tries a scan again, so each read takes longer (up to about two seconds of retries each time) until the safety model answers.
- Where: `src/guard.js:162` and `src/guard.js:194`. Commit `92d9b33`. Do not revert this one: it is a security fix.

### 6. Q4: browser calls time out after 30 seconds

Each call the agent makes to the browser (a DevTools command, a script run in the page, starting a navigation) now gives up after 30 seconds. The step then fails with a tool error telling the model that the browser did not answer and that the page may be busy or frozen, and the task goes on. Before, a frozen page held the step until the user pressed Stop. Waiting for a page to finish loading has its own, separate limit and did not change.

- Symptom to watch for: steps on slow or heavy pages failing with "The browser did not answer ... within 30s", for example a large screenshot or a slow navigation.
- Tune: `BROWSER_CALL_TIMEOUT_MS` in `src/browser-tools.js:29`. The timeout is applied in `#bounded` at `src/browser-tools.js:425`. Commit `5dfe104`.

### 7. The extension build no longer leaves a half-built folder

The build used to write the store manifest (without the key that fixes the extension id), zip it, then rewrite the manifest with the key. An interrupted build left `dist/extension` with no key, so the sandbox loaded it under a different extension id and Outlook sign-in broke. The build now happens in `dist/extension.tmp` and the zip under a temporary name, and both are moved into place only once complete.

- Symptom to watch for: a leftover `dist/extension.tmp` after a failed build (harmless; the next build removes it), or a build that fails at the final rename.
- Where: `scripts/build-extension.js:16` and `scripts/build-extension.js:132`. Commit `a38297f`.

### 8. Q3: a build without its key counts as outdated

The sandbox command (`browser-agent`) decides whether to rebuild with `buildOutdated()`. It now also rebuilds when the built manifest has no `key`, which repairs a folder left by an interrupted build from before this change. The function moved from `bin/browser-agent.js` to `src/chrome.js`, next to the build folder it checks, so the checks can call it.

- Symptom to watch for: the sandbox rebuilding on every start, which would mean the build is writing a manifest without its key.
- Where: `buildOutdated` in `src/chrome.js:33`, with the list of build sources at `src/chrome.js:16`. Commit `a38297f`.

## 2026-10-03

### 9. Stop closes the connection of the request in flight

With one llama.cpp slot, a request the agent had given up on could keep the server busy for half an hour and block every later request. On the client, Stop already aborts the model request and any safety check through the task's signal, and the OpenAI provider passes that signal to the request, which closes the socket. llama-server cancels a task when it notices the client has gone. A new check proves the socket closes on Stop, both for a streamed turn that has begun answering and for a safety check (not streamed), so a change that drops the signal fails `npm run check`.

No slot cancel call was added: llama-server has no endpoint that cancels a running request (`/slots/{id}?action=erase` clears a slot's cache; it does not stop the work). The server notices a disconnect only between batches of work, so a slow prompt or image encode under memory pressure can still run on after Stop. A proxy between the extension and llama.cpp (the gate) must also close its upstream connection when the client goes, or llama.cpp never sees the disconnect.

- Symptom to watch for: the server still busy long after a Stop, with no client connected. Check whether the proxy passes the disconnect upstream before suspecting the extension.
- Where: the check at `scripts/stop-check.js:218`; the signal is passed in `chatTurn` and `classify` in `src/providers/openai.js`. Commit `1ca30e5`.
- Revert: `git revert 1ca30e5` removes only the check.

### 10. Screenshots attached to other output are scanned by the page's text

Page tools (screenshots, clicks, navigation) were already scanned by the page's text when it has some. A screenshot that the agent attaches to other output (after a failed step or a loop check on read_page, find or get_page_text) still reached the safety model as an image, so a local vision model encoded the same screenshot twice in one step. Those screenshots are now replaced by the page's text when the page has at least 40 characters of it. The tool's own output is scanned as before.

Still scanned by image: a page without text (a canvas, an image-only page), read_page's own screenshot of what its outline cannot show (a large canvas or cross-origin frame), and images from tool servers (Outlook). The action check is unchanged; it never took images.

- Symptom to watch for: a prompt injection written only inside an image on a page that also has text, seen in a screenshot after a failed step, no longer flagged. This is the same trade-off page tools already made.
- Where: `scanContent` in `src/guard.js:154`, and `#autoScreenshot` marking its screenshots in `src/agent.js:629`. Commit `cbf4fda`.
- Revert: `git revert cbf4fda`.

### 11. Scrolling follows scroll_direction, and script-driven buttons get refs

Every Qwen 3.6 35B run of "Checkout stops before payment" timed out (20 to 47 steps). The event logs show two tool problems behind most of the wasted steps:

- Six of eight runs passed a negative `scroll_amount` with direction `up` (11 times in the ub512 run). That scrolled down while the result said "Scrolled up", so the model kept scrolling "up", got "No change among the controls in view" at the bottom, and took screenshots to understand why. The sign of the amount is now ignored; the direction decides.
- On the cart page, "Proceed To Checkout" is a link with no address and a click handler. The outline showed it as plain text with no ref, so runs that reached the cart spent their remaining steps scrolling, screenshotting and clicking guessed coordinates (one hit the newsletter box and was blocked). Links without an address and `.btn` elements that show a pointer cursor now count as controls and get refs.

The benchmark task and its timeout are unchanged. This needs a GPU run to confirm. Note that without an account, Proceed To Checkout on that site opens a "Register / Login" dialog rather than the checkout page.

- Symptom to watch for: read_page or action reports listing extra controls (decorative `.btn` elements or anchors with a pointer cursor), or a scroll that a model meant as the opposite direction.
- Where: `src/browser-tools.js:731` (scroll) and `SCRIPTED_SELECTOR` in `src/page-scripts.js:35`. Commit `1d70fcd`.
- Revert or tune: `git revert 1d70fcd`, or narrow `SCRIPTED_SELECTOR`.

## 2026-10-04

### 12. A task that repeats the same action, or the same blocked call, stops

The loop guard only counted failures and repeated page reads. Small local models looped on calls that neither failed nor read: Qwen 3.5 4B sent the same left_click 44 times in one run (the safety check blocked 41 of them, about 3 s each), and Qwen 3.5 9B scrolled the same way 19 times. Now:

- An action (not a read or navigation) that returns the same result as before gets a note the third time and stops the task the sixth time, within the last 20 calls. Screenshots and waits are not counted, since their text says nothing about the page. Reads and navigations keep the note only: going back to a list page between items repeats them legitimately.
- A call the safety check blocked is refused if it comes again on the same page address in the same task, without a new check. The second time it gets a note, the fourth time the task stops. A single block is still the check's decision, not a loop.

The safety check itself is unchanged; the stored block only refuses, it never allows.

- Symptom to watch for: a task stopped with "the same browser call returned the same result 6 times" while it was making progress (an action whose report does not change although the page does), or a call refused as "blocked earlier in this task" after the page changed without its address changing.
- Where: `STOP_SAME_RESULT`, `STOP_SAME_BLOCK` and `recordBlock` in `src/loop-guard.js:24`, and `blockedCalls` in `#authorize` in `src/agent.js:731`. Commit `fb0aa42`, checks in `scripts/agent-check.js` (commit `48934ad`).
- Revert or tune: `git revert 48934ad fb0aa42`, or raise `STOP_SAME_RESULT` and `STOP_SAME_BLOCK`.

### 13. A request longer than the model's context is trimmed and sent again

Compaction runs only once a request has grown by half and leaves the latest four messages whole, so two long page texts in a row can pass a local 32k context between passes. A Qwen 3.6 35B bench run lost "Compare Python and Java" that way: get_page_text returned 60,142 and then 48,171 characters, and llama.cpp refused the next request (34,204 tokens against 32,768), which ended the task with an error. Qwen 3.5 9B hit the same error in the 2026-10-03 runs.

Now, when the server says the request exceeds the context, earlier screenshots and long tool output are trimmed as in a normal pass, leaving only the newest result whole, and the request is sent again. If nothing older can be trimmed, or it still does not fit, the newest result is trimmed too (to its first 1,500 characters, with a note to run the tool again). After that the error ends the task as before. The panel shows a notice when this happens.

- Symptom to watch for: the model asking for page text again right after the notice, or answering from trimmed text. Providers that word the error differently are not matched and fail as before.
- Where: `CONTEXT_OVERFLOW` and `OVERFLOW_KEEP` at `src/agent.js:57`, the `keep` argument of `#compact`, and the retry in the request loop. Commit `10bbc3a`, checked in `scripts/agent-check.js`.
- Revert: `git revert 10bbc3a`.
