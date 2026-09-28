// Short notes on how particular sites work, given to the model the first time a
// conversation reaches one of them, so they cost nothing on every other site. Keyed by
// hostname; a key also matches its subdomains. Each note stays under the compaction
// limit (COMPACT_TEXT_CHARS in agent.js) so it survives trimming.

const GUIDES = {
  "catcourses.ucmerced.edu": `Site notes for CatCourses (UC Merced's Canvas):
- Sign-in is UC Merced single sign-on with Duo. On a login or Duo page, ask the user to sign in; do not enter credentials.
- Pages by URL: / (dashboard), /courses (all courses), /courses/<id> (course home), /courses/<id>/assignments, /courses/<id>/modules, /courses/<id>/grades, /courses/<id>/announcements, /courses/<id>/discussion_topics, /courses/<id>/files, /calendar, /conversations (inbox).
- To look things up, Canvas's JSON API works with the signed-in session and is much cheaper than screenshots: navigate to the URL, then get_page_text (ignore a leading "while(1);"). Examples: /api/v1/courses?enrollment_state=active&per_page=50 (courses), /api/v1/planner/items?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&per_page=100 (everything due in a date range, across courses, with html_url and submission status), /api/v1/courses/<id>/assignments?bucket=upcoming&order_by=due_at&include[]=submission&per_page=50, /api/v1/users/self/todo.
- Publisher tools (Macmillan Achieve and others) open from Modules or assignment links, usually in a new tab; switch to it with tabs. If one shows inside a frame on the Canvas page, use its "Load in a new window" button, since page tools cannot read into another site's frame.`,
  "macmillanlearning.com": `Site notes for Macmillan Learning (Achieve):
- Students reach it from their Canvas course: the "Macmillan Learning" link in the course menu, or an Achieve assignment in Modules, which opens in a new tab. Starting from Canvas keeps the account and grade sync linked.
- The first visit may ask to create or link an account or to enter an access code; ask the user to do that.
- If Achieve shows a sign-in page, ask the user to sign in; do not enter credentials.`,
};

// The note for a URL's site, and the key it was found under, or null.
export function siteGuide(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const key = Object.keys(GUIDES).find((k) => host === k || host.endsWith(`.${k}`));
  return key ? { key, text: GUIDES[key] } : null;
}
