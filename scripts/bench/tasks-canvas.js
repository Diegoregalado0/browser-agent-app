// Canvas LMS tasks, against the local stand-in Canvas (fake-canvas.js), which this module
// starts on a free port when the runner loads it. Run with --taskfile tasks-canvas.js, and
// with --canvas-tool off to measure the same tasks with page reads and API notes only.
// The stand-in is on 127.0.0.1, so the agent's local-address prompt is answered "once" for
// it (allowPrivate); every other prompt keeps the runner's usual policy.

import { startFakeCanvas } from "./fake-canvas.js";

const { server, origin } = await startFakeCanvas();
// The runner exits on its own when the tasks are done; the stand-in does not hold it open.
server.unref();
const host = new URL(origin).hostname;
const where = `My school's Canvas is at ${origin}.`;
const has = (text, word) => text.toLowerCase().includes(word.toLowerCase());

export const TASKS = [
  {
    id: "canvas-due-week",
    name: "Canvas: due in the next 7 days",
    allowPrivate: [host],
    prompt: `${where} What's due in the next 7 days across all my courses?`,
    check: ({ reply }) => {
      const missing = ["Lab Report 3", "Problem Set 6", "Essay 2"].filter((w) => !has(reply, w));
      const extra = ["Lab Report 4", "Reading Response 7"].filter((w) => has(reply, w));
      const ok = !missing.length && !extra.length;
      return { ok, reason: ok ? "listed the three items due" : `missing [${missing.join(", ")}], outside the range [${extra.join(", ")}]` };
    },
  },
  {
    id: "canvas-grade",
    name: "Canvas: current grade in a course",
    allowPrivate: [host],
    prompt: `${where} What's my current grade in Calculus?`,
    check: ({ reply }) => {
      const ok = has(reply, "84.2");
      return { ok, reason: ok ? "gave 84.2%" : `reply: ${reply.slice(0, 160)}` };
    },
  },
  {
    id: "canvas-announcement",
    name: "Canvas: latest announcement in a course",
    allowPrivate: [host],
    prompt: `${where} What's the latest announcement in my Calculus course?`,
    check: ({ reply }) => {
      const ok = has(reply, "midterm") && has(reply, "thursday");
      return { ok, reason: ok ? "named the midterm move" : `reply: ${reply.slice(0, 160)}` };
    },
  },
  {
    id: "canvas-unread",
    name: "Canvas: unread inbox count",
    allowPrivate: [host],
    prompt: `${where} How many unread messages do I have in my Canvas inbox?`,
    check: ({ reply }) => {
      const ok = /\b(3|three)\b/i.test(reply);
      return { ok, reason: ok ? "said 3" : `reply: ${reply.slice(0, 160)}` };
    },
  },
  {
    id: "canvas-open-assignment",
    name: "Canvas: open an assignment, report its points",
    allowPrivate: [host],
    prompt: `${where} Open the Lab Report 3 assignment in my biology course and tell me how many points it's worth.`,
    check: ({ finalUrl, reply }) => {
      const opened = /\/courses\/101\/assignments\/5001\b/.test(finalUrl);
      const points = /\b37\b/.test(reply);
      return { ok: opened && points, reason: `${opened ? "opened it" : `final URL ${finalUrl}`}, ${points ? "said 37" : "no 37 in the reply"}` };
    },
  },
  {
    id: "canvas-modules",
    name: "Canvas: modules of a course",
    allowPrivate: [host],
    prompt: `${where} List the modules in my biology course.`,
    check: ({ reply }) => {
      const ok = has(reply, "Enzymes") && has(reply, "Photosynthesis");
      return { ok, reason: ok ? "named both modules" : `reply: ${reply.slice(0, 160)}` };
    },
  },
];
