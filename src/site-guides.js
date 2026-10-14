// Short notes on how particular sites work, given to the model the first time a
// conversation reaches one of them, so they cost nothing on every other site. Keyed by
// hostname; a key also matches its subdomains. Each note stays under the compaction
// limit (COMPACT_TEXT_CHARS in agent.js) so it survives trimming.

const GUIDES = {
  "macmillanlearning.com": `Site notes for Macmillan Learning (Achieve):
- Students reach it from their Canvas course: the "Macmillan Learning" link in the course menu, or an Achieve assignment in Modules, which opens in a new tab. Starting from Canvas keeps the account and grade sync linked.
- The first visit may ask to create or link an account or to enter an access code; ask the user to do that.
- If Achieve shows a sign-in page, ask the user to sign in; do not enter credentials.`,
};

// Canvas LMS, on any school's site: known Canvas hosts with a note of their own, and any
// other page Browser.isCanvas recognizes.
const CANVAS_HOSTS = {
  "instructure.com": "",
  "catcourses.ucmerced.edu": `- This is CatCourses, UC Merced's Canvas. Sign-in is UC Merced single sign-on with Duo. Choosing "Yes, this is my device" in Duo lets this browser skip Duo until the session expires.\n`,
};

const CANVAS = `Site notes for Canvas (a school's learning site):
- On a sign-in, single sign-on or Duo page, ask the user to sign in; do not enter credentials.
{host}{tool}- Pages: / (dashboard), /courses, /courses/<id>, and under it /assignments, /assignments/<id>, /modules, /grades, /announcements, /discussion_topics, /files; /calendar, /conversations (inbox).
- The JSON API works with the signed-in session and is cheaper than screenshots: navigate to it, then get_page_text (ignore a leading "while(1);"). E.g. /api/v1/courses?enrollment_state=active, /api/v1/planner/items?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&per_page=100 (all due in a range), /api/v1/courses/<id>/assignments?include[]=submission, /api/v1/users/self/todo, /api/v1/conversations/unread_count.
- Publisher tools (Macmillan Achieve and others) open from Modules or assignment links, often in a new tab (switch with tabs). One in a frame: use its "Load in a new window" button; page tools cannot read another site's frame.`;

const CANVAS_TOOL_NOTE = "- Answer questions about courses, due dates, grades, announcements, to-dos, modules and the inbox with the canvas tool first: one call does what many page reads would. Open an item's url only when the user wants it open or the answer is not in the result.\n";

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

const under = (host, key) => host === key || host.endsWith(`.${key}`);

// The known Canvas host entry a URL is on, or null. www.instructure.com is the company's
// own site, not a Canvas.
function canvasHost(url) {
  const host = hostOf(url);
  if (!host || host === "www.instructure.com" || host === "instructure.com") return null;
  return Object.keys(CANVAS_HOSTS).find((k) => under(host, k)) ?? null;
}

export const isCanvasHost = (url) => canvasHost(url) !== null;

// The note for a URL's site, and the key it was found under, or null. canvas: the page was
// recognized as Canvas by its contents. tool: the canvas tool is available.
export function siteGuide(url, { canvas = false, tool = true } = {}) {
  const host = hostOf(url);
  if (!host) return null;
  const known = canvasHost(url);
  if (known !== null || canvas) {
    const text = CANVAS.replace("{host}", known ? CANVAS_HOSTS[known] : "").replace("{tool}", tool ? CANVAS_TOOL_NOTE : "");
    return { key: "canvas", text };
  }
  const key = Object.keys(GUIDES).find((k) => under(host, k));
  return key ? { key, text: GUIDES[key] } : null;
}
