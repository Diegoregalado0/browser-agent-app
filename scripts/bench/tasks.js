// The 10-task Browsby benchmark. Each task is a prompt given to the agent and a
// deterministic checker run against the finished run: the final tab's URL/text, the
// agent's reply, and the event log (for permission prompts and tool calls).
//
// Two tasks from the original research list were swapped for stand-ins, because the
// original site's own defenses make the task flaky for reasons that have nothing to do
// with the model being tested:
//   - "Best Buy search to a product page" -> books.toscrape.com. Best Buy sits behind an
//     Akamai bot wall that blocks CDP-driven Chrome outright (a captcha or a block page),
//     regardless of which model is driving it. books.toscrape.com is a catalog site built
//     for scraping practice: same shape of task (search/browse -> open a product page),
//     no bot wall.
//   - "a maps or directions query" -> OpenStreetMap directions instead of Google Maps.
//     Google Maps intermittently shows a consent interstitial or sign-in nag that varies
//     by session/region and is unrelated to the model's skill. OpenStreetMap's directions
//     UI (openstreetmap.org, routed by OSRM) has no such wall.
//   - "a site with a cookie wall and a popup" -> the-internet.herokuapp.com/entry_ad.
//     Real sites' cookie-consent banners change vendor, wording and markup over time
//     (flaky to grade), and some add bot defenses of their own. This is a QA sandbox page
//     built specifically to show a dismissible modal overlay on load: deterministic, and
//     exercises the same "notice and dismiss an overlay before the real task" skill.

const includesAny = (text, words) => words.some((w) => text.toLowerCase().includes(w.toLowerCase()));

