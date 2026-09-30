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
// Reads whose output reflects the page: the same read giving the same output this many
// times means the actions between them changed nothing. A navigation that keeps loading
// the same page (a "Page Not Found" for a guessed address) counts too.
const NOTE_SAME_READ = 3;
const PAGE_READS = new Set(["read_page", "get_page_text", "navigate"]);

// Errors that differ only in numbers (ref ids, line and column) count as the same.
const errorKey = (text) => text.split("\n")[0].replace(/\d+/g, "#").slice(0, 300);

export class LoopGuard {
  constructor() {
    this.recent = [];
    this.consecutiveErrors = 0;
    // Set when the task should stop; a sentence for the user.
    this.stopReason = null;
  }

  // Records a finished call and returns a note to append to its result, or null.
  record(name, input, isError, text) {
    const call = `${name} ${JSON.stringify(input)}`;
    const key = isError ? errorKey(text) : PAGE_READS.has(name) ? text : null;
    this.recent = [...this.recent.slice(1 - WINDOW), { call, isError, key }];
    const count = (match) => this.recent.filter(match).length;

    if (!isError) {
      this.consecutiveErrors = 0;
      if (key === null || count((e) => !e.isError && e.call === call && e.key === key) < NOTE_SAME_READ) return null;
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
}
