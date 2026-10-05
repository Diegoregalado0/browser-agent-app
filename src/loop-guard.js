// Detects a task going in circles: tool calls failing the same way again and again, or
// page reads that keep returning the same thing. It adds a note to the tool result
// telling the model to change approach, and after a hard limit asks the agent to stop
// the task so the user can step in instead of steps being burned.

// Calls remembered for the repetition counts.
const WINDOW = 20;
// A note: the same call failed twice, the same error came back 3 times, or 3 calls in a
// row failed. Two identical failures already mean retrying as-is will not help.
const NOTE_SAME_CALL = 2;
const NOTE_SAME_ERROR = 3;
const NOTE_CONSECUTIVE = 3;
// A stop: 5 of the same error, or 6 failures in a row. Both leave room for the note to
// be acted on (a screenshot and one or two different attempts) before giving up.
const STOP_SAME_ERROR = 5;
const STOP_CONSECUTIVE = 6;
// The same call returning the same output this many times means it and the actions between
// them changed nothing: a read of an unchanged page, a navigation that keeps loading the
// same "Page Not Found", a click or scroll that reports no change. The note comes at 3.
const NOTE_SAME_RESULT = 3;
// An action (not a read or navigation) repeated with the same result 6 times stops the
// task. Reads and navigations are left out: going back to a list page between items
// repeats them legitimately.
const STOP_SAME_RESULT = 6;
const READS = new Set(["read_page", "get_page_text", "find", "navigate"]);
// Actions whose text output says nothing about the page (a screenshot is an image), so
// equal text is not a sign of a loop.
const NO_TEXT_ACTIONS = new Set(["screenshot", "wait"]);
// The same call blocked by the safety check: a note the second time, a stop the fourth.
// A small model otherwise resends a blocked click until the step budget runs out.
const NOTE_SAME_BLOCK = 2;
const STOP_SAME_BLOCK = 4;

// Errors that differ only in numbers (ref ids, line and column) count as the same.
const errorKey = (text) => text.split("\n")[0].replace(/\d+/g, "#").slice(0, 300);

export class LoopGuard {
  constructor() {
    this.recent = [];
    this.consecutiveErrors = 0;
    // Blocked calls by call text, with how often each was blocked.
    this.blocks = new Map();
    // Set when the task should stop; a sentence for the user.
    this.stopReason = null;
  }

  // Records a finished call and returns a note to append to its result, or null.
  record(name, input, isError, text) {
    const call = `${name} ${JSON.stringify(input)}`;
    const key = isError ? errorKey(text) : name === "browser" && NO_TEXT_ACTIONS.has(input?.action) ? null : text;
    this.recent = [...this.recent.slice(1 - WINDOW), { call, isError, key }];
    const count = (match) => this.recent.filter(match).length;

    if (!isError) {
      this.consecutiveErrors = 0;
      const same = key === null ? 0 : count((e) => !e.isError && e.call === call && e.key === key);
      if (same >= STOP_SAME_RESULT && !READS.has(name)) {
        this.stopReason = `the same ${name} call returned the same result ${same} times.`;
        return "[Loop check] This exact call keeps returning the same result. The task is being stopped so the user can decide how to proceed.";
      }
      if (same < NOTE_SAME_RESULT) return null;
      return (
        "[Loop check] This exact call has returned exactly the same result several times, so repeating it and the " +
        "actions in between changed nothing. Stop repeating them. Take a screenshot to see the page as it really is, then try a " +
        "different approach, or tell the user what is blocking you."
      );
    }

    this.consecutiveErrors++;
    const sameError = count((e) => e.isError && e.key === key);
    if (sameError >= STOP_SAME_ERROR || this.consecutiveErrors >= STOP_CONSECUTIVE) {
      this.stopReason =
        sameError >= STOP_SAME_ERROR
          ? `the same error kept repeating (${sameError} times): ${text.split("\n")[0].slice(0, 200)}`
          : `${this.consecutiveErrors} tool calls in a row failed.`;
      return "[Loop check] Too many repeated failures. The task is being stopped so the user can decide how to proceed.";
    }
    if (count((e) => e.isError && e.call === call) >= NOTE_SAME_CALL) {
      return (
        "[Loop check] This exact call already failed before. Repeating it will fail again. Take a screenshot or use " +
        "read_page to see the page as it is now, then try a different method."
      );
    }
    if (sameError >= NOTE_SAME_ERROR || this.consecutiveErrors >= NOTE_CONSECUTIVE) {
      return (
        "[Loop check] Your recent tool calls keep failing" +
        (sameError >= NOTE_SAME_ERROR ? " with the same error" : "") +
        ". The page is probably not what you think it is (it changed, navigated, or the content is in an iframe). " +
        "Take a screenshot to check, then change approach. Further repeated failures will stop the task."
      );
    }
    return null;
  }

  // Records a call the safety check blocked and returns a note for its result, or null.
  // A single block is the check's decision, not a loop; the same call sent again is.
  recordBlock(name, input) {
    const call = `${name} ${JSON.stringify(input)}`;
    const times = (this.blocks.get(call) ?? 0) + 1;
    this.blocks.set(call, times);
    if (times >= STOP_SAME_BLOCK) {
      this.stopReason = `the same ${name} call was blocked by the safety check ${times} times.`;
      return "[Loop check] This exact call keeps being blocked. The task is being stopped so the user can decide how to proceed.";
    }
    if (times < NOTE_SAME_BLOCK) return null;
    return (
      "[Loop check] This exact call was already blocked and will be blocked again. Do not send it again. Take a " +
      "screenshot to see the page, then reach the goal another way, or tell the user what is blocking you."
    );
  }
}