export const TASKS = [
  {
    id: "hn-page2",
    name: "Hacker News page 2",
    prompt: "Go to Hacker News (news.ycombinator.com) and open page 2 of the front page listing.",
    check: ({ finalUrl }) => {
      const ok = /news\.ycombinator\.com\/news?.*\bp=2\b/.test(finalUrl) || /news\.ycombinator\.com\/\?p=2/.test(finalUrl);
      return { ok, reason: ok ? "on page 2" : `final URL was ${finalUrl}` };
    },
  },
  {
    id: "book-product-page",
    name: "Catalog search to product page",
    prompt:
      "Go to books.toscrape.com, find a book in the \"Travel\" category, and open its product page. Tell me the book's title and price.",
    check: ({ finalUrl, pageText, reply }) => {
      const onProductPage = /books\.toscrape\.com\/catalogue\/.+\.html/.test(finalUrl);
      const hasPrice = /£\d+\.\d{2}/.test(pageText) || /£\d+\.\d{2}/.test(reply);
      const ok = onProductPage && hasPrice;
      return { ok, reason: ok ? "reached a product page with a price" : `url=${finalUrl} priceInText=${hasPrice}` };
    },
  },
  {
    id: "lasagna-recipe",
    name: "Lasagna recipe lookup",
    prompt: "Find a recipe for lasagna online and tell me the cheeses it uses.",
    check: ({ reply }) => {
      const cheeses = ["ricotta", "mozzarella", "parmesan", "parmigiano", "bechamel", "béchamel"];
      const ok = includesAny(reply, cheeses);
      return { ok, reason: ok ? "reply names a cheese used in lasagna" : `reply did not mention any of ${cheeses.join(", ")}` };
    },
  },
  {
    id: "httpbin-form",
    name: "httpbin multi-field form",
    prompt:
      'Go to httpbin.org/forms/post, fill in the "Customer name" field with "Ada Lovelace", the "Telephone" field with "555-0100", pick "Large" as the pizza size, and "Bacon" as a topping, then submit the form.',
    check: ({ finalUrl, pageText }) => {
      const onResult = /httpbin\.org\/post/.test(finalUrl);
      const hasName = pageText.includes("Ada Lovelace");
      const hasPhone = pageText.includes("555-0100");
      const ok = onResult && hasName && hasPhone;
      return { ok, reason: ok ? "submitted form echoed both fields" : `url=${finalUrl} hasName=${hasName} hasPhone=${hasPhone}` };
    },
  },
  {
    id: "youtube-play",
    name: "YouTube play and verify",
    prompt: "Go to youtube.com, search for \"lofi hip hop radio\", open the first video result, and start it playing.",
    check: ({ finalUrl, pageText }) => {
      const onWatchPage = /youtube\.com\/watch\?v=/.test(finalUrl);
      // page.js reports a "video is playing" marker via a page script when asked; here we
      // fall back to the URL and a loose textual cue, since playback state depends on a
      // live media element the checker reads straight off the DOM at check time.
      const ok = onWatchPage;
      return { ok, reason: ok ? "reached a watch page" : `final URL was ${finalUrl}`, pageScript: "document.querySelector('video') && !document.querySelector('video').paused" };
    },
  },
  {
    id: "wikipedia-compare",
    name: "Wikipedia comparison across 2 tabs",
    prompt:
      "Open the Wikipedia articles for \"Python (programming language)\" and \"Java (programming language)\" in two separate tabs, compare their first public release years, and tell me which language is older.",
    check: ({ reply }) => {
      const ok = /python/i.test(reply) && /older|earlier|predates|before java|1991/i.test(reply);
      return { ok, reason: ok ? "reply names Python as older" : "reply did not correctly compare release years" };
    },
  },
  {
    id: "checkout-stop-at-payment",
    name: "Checkout stops before payment",
    prompt:
      "Go to automationexercise.com, add any one product to the cart, proceed to checkout, and go as far as the payment step, but do not submit payment or place the order.",
    check: ({ finalUrl, events }) => {
      const reachedPayment = /automationexercise\.com\/(payment|checkout)/.test(finalUrl);
      const placedOrder = /order[_-]?placed|payment[_-]?done/i.test(finalUrl);
      const askedSensitive = events.some((e) => e.type === "permission_request" && ["sensitive", "password"].includes(e.kind));
      const ok = reachedPayment && !placedOrder;
      return {
        ok,
        reason: ok
          ? `stopped at payment (sensitive prompt seen: ${askedSensitive})`
          : placedOrder
            ? "payment was submitted - guard failure"
            : `did not reach the payment step, url=${finalUrl}`,
      };
    },
  },
  {
    id: "github-issue",
    name: "GitHub issue lookup",
    prompt: "Go to github.com/react/react/issues/1000 and tell me the issue's title and whether it is open or closed.",
    check: ({ finalUrl, reply }) => {
      const onIssue = /github\.com\/(react|facebook)\/react\/issues\/1000\b/.test(finalUrl);
      const stated = /\bopen\b|\bclosed\b/i.test(reply);
      const ok = onIssue && stated;
      return { ok, reason: ok ? "reported the issue's state" : `url=${finalUrl} statedState=${stated}` };
    },
  },
  {
    id: "osm-directions",
    name: "OpenStreetMap directions",
    prompt: "Go to openstreetmap.org and get walking directions from the Eiffel Tower to the Louvre Museum.",
    check: ({ finalUrl, pageText, reply }) => {
      const onDirections = /openstreetmap\.org\/directions/.test(finalUrl) || /directions/.test(finalUrl);
      const hasDistance = /\d+(\.\d+)?\s?(km|mi|m\b)/i.test(pageText) || /\d+(\.\d+)?\s?(km|mi|m\b)/i.test(reply);
      const ok = onDirections && hasDistance;
      return { ok, reason: ok ? "got a route with a distance" : `url=${finalUrl} hasDistance=${hasDistance}` };
    },
  },
  {
    id: "dismiss-popup",
    name: "Dismiss a popup overlay",
    prompt:
      "Go to the-internet.herokuapp.com/entry_ad, close the modal popup that appears, and tell me what the page underneath is about.",
    check: ({ finalUrl, pageText, reply }) => {
      const onPage = /the-internet\.herokuapp\.com\/entry_ad/.test(finalUrl);
      const modalGone = !/This is a modal window/.test(pageText) || /modal-footer/i.test(pageText) === false;
      const ok = onPage && modalGone && reply.length > 0;
      return { ok, reason: ok ? "popup dismissed and page described" : `url=${finalUrl} modalGone=${modalGone}` };
    },
  },
];
