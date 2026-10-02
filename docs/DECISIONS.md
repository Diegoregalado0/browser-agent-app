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
