#!/usr/bin/env node
// Checks the agent experiments (EXPERIMENTS in src/config-core.js) against a scripted page:
// each one is off unless switched on, and does what it says when on.
import assert from "node:assert/strict";
import { Browser } from "../src/browser-tools.js";
import { EXPERIMENTS, cleanSetting, mergeConfig } from "../src/config-core.js";

assert.deepEqual(mergeConfig({}).experiments, {}, "experiments are off by default");
assert.deepEqual(cleanSetting("experiments", { clickTarget: true }), { clickTarget: true });
assert.throws(() => cleanSetting("experiments", { nope: true }), /Unknown experiment/);
assert.throws(() => cleanSetting("experiments", { clickTarget: "yes" }), /Unknown experiment/);
assert.ok(EXPERIMENTS.includes("clickTarget") && EXPERIMENTS.includes("staleRefs"));

// A page whose scripts answer by name: the Browser sends each page script as its source text.
function scriptedPage(handlers) {
  const sent = [];
  const transport = {
    pages: async () => [{ id: "t1", title: "T", url: "https://a.test/" }],
    activeId: async () => "t1",
    activate: async () => {},
    send: async (id, method, params) => {
      sent.push({ method, ...params });
      if (method !== "Runtime.evaluate") return {};
      const name = /^\(function (\w+)/.exec(params.expression)?.[1];
      const args = name ? JSON.parse(/\)\(\.\.\.(\[.*\])\)$/s.exec(params.expression)[1]) : [];
      const value = name && handlers[name] ? handlers[name](...args) : params.expression.includes("readyState") ? "complete" : { w: 1280, h: 800, dpr: 1, x: 0, y: 0 };
      return { result: { value } };
    },
  };
  return { transport, sent };
}
const outline = (tree) => ({ url: "https://a.test/", title: "T", viewport: "1280x800", scroll: "0,0", tree, items: [], doc: "d1" });

// staleRefs: ref_3 ("Archive" in a list that re-rendered) is gone; the same button is ref_9.
{
  let tree = 'list\n  button "Archive" [ref_3]\n  button "Delete" [ref_4]';
  const page = scriptedPage({
    readPageScript: () => outline(tree),
    refCenterScript: (ref) => (ref === "ref_9" ? { x: 100, y: 50, w: 80, h: 20 } : { error: `${ref} not found; call read_page again to refresh refs` }),
    hitTestScript: () => null,
  });
  const browser = new Browser(page.transport);
  await browser.run("read_page", {});
  tree = 'list\n  button "Archive" [ref_9]\n  button "Delete" [ref_10]';
  await assert.rejects(browser.run("browser", { action: "left_click", ref: "ref_3" }), /ref_3 not found/, "off: a stale ref still fails");
  browser.experiments = { staleRefs: true };
  const out = await browser.run("browser", { action: "left_click", ref: "ref_3" });
  assert.match(out, /ref_3 was replaced when the page updated; used ref_9, the same button "Archive"/);
  assert.ok(page.sent.some((s) => s.type === "mousePressed" && s.x === 100 && s.y === 50), "the click went to the control found again");

  // Two controls with the same role and name: no guess.
  tree = 'button "Archive" [ref_11]\nbutton "Archive" [ref_12]';
  await assert.rejects(browser.run("browser", { action: "left_click", ref: "ref_3" }), /not found/);
}

// clickTarget: a coordinate click says what it landed on, and names an embedded frame.
{
  let target = 'button "Proceed To Checkout"';
  const page = scriptedPage({ readPageScript: () => outline(""), describeTargetScript: () => target });
  const browser = new Browser(page.transport);
  const off = await browser.run("browser", { action: "left_click", coordinate: [200, 400] });
  assert.doesNotMatch(off, / on button/, "off: no target in the result");
  browser.experiments = { clickTarget: true };
  assert.match(await browser.run("browser", { action: "left_click", coordinate: [200, 400] }), /on button "Proceed To Checkout"\./);
  target = 'iframe "" src=googleads.g.doubleclick.net';
  assert.match(await browser.run("browser", { action: "left_click", coordinate: [200, 400] }), /on iframe "" src=googleads\.g\.doubleclick\.net\. This point is inside an embedded frame/);
}
console.log("experiments checks passed");
