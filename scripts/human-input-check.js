#!/usr/bin/env node
// Checks src/human-input.js against a recording mouse: moves end on the target with paced,
// curved steps, clicks land inside the box with a held button, drags hold the button while
// moving, and scrolls add up to the asked distance.
import assert from "node:assert/strict";
import { boxPoint, click, drag, keyGap, move, scroll } from "../src/human-input.js";

const recorder = () => {
  const events = [];
  return { events, io: { mouse: async (type, x, y, extra = {}) => events.push({ type, x, y, ...extra, t: performance.now() }), show: null } };
};

for (const [from, to] of [[{ x: 10, y: 10 }, { x: 300, y: 200 }], [{ x: 50, y: 700 }, { x: 1200, y: 100 }]]) {
  const { events, io } = recorder();
  await move(io, from, to);
  const last = events.at(-1);
  assert.deepEqual([last.x, last.y], [to.x, to.y], "a move ends exactly on the target");
  const ms = last.t - events[0].t;
  assert.ok(events.length >= 8 && ms > 120 && ms < 3000, `paced over many steps (${events.length} steps, ${Math.round(ms)} ms)`);
  // Curved, not a straight line: some step is off the line from start to target.
  const off = (p) => Math.abs((to.y - from.y) * p.x - (to.x - from.x) * p.y + to.x * from.y - to.y * from.x) / Math.hypot(to.x - from.x, to.y - from.y);
  assert.ok(events.some((p) => off(p) > 2), "the path bends");
}

{
  // A move to where the pointer already is (two scrolls at the page's center) sends valid numbers.
  const { events, io } = recorder();
  await move(io, { x: 400, y: 300 }, { x: 400, y: 300 });
  await move(io, { x: 400, y: 300 }, { x: 401, y: 300 });
  assert.ok(events.length && events.every((e) => Number.isFinite(e.x) && Number.isFinite(e.y)), "a zero-distance move sent a non-number");
}

for (let i = 0; i < 2000; i++) {
  const p = boxPoint({ x: 100, y: 50, w: 80, h: 20 });
  assert.ok(Math.abs(p.x - 100) <= 32 && Math.abs(p.y - 50) <= 8, "click points stay inside the box");
}

{
  const { events, io } = recorder();
  const at = await click(io, { x: 0, y: 0 }, { x: 400, y: 300, w: 120, h: 40 }, { count: 2 });
  const presses = events.filter((e) => e.type === "mousePressed");
  const releases = events.filter((e) => e.type === "mouseReleased");
  assert.deepEqual(presses.map((e) => e.clickCount), [1, 2], "a double click counts 1 then 2");
  assert.ok(presses.every((e, i) => releases[i].t - e.t >= 25), "the button is held before release");
  assert.ok(presses.every((e) => e.x === at.x && e.y === at.y), "presses land where the pointer stopped");
}

{
  const { events, io } = recorder();
  await drag(io, { x: 0, y: 0 }, { x: 100, y: 100 }, { x: 400, y: 120 });
  const down = events.findIndex((e) => e.type === "mousePressed");
  const up = events.findIndex((e) => e.type === "mouseReleased");
  const moves = events.slice(down + 1, up);
  assert.ok(moves.length > 5 && moves.every((e) => e.type === "mouseMoved" && e.buttons === 1), "drag moves hold the left button");
  assert.ok(moves[0].t - events[down].t > 40, "a drag waits after pressing before it moves");
  assert.deepEqual([events[up].x, events[up].y], [400, 120], "a drag releases on the target");
}

{
  const { events, io } = recorder();
  await scroll(io, 10, 10, 0, 300);
  assert.equal(events.length, 3, "300 px scrolls in three wheel ticks");
  assert.equal(events.reduce((s, e) => s + e.deltaY, 0), 300, "the ticks add up to the asked distance");
}

assert.ok(keyGap(2000) < 30, "long text types faster");
console.log("human-input-check: ok");

// The setting saves and survives a reload, and the browser uses it only in an internal build.
{
  const { cleanSetting, mergeConfig } = await import("../src/config-core.js");
  const { Browser } = await import("../src/browser-tools.js");
  assert.equal(cleanSetting("humanInput", true), true);
  assert.equal(mergeConfig({ humanInput: true }).humanInput, true);
  assert.equal(mergeConfig({}).humanInput, false, "off by default");
  const sent = [];
  const transport = {
    pages: async () => [{ id: "h1", title: "", url: "https://a.test/" }],
    activeId: async () => "h1",
    activate: async () => {},
    send: async (id, method, params) => {
      sent.push({ method, ...params });
      return method === "Runtime.evaluate" ? { result: { value: { w: 1280, h: 800 } } } : {};
    },
  };
  const browser = new Browser(transport);
  const clickAt = (b) => b.run("browser", { action: "left_click", coordinate: [200, 150] }).catch(() => {});
  for (const [build, setting, human] of [[false, true, false], [true, false, false], [true, true, true]]) {
    globalThis.BROWSBY_INTERNAL = build;
    browser.humanInput = setting;
    browser.pointers.clear();
    sent.length = 0;
    await clickAt(browser);
    const moves = sent.filter((e) => e.method === "Input.dispatchMouseEvent" && e.type === "mouseMoved").length;
    assert.equal(moves > 3, human, `build ${build}, setting ${setting}: ${moves} mouse moves`);
  }
  delete globalThis.BROWSBY_INTERNAL;
}
console.log("human-input setting check: ok");
