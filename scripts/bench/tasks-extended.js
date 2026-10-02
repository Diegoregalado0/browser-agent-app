// The extended Browsby task set for measuring a fine-tune: the 10 original tasks plus new
// ones spread across public sites, same shape as scripts/bench/tasks.js (id, name, prompt,
// check) and loadable with `run.js --taskfile tasks-extended.js`.
//
// Every task is read-only: no logins, no purchases, nothing that posts or sends data to a
// site beyond an ordinary search or a sandbox form built for practice. Targets are stable
// facts (a 1969 landing date, a book's price on a scraping sandbox) rather than live
// content, and each check is deterministic: a URL pattern, text the page must show, or a
// fact the reply must state.
//
// Extra fields on each task:
//   site        the site the task is about (the grouping key)
//   difficulty  easy (about 1 to 4 steps), medium (5 to 12), hard (13 or more)
//   split       "train" or "heldout". Held-out sites never appear in the training split,
//               so the evaluation measures generalization to unseen sites.

import { TASKS as ORIGINAL } from "./tasks.js";

export const HELDOUT_SITES = ["wiktionary.org", "gutenberg.org", "scrapethissite.com", "example.com", "openlibrary.org", "developer.mozilla.org"];

const has = (text, re) => re.test(text || "");

const urlTask = (re, label) => ({ finalUrl }) => {
  const ok = re.test(finalUrl);
  return { ok, reason: ok ? label : `final URL was ${finalUrl}` };
};

const replyTask = (...res) => ({ reply }) => {
  const missing = res.filter((re) => !has(reply, re));
  return { ok: !missing.length, reason: missing.length ? `reply did not match ${missing.join(", ")}` : "reply states the expected facts" };
};

