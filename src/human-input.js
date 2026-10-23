// Human-like mouse and typing, for internal builds only (BROWSBY_HUMAN_INPUT=1 npm run
// build:extension); the store build leaves this module and ghost-cursor out.
//
// The path's shape and the overshoot on long moves are ghost-cursor's (ISC,
// github.com/Xetera/ghost-cursor): a Bezier curve bent to one side, sampled by Fitts's law.
// Its own timing puts hundreds of milliseconds between points and sends them without
// waiting, so the timing here is ours: Fitts's law for each move's duration, a
// minimum-jerk speed profile (fast in the middle, slow at both ends), and log-normal pauses,
// which are mostly short and sometimes long like a person's.
import { path } from "ghost-cursor";
import { overshoot } from "ghost-cursor/lib/math.js";
import { sleep } from "./limits.js";

// Medians in ms; starting values, to be calibrated against a recorded real mouse.
const BEFORE_PRESS_MS = 140;
const HOLD_MS = 95;
const BETWEEN_CLICKS_MS = 130;
const DRAG_HOLD_MS = 170;
const DROP_MS = 180;
const KEY_MS = 170;
const SCROLL_TICK_MS = 28;
const STEP_MS = 16;
// ghost-cursor's move(): past this distance the pointer lands near the target first.
const OVERSHOOT_THRESHOLD = 500;
const OVERSHOOT_RADIUS = 120;
const OVERSHOOT_SPREAD = 10;

const normal = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());

// A log-normal duration around median ms, kept within a third and three times the median.
export const pause = (median, sigma = 0.35) => Math.min(median * 3, Math.max(median / 3, median * Math.exp(sigma * normal())));

// Fitts's law: 100 + 150 * log2(distance / width + 1) ms, varied about 25%.
export const moveMs = (distance, width = 40) => pause(100 + 150 * Math.log2(distance / Math.max(width, 4) + 1), 0.25);

const jerk = (t) => t * t * t * (10 - 15 * t + 6 * t * t);

// A point inside the box, near its center more often than near its edges.
export function boxPoint({ x, y, w = 0, h = 0 }) {
  const off = (size) => Math.max(-0.4 * size, Math.min(0.4 * size, (normal() * size) / 6));
  return { x: Math.round(x + off(w)), y: Math.round(y + off(h)) };
}

// One stroke along ghost-cursor's curve; the visible pointer (show) follows the same points.
async function stroke(io, from, to, width, extra, spread, slow = 1) {
  const curve = path(from, { ...to, width }, spread === undefined ? {} : { spreadOverride: spread });
  const ms = moveMs(Math.hypot(to.x - from.x, to.y - from.y), width) * slow;
  const steps = Math.max(2, Math.round(ms / STEP_MS));
  const start = performance.now();
  let last = from;
  for (let k = 1; k <= steps; k++) {
    const at = jerk(k / steps) * (curve.length - 1);
    const i = Math.floor(at);
    const a = curve[i];
    const b = curve[Math.min(i + 1, curve.length - 1)];
    const p = k === steps ? to : { x: a.x + (b.x - a.x) * (at - i), y: a.y + (b.y - a.y) * (at - i) };
    await io.mouse("mouseMoved", p.x, p.y, extra);
    if (io.show) await io.show(last, p, STEP_MS, false);
    last = p;
    await sleep(Math.max(0, start + (ms * k) / steps - performance.now()));
  }
}

// Moves from `from` to `to`; a long move lands near the target, then corrects onto it.
export async function move(io, from, to, { width = 40, drag = false, modifiers = 0, click = false, slow = 1 } = {}) {
  const extra = { modifiers, ...(drag ? { button: "left", buttons: 1 } : {}) };
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  // Already there (a second scroll at the page's center): ghost-cursor's curve divides by the
  // distance and returns null points, which Chrome rejects ("params.x ... missing").
  if (distance < 2) {
    await io.mouse("mouseMoved", to.x, to.y, extra);
    if (click && io.show) await io.show(to, to, 0, true);
    return;
  }
  if (distance > OVERSHOOT_THRESHOLD) {
    const near = overshoot(to, OVERSHOOT_RADIUS);
    await stroke(io, from, near, width, extra, undefined, slow);
    await stroke(io, near, to, width, extra, OVERSHOOT_SPREAD, slow);
  } else await stroke(io, from, to, width, extra, undefined, slow);
  if (click && io.show) await io.show(to, to, 0, true);
}

// Clicks a point inside the target box ({ x, y } center, w and h when known); returns it.
export async function click(io, from, target, { button = "left", count = 1, modifiers = 0 } = {}) {
  const at = boxPoint(target);
  await move(io, from, at, { width: target.w || 40, modifiers, click: true });
  await sleep(pause(BEFORE_PRESS_MS));
  for (let i = 1; i <= count; i++) {
    await io.mouse("mousePressed", at.x, at.y, { button, clickCount: i, modifiers });
    await sleep(pause(HOLD_MS, 0.25));
    await io.mouse("mouseReleased", at.x, at.y, { button, clickCount: i, modifiers });
    if (i < count) await sleep(pause(BETWEEN_CLICKS_MS, 0.25));
  }
  return at;
}

// Presses at a, waits, moves to b more slowly than a pointing move, rests there, releases.
export async function drag(io, from, a, b) {
  await move(io, from, a);
  await sleep(pause(BEFORE_PRESS_MS));
  await io.mouse("mousePressed", a.x, a.y, { button: "left", clickCount: 1 });
  await sleep(pause(DRAG_HOLD_MS));
  await move(io, a, b, { drag: true, slow: 1.5 });
  await sleep(pause(DROP_MS));
  await io.mouse("mouseReleased", b.x, b.y, { button: "left", clickCount: 1 });
}

// Scrolls in wheel ticks of about 100 px, like a mouse wheel, instead of one jump.
export async function scroll(io, x, y, deltaX, deltaY) {
  const ticks = Math.max(1, Math.round(Math.max(Math.abs(deltaX), Math.abs(deltaY)) / 100));
  for (let i = 0; i < ticks; i++) {
    await io.mouse("mouseWheel", x, y, { deltaX: deltaX / ticks, deltaY: deltaY / ticks });
    if (i < ticks - 1) await sleep(pause(SCROLL_TICK_MS));
  }
}

// The gap before the next keystroke; long text speeds up so typing stays near 15 s at most.
export const keyGap = (chars) => pause(Math.min(KEY_MS, 15000 / Math.max(chars, 1)));
