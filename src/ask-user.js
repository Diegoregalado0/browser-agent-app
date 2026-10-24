// The ask_user tool: the model's way to stop and ask the user something only they can decide.
// The task ends at the call and the question shows in the chat as the agent's reply, so it is
// never folded away with the narration of a step; the answer comes as the user's next request.

export const ASK_USER_TOOL_DEF = {
  name: "ask_user",
  description:
    "Ask the user something you cannot decide yourself and cannot work around, such as their preferences, details about " +
    "them, or a choice where a wrong guess is costly. The task ends with this call: the question is shown to the user as " +
    "your reply and their answer arrives as their next message, so call no other tool in the same turn and do not keep " +
    "working while you wait. Put every question in this one call. When a reasonable assumption lets you continue, make it " +
    "instead and say what you assumed in your final reply. Never ask for passwords, sign-in codes or payment details: when a " +
    "site needs the user signed in, ask them to sign in themselves in the open tab and tell you when they are done.",
  input_schema: {
    type: "object",
    properties: {
      question: { type: "string", description: "The question or questions, as you would write them to the user" },
    },
    required: ["question"],
  },
};

// A turn with an ask_user call: the question, and the results its calls get. Other calls in
// the turn are not run. The question is null when the call has none; the results then say so,
// and the task goes on.
export function askUserTurn(calls) {
  const ask = calls.find((c) => c.name === "ask_user");
  const question = typeof ask.input?.question === "string" && ask.input.question.trim() ? ask.input.question.trim() : null;
  const results = calls.map((call) => {
    const base = { type: "tool_result", id: call.id, nativeId: call.nativeId, name: call.name };
    if (call !== ask) return { ...base, isError: true, content: [{ type: "text", text: "Not run: you asked the user a question in the same turn. Wait for the answer." }] };
    if (!question) return { ...base, isError: true, content: [{ type: "text", text: "question is required." }] };
    return { ...base, content: [{ type: "text", text: "Shown to the user. The task ends here; their answer comes as their next message." }] };
  });
  return { question, results };
}