// Each checkbox's wording is read from its own segment of the reply, so "unchecked" is never
// mistaken for "checked".
const checkboxStates = ({ reply }) => {
  const text = reply || "";
  const segment = (n) => {
    const start = text.search(new RegExp(`check\\s?box\\s*#?${n}\\b`, "i"));
    if (start < 0) return "";
    const rest = text.slice(start + 1);
    const next = rest.search(/check\s?box\s*#?\d\b/i);
    return next < 0 ? rest : rest.slice(0, next);
  };
  const off = /\b(unchecked|unticked|not (checked|ticked)|empty|off)\b/i;
  const on = /\b(checked|ticked|selected|on)\b/i;
  const one = segment(1);
  const two = segment(2);
  const ok = !!one && !!two && on.test(one) && !off.test(one) && off.test(two);
  return { ok, reason: ok ? "checkbox 1 on and checkbox 2 off" : `reply states: 1="${one.trim()}" 2="${two.trim()}"` };
};

const urlAndText = (urlRe, textRe, label) => ({ finalUrl, pageText, reply }) => {
  const onUrl = urlRe.test(finalUrl);
  const hasText = has(pageText, textRe) || has(reply, textRe);
  return { ok: onUrl && hasText, reason: onUrl && hasText ? label : `url=${finalUrl} textFound=${hasText}` };
};

const ORIGINAL_META = {
  "hn-page2": ["news.ycombinator.com", "easy"],
  "book-product-page": ["books.toscrape.com", "medium"],
  "lasagna-recipe": ["open-web", "medium"],
  "httpbin-form": ["httpbin.org", "medium"],
  "youtube-play": ["youtube.com", "medium"],
  "wikipedia-compare": ["wikipedia.org", "medium"],
  "checkout-stop-at-payment": ["automationexercise.com", "hard"],
  "github-issue": ["github.com", "easy"],
  "osm-directions": ["openstreetmap.org", "medium"],
  "dismiss-popup": ["the-internet.herokuapp.com", "easy"],
};

const task = (site, difficulty, id, name, prompt, check) => ({ id, name, prompt, check, site, difficulty });

const NEW_TASKS = [
  // news.ycombinator.com
  task("news.ycombinator.com", "easy", "hn-item-author", "HN item author", "Open https://news.ycombinator.com/item?id=8863 and tell me which user submitted it.", replyTask(/dhouston/i)),
  task("news.ycombinator.com", "easy", "hn-newest", "HN newest page", "On Hacker News, open the \"new\" listing of the newest submissions.", urlTask(/news\.ycombinator\.com\/newest/, "on the newest listing")),
  task("news.ycombinator.com", "medium", "hn-ask-top", "HN Ask section", "On Hacker News, open the \"ask\" section and tell me the title of the first story listed.", ({ finalUrl, reply }) => {
    const ok = /news\.ycombinator\.com\/ask/.test(finalUrl) && reply.trim().length > 0;
    return { ok, reason: ok ? "on Ask and named a story" : `url=${finalUrl}` };
  }),

  // books.toscrape.com
  task("books.toscrape.com", "easy", "books-first-price", "First book price", "On books.toscrape.com, tell me the title and price of the book \"A Light in the Attic\".", replyTask(/light in the attic/i, /51\.77/)),
  task("books.toscrape.com", "medium", "books-mystery-count", "Mystery category size", "On books.toscrape.com, open the \"Mystery\" category and tell me how many books it contains.", replyTask(/\b32\b/)),
  task("books.toscrape.com", "medium", "books-poetry-count", "Poetry category size", "On books.toscrape.com, open the \"Poetry\" category and tell me how many books it lists.", replyTask(/\b19\b/)),
  task("books.toscrape.com", "hard", "books-page-two-third", "Third book on page 2", "On books.toscrape.com, go to the second page of the full catalogue and tell me the title of the third book listed.", ({ finalUrl, reply }) => {
    const onUrl = /books\.toscrape\.com\/catalogue\/page-2\.html/.test(finalUrl);
    const named = /foolproof preserving/i.test(reply || "");
    return { ok: onUrl && named, reason: onUrl && named ? "on catalogue page 2 and named the third book" : `url=${finalUrl} named=${named}` };
  }),

  // quotes.toscrape.com
  task("quotes.toscrape.com", "easy", "quotes-first-author", "First quote author", "On quotes.toscrape.com, tell me who said the first quote on the home page.", replyTask(/einstein/i)),
  task("quotes.toscrape.com", "medium", "quotes-einstein-born", "Author birth details", "On quotes.toscrape.com, open the author page for Albert Einstein and tell me his birth date and birthplace.", replyTask(/march 14, 1879/i, /ulm/i)),
  task("quotes.toscrape.com", "easy", "quotes-page-two", "Quotes page 2", "On quotes.toscrape.com, go to the second page of quotes.", urlTask(/quotes\.toscrape\.com\/page\/2\/?$/, "on page 2")),
  task("quotes.toscrape.com", "medium", "quotes-tag-love", "Browse by tag", "On quotes.toscrape.com, click the tag \"love\" in the Top Ten Tags and stay on that tag's listing.", urlTask(/quotes\.toscrape\.com\/tag\/love\/?/, "on the love tag listing")),

  // httpbin.org
  task("httpbin.org", "easy", "httpbin-teapot", "Teapot status page", "Open httpbin.org/status/418 and tell me what the page says.", replyTask(/teapot/i)),
  task("httpbin.org", "easy", "httpbin-html-author", "httpbin sample HTML", "Open httpbin.org/html and tell me who wrote the passage shown.", replyTask(/melville/i)),
  task("httpbin.org", "medium", "httpbin-links", "Follow a generated link", "Open httpbin.org/links/5/0 and follow the link labelled \"3\".", urlTask(/httpbin\.org\/links\/5\/3/, "on link page 3")),

  // the-internet.herokuapp.com
  task("the-internet.herokuapp.com", "easy", "heroku-dropdown", "Select a dropdown option", "Go to the-internet.herokuapp.com/dropdown, choose \"Option 2\" and tell me what is selected.", replyTask(/option 2/i)),
  task("the-internet.herokuapp.com", "easy", "heroku-checkboxes", "Toggle checkboxes", "Go to the-internet.herokuapp.com/checkboxes, tick checkbox 1 and untick checkbox 2, then tell me the final state of both.", checkboxStates),
  task("the-internet.herokuapp.com", "medium", "heroku-dynamic-loading", "Wait for dynamic content", "Go to the-internet.herokuapp.com/dynamic_loading/1, press Start, wait for the content and tell me the text that appears.", replyTask(/hello world/i)),
  task("the-internet.herokuapp.com", "medium", "heroku-add-remove", "Add and remove elements", "Go to the-internet.herokuapp.com/add_remove_elements/, click \"Add Element\" three times, then remove one, and tell me how many Delete buttons remain.", replyTask(/\b(2|two)\b/i)),
  task("the-internet.herokuapp.com", "medium", "heroku-js-alert", "Accept a JavaScript alert", "Go to the-internet.herokuapp.com/javascript_alerts, trigger the plain JS Alert, accept it and tell me the result message shown.", replyTask(/successfully clicked an alert/i)),

  // wikipedia.org
  task("wikipedia.org", "easy", "wiki-apollo11", "Apollo 11 landing date", "On Wikipedia, find the Apollo 11 article and tell me the date of the first Moon landing.", replyTask(/july 20,? 1969|20 july 1969/i)),
  task("wikipedia.org", "easy", "wiki-python-creator", "Python creator", "On Wikipedia, open the Python (programming language) article and tell me who created it.", replyTask(/guido van rossum/i)),
  task("wikipedia.org", "medium", "wiki-curie-prizes", "Marie Curie's Nobel prizes", "On Wikipedia, open the Marie Curie article and tell me in which two fields she won Nobel Prizes.", replyTask(/physics/i, /chemistry/i)),
  task("wikipedia.org", "medium", "wiki-australia-capital", "Capital by following links", "Starting at the Wikipedia article for Australia, follow the link to its capital city and tell me the capital's name.", replyTask(/canberra/i)),

  // wiktionary.org
  task("wiktionary.org", "easy", "wikt-ephemeral", "Part of speech lookup", "On en.wiktionary.org, look up the word \"ephemeral\" and tell me its first listed part of speech.", replyTask(/adjective/i)),
  task("wiktionary.org", "medium", "wikt-serendipity-origin", "Etymology lookup", "On en.wiktionary.org, look up \"serendipity\" and tell me which story or place its etymology refers to.", replyTask(/serendip|sri lanka|ceylon|three princes/i)),
  task("wiktionary.org", "medium", "wikt-translation-german", "Translation lookup", "On en.wiktionary.org, look up \"library\" and tell me the German translation of its main noun sense.", replyTask(/bibliothek/i)),

  // github.com
  task("github.com", "easy", "gh-flask-license", "Repository license", "Go to github.com/pallets/flask and tell me which license the repository uses.", replyTask(/\bbsd\b/i)),
  task("github.com", "easy", "gh-react-license", "Another repository license", "Go to github.com/facebook/react and tell me which license the repository uses.", replyTask(/\bmit\b/i)),
  task("github.com", "medium", "gh-django-readme", "Repository file navigation", "Go to github.com/django/django, open the README file from the file list and tell me the project's tagline.", replyTask(/web framework/i)),

  // docs.python.org
  task("docs.python.org", "medium", "pydocs-lru-cache", "Docs parameter default", "In the Python 3 docs for the functools module, find functools.lru_cache and tell me the default value of maxsize.", replyTask(/128/)),
  task("docs.python.org", "medium", "pydocs-json-dumps", "Docs function lookup", "In the Python 3 docs, open the json module page and tell me what json.dumps returns.", replyTask(/\bstr(ing)?\b/i)),

  // developer.mozilla.org
  task("developer.mozilla.org", "easy", "mdn-teapot", "MDN HTTP status", "On MDN, open the documentation for HTTP status 418 and tell me its status text.", replyTask(/teapot/i)),
  task("developer.mozilla.org", "medium", "mdn-array-flat", "MDN default parameter", "On MDN, open Array.prototype.flat and tell me the default value of its depth parameter.", replyTask(/\b(1|one)\b/i)),

  // gutenberg.org
  task("gutenberg.org", "easy", "gutenberg-pride", "Ebook author", "Open gutenberg.org/ebooks/1342 and tell me the book's title and author.", replyTask(/pride and prejudice/i, /austen/i)),
  task("gutenberg.org", "medium", "gutenberg-frankenstein", "Search an ebook", "On gutenberg.org, search for \"Frankenstein\" and open the book by Mary Wollstonecraft Shelley.", urlAndText(/gutenberg\.org\/ebooks\/\d+/, /(?=[\s\S]*frankenstein)(?=[\s\S]*shelley)/i, "on the Frankenstein ebook page")),

  // openlibrary.org
  task("openlibrary.org", "medium", "openlibrary-hobbit", "Library search", "On openlibrary.org, search for \"The Hobbit\" and tell me who the author of the top result is.", replyTask(/tolkien/i)),

  // scrapethissite.com
  task("scrapethissite.com", "easy", "scrape-andorra", "Country table lookup", "Open scrapethissite.com/pages/simple/ and tell me the capital of Andorra.", replyTask(/andorra la vella/i)),
  task("scrapethissite.com", "medium", "scrape-hockey-search", "Search form", "Open scrapethissite.com/pages/forms/, search for the team name \"Boston\" and leave the results on screen.", urlAndText(/scrapethissite\.com\/pages\/forms\/.*q=Boston/i, /Boston Bruins/, "results for Boston shown")),
  task("scrapethissite.com", "hard", "scrape-oscar-2015", "Click-through dynamic table", "Open scrapethissite.com/pages/ajax-javascript/, select the year 2015 and tell me which film is marked as the Best Picture winner.", replyTask(/spotlight/i)),

  // example.com
  task("example.com", "easy", "example-purpose", "Read the page text", "Open example.com and tell me what the page says the domain is for.", replyTask(/documentation/i)),
  task("example.com", "medium", "example-follow-link", "Follow the page's link", "Open example.com and follow its \"Learn more\" or \"More information\" link.", urlTask(/iana\.org\//, "reached the IANA page")),

  // automationexercise.com
  task("automationexercise.com", "medium", "autoex-search", "Product search", "On automationexercise.com, open the Products page and search for \"tshirt\".", urlAndText(/automationexercise\.com\/products\?search=/i, /searched products/i, "search results shown")),
  task("automationexercise.com", "medium", "autoex-product-price", "Product detail", "On automationexercise.com, open the product details page for \"Blue Top\" and tell me its price.", replyTask(/rs\.?\s?500/i)),

  // openstreetmap.org
  task("openstreetmap.org", "medium", "osm-search-brandenburg", "Place search", "On openstreetmap.org, search for \"Brandenburg Gate\" and open its result.", urlAndText(/openstreetmap\.org\/(node|way|relation)\/\d+/, /brandenburg/i, "opened the place page")),

  // youtube.com
  task("youtube.com", "medium", "youtube-search-results", "Search results page", "On youtube.com, search for \"lofi hip hop radio\" and stay on the results page.", urlTask(/youtube\.com\/results\?search_query=/, "on the results page")),
];

export const TASKS = [
  ...ORIGINAL.map((t) => ({ ...t, site: ORIGINAL_META[t.id][0], difficulty: ORIGINAL_META[t.id][1] })),
  ...NEW_TASKS,
].map((t) => ({ ...t, split: HELDOUT_SITES.includes(t.site) ? "heldout" : "train" }));
