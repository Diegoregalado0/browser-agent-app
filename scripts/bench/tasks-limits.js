// The limits ladder: graded rungs along six dimensions, each checked deterministically on
// public, login-free sites, to find how long and how complex a task the model under test
// can finish. Same shape as tasks.js (prompt or prompts + check), plus:
//   - dim: horizon | breadth | memory | precision | recovery
//   - rung: the rung's level on that dimension (roughly the steps, sources, fields or
//     obstacles it needs), so scripts/bench/stress-report.js can line rungs up.
//   - check returns score (0..1, the share of expected values right) next to ok.
// Nothing here buys, posts, or submits anything: forms are filled but left unsent, and the
// checker reads the filled-in values off the page (run.js passes formValues).
// Ground truth was read off the sites on 2026-10-04: books.toscrape.com and
// quotes.toscrape.com are static scraping sandboxes, scrapethissite.com serves fixed
// datasets, and the-internet.herokuapp.com is a QA sandbox.
// Run: node scripts/bench/run.js ... --taskfile tasks-limits.js --max-steps 300
//        --no-usage-limits --debug --timeout 7200000 --stall-ms 600000 --sample-ms 7000

const TRAVEL = [["It's Only the Himalayas", 19], ["Full Moon over Noah’s Ark: An Odyssey to Mount Ararat and Beyond", 15], ["See America: A Celebration of Our National Parks & Treasured Sites", 14], ["Vagabonding: An Uncommon Guide to the Art of Long-Term World Travel", 8], ["Under the Tuscan Sun", 7], ["A Summer In Europe", 7], ["The Great Railway Bazaar", 6], ["A Year in Provence (Provence #1)", 6], ["The Road to Little Dribbling: Adventures of an American in Britain (Notes From a Small Island #2)", 3], ["Neither Here nor There: Travels in Europe", 3], ["1,000 Places to See Before You Die", 1]];
const MYSTERY = [["Sharp Objects", 20], ["In a Dark, Dark Wood", 18], ["The Past Never Ends", 16], ["A Murder in Time", 16], ["The Murder of Roger Ackroyd (Hercule Poirot #4)", 15], ["The Last Mile (Amos Decker #2)", 14], ["That Darkness (Gardiner and Renner #1)", 14], ["Tastes Like Fear (DI Marnie Rome #3)", 14], ["A Time of Torment (Charlie Parker #14)", 14], ["A Study in Scarlet (Sherlock Holmes #1)", 14], ["Poisonous (Max Revere Novels #3)", 12], ["Murder at the 42nd Street Library (Raymond Ambler #1)", 12], ["Most Wanted", 12], ["Hide Away (Eve Duncan #20)", 12], ["Boar Island (Anna Pigeon #19)", 12], ["The Widow", 11], ["Playing with Fire", 11], ["What Happened on Beale Street (Secrets of the South Mysteries #2)", 7], ["The Bachelor Girl's Guide to Murder (Herringford and Watts Mysteries #1)", 7], ["Delivering the Truth (Quaker Midwife Mystery #1)", 7], ["The Mysterious Affair at Styles (Hercule Poirot #1)", 6], ["In the Woods (Dublin Murder Squad #1)", 6], ["The Silkworm (Cormoran Strike #2)", 3], ["The Exiled", 3], ["The Cuckoo's Calling (Cormoran Strike #1)", 3], ["Extreme Prey (Lucas Davenport #26)", 3], ["Career of Evil (Cormoran Strike #3)", 3], ["The No. 1 Ladies' Detective Agency (No. 1 Ladies' Detective Agency #1)", 1], ["The Girl You Lost", 1], ["The Girl In The Ice (DCI Erika Foster #1)", 1], ["Blood Defense (Samantha Brinkman #1)", 1], ["1st to Die (Women's Murder Club #1)", 1]];
const SEQUENTIAL_ART = [["Scott Pilgrim's Precious Little Life (Scott Pilgrim #1)", 19], ["Tsubasa: WoRLD CHRoNiCLE 2 (Tsubasa WoRLD CHRoNiCLE #2)", 16], ["This One Summer", 16], ["The Nameless City (The Nameless City #1)", 16], ["Saga, Volume 5 (Saga (Collected Editions) #5)", 16], ["Rat Queens, Vol. 3: Demons (Rat Queens (Collected Editions) #11-15)", 16], ["Princess Jellyfish 2-in-1 Omnibus, Vol. 01 (Princess Jellyfish 2-in-1 Omnibus #1)", 16], ["Pop Gun War, Volume 1: Gift", 16], ["Patience", 16], ["Outcast, Vol. 1: A Darkness Surrounds Him (Outcast #1)", 16], ["orange: The Complete Collection 1 (orange: The Complete Collection #1)", 16], ["Lumberjanes, Vol. 2: Friendship to the Max (Lumberjanes #5-8)", 16], ["Lumberjanes, Vol. 1: Beware the Kitten Holy (Lumberjanes #1-4)", 16], ["Lumberjanes Vol. 3: A Terrible Plan (Lumberjanes #9-12)", 16], ["I Hate Fairyland, Vol. 1: Madly Ever After (I Hate Fairyland (Compilations) #1-5)", 16], ["I am a Hero Omnibus Volume 1", 16], ["Giant Days, Vol. 2 (Giant Days #5-8)", 16], ["Danganronpa Volume 1", 16], ["Codename Baboushka, Volume 1: The Conclave of Death", 16], ["Camp Midnight", 16], ["Bitch Planet, Vol. 1: Extraordinary Machine (Bitch Planet (Collected Editions))", 16], ["The Shadow Hero (The Shadow Hero)", 15], ["Fables, Vol. 1: Legends in Exile (Fables #1)", 15], ["Batman: The Long Halloween (Batman)", 15], ["Batman: The Dark Knight Returns (Batman)", 15], ["Wonder Woman: Earth One, Volume One (Wonder Woman: Earth One #1)", 14], ["We Are Robin, Vol. 1: The Vigilante Business (We Are Robin #1)", 14], ["Through the Woods", 14], ["Superman Vol. 1: Before Truth (Superman by Gene Luen Yang #1)", 14], ["So Cute It Hurts!!, Vol. 6 (So Cute It Hurts!! #6)", 14], ["Robin War", 14], ["Red Hood/Arsenal, Vol. 1: Open for Business (Red Hood/Arsenal #1)", 14], ["Naruto (3-in-1 Edition), Vol. 14: Includes Vols. 40, 41 & 42 (Naruto: Omnibus #14)", 14], ["Lowriders to the Center of the Earth (Lowriders in Space #2)", 14], ["El Deafo", 14], ["Batman: Europa", 14], ["Art Ops Vol. 1", 14], ["Adulthood Is a Myth: A \"Sarah's Scribbles\" Collection", 14], ["Fruits Basket, Vol. 9 (Fruits Basket #9)", 9], ["Roller Girl", 8], ["Fruits Basket, Vol. 7 (Fruits Basket #7)", 7], ["Fruits Basket, Vol. 6 (Fruits Basket #6)", 6], ["Death Note, Vol. 6: Give-and-Take (Death Note #6)", 6], ["Fruits Basket, Vol. 5 (Fruits Basket #5)", 5], ["Death Note, Vol. 5: Whiteout (Death Note #5)", 5], ["The Demon Prince of Momochi House, Vol. 4 (The Demon Prince of Momochi House #4)", 4], ["Fruits Basket, Vol. 4 (Fruits Basket #4)", 4], ["The Wicked + The Divine, Vol. 3: Commercial Suicide (The Wicked + The Divine)", 3], ["The Sandman, Vol. 3: Dream Country (The Sandman (volumes) #3)", 3], ["Saga, Volume 3 (Saga (Collected Editions) #3)", 3], ["Prodigy: The Graphic Novel (Legend: The Graphic Novel #2)", 3], ["Persepolis: The Story of a Childhood (Persepolis #1-2)", 3], ["Original Fake", 3], ["Grayson, Vol 3: Nemesis (Grayson #3)", 3], ["Fruits Basket, Vol. 3 (Fruits Basket #3)", 3], ["Black Butler, Vol. 1 (Black Butler #1)", 3], ["Awkward", 3], ["The Sandman, Vol. 2: The Doll's House (The Sandman (volumes) #2)", 2], ["Saga, Volume 2 (Saga (Collected Editions) #2)", 2], ["Fruits Basket, Vol. 2 (Fruits Basket #2)", 2], ["Y: The Last Man, Vol. 1: Unmanned (Y: The Last Man #1)", 1], ["The Wicked + The Divine, Vol. 1: The Faust Act (The Wicked + The Divine)", 1], ["The Sandman, Vol. 1: Preludes and Nocturnes (The Sandman (volumes) #1)", 1], ["The Complete Maus (Maus #1-2)", 1], ["Skip Beat!, Vol. 01 (Skip Beat! #1)", 1], ["Saga, Volume 1 (Saga (Collected Editions) #1)", 1], ["Rat Queens, Vol. 1: Sass & Sorcery (Rat Queens (Collected Editions) #1-5)", 1], ["Paper Girls, Vol. 1 (Paper Girls #1-5)", 1], ["Ouran High School Host Club, Vol. 1 (Ouran High School Host Club #1)", 1], ["Ms. Marvel, Vol. 1: No Normal (Ms. Marvel (2014-2015) #1)", 1], ["Hawkeye, Vol. 1: My Life as a Weapon (Hawkeye #1)", 1], ["Giant Days, Vol. 1 (Giant Days #1-4)", 1], ["Fruits Basket, Vol. 1 (Fruits Basket #1)", 1], ["Bleach, Vol. 1: Strawberry and the Soul Reapers (Bleach #1)", 1], ["Ajin: Demi-Human, Volume 1 (Ajin: Demi-Human #1)", 1]];

// Lowercase letters and digits only: titles and numbers compare across quote styles,
// thousands separators and markdown.
const norm = (s) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9.\n]/g, "");
const key = (title) => norm(title).replace(/\./g, "").slice(0, 24);
const has = (reply, value) => norm(reply).includes(norm(String(value)));
// A number as a whole number in the text (not the prefix of a longer one).
const hasNumber = (text, n) => new RegExp(`(^|[^\\d.])${String(n).replace(".", "\\.")}(?![\\d])`).test(text.replace(/(\d),(?=\d{3})/g, "$1"));

// Share of items whose title and number appear on one line of the reply.
function perLine(reply, items) {
  const lines = reply.split("\n").map((l) => ({ k: norm(l).replace(/\./g, ""), raw: l }));
  // The number is read after the line's last colon, so digits in a title do not count.
  const right = items.filter(([title, n]) => lines.some((l) => l.k.includes(key(title)) && hasNumber(l.raw.split(":").pop(), n)));
  return right.length / items.length;
}

const verdict = (score, parts, extra = true) => {
  const ok = score === 1 && extra;
  return { ok, score: Math.round(score * 100) / 100, reason: ok ? "all expected values right" : parts.filter(Boolean).join("; ") || "missing values" };
};

function stockTask(id, rung, category, books) {
  const total = books.reduce((a, [, n]) => a + n, 0);
  return {
    id,
    dim: "horizon",
    rung,
    name: `Stock of every ${category} book (${books.length} product pages)`,
    prompt:
      `Go to books.toscrape.com and open the "${category}" category. Open the product page of every book in that category (there are ${books.length}, possibly over several pages) and read how many copies are in stock. ` +
      `Reply with one line per book in the form "<title>: <number in stock>", then a final line "Total: <sum of all stock counts>".`,
    check: ({ reply }) => {
      const share = perLine(reply, books);
      const totalOk = hasNumber(reply.split("\n").filter((l) => /total/i.test(l)).join(" "), total);
      return { ...verdict(totalOk ? 1 : 0, [`total ${total} ${totalOk ? "right" : "wrong"}`, `${Math.round(share * 100)}% of per-book counts right`]), score: Math.round(share * 100) / 100 };
    },
  };
}

function catalogueTask(id, rung, pages, cheap, dear) {
  return {
    id,
    dim: "horizon",
    rung,
    name: `Cheapest and dearest book over ${pages} catalogue pages`,
    prompt:
      `Go to books.toscrape.com. The catalogue lists 20 books per page (page 1 is https://books.toscrape.com/catalogue/page-1.html). Look at pages 1 through ${pages} of the catalogue, every book on each page, ` +
      `and find the cheapest and the most expensive book across those ${pages} pages. Reply with each one's exact title and price.`,
    check: ({ reply }) => {
      const parts = [
        [has(reply, cheap[0]) && has(reply, cheap[1]), `cheapest ${cheap[0]} ${cheap[1]}`],
        [has(reply, dear[0]) && has(reply, dear[1]), `most expensive ${dear[0]} ${dear[1]}`],
      ];
      const score = parts.filter(([ok]) => ok).length / parts.length;
      return verdict(score, parts.map(([ok, text]) => `${text}: ${ok ? "right" : "missing"}`));
    },
  };
}

const CATEGORY_COUNTS = [
  ["Mystery", 32], ["Travel", 11], ["Poetry", 19], ["Horror", 17], ["Music", 13], ["Humor", 10], ["History", 18], ["Philosophy", 11],
  ["Science", 14], ["Religion", 7], ["Art", 8], ["Autobiography", 9],
];
function breadthTask(n) {
  const cats = CATEGORY_COUNTS.slice(0, n);
  const fewest = [...cats].sort((a, b) => a[1] - b[1])[0][0];
  return {
    id: `breadth-categories-${n}`,
    dim: "breadth",
    rung: n,
    name: `Compare ${n} catalog categories across ${n} tabs`,
    prompt:
      `On books.toscrape.com, open each of these ${n} categories in its own browser tab: ${cats.map(([c]) => `"${c}"`).join(", ")}. ` +
      `Each category page states how many results (books) it has. Reply with one line per category in the form "<category>: <number of books>", then say which category has the most books and which has the fewest.`,
    check: ({ reply }) => {
      const share = perLine(reply, cats);
      const most = /most[^\n]*mystery|mystery[^\n]*most/i.test(reply);
      const least = new RegExp(`fewest[^\\n]*${fewest}|${fewest}[^\\n]*fewest`, "i").test(reply);
      const v = verdict(share, [`${Math.round(share * 100)}% of counts right`, most ? "" : "most not Mystery", least ? "" : `fewest not ${fewest}`], most && least);
      return v;
    },
  };
}

export const TASKS = [
  // Horizon: required steps from about 10 to 150+.
  {
    id: "horizon-quotes-3",
    dim: "horizon",
    rung: 10,
    name: "Count one author's quotes over 3 pages",
    prompt:
      "Go to quotes.toscrape.com and look at pages 1, 2 and 3 of the quote listing. Count how many of the quotes on those three pages are by Albert Einstein. Reply with the number.",
    check: ({ reply }) => verdict(hasNumber(reply, 6) ? 1 : 0, ["expected 6"]),
  },
  stockTask("horizon-stock-travel", 25, "Travel", TRAVEL),
  catalogueTask("horizon-catalogue-10", 25, 10, ["Patience", "10.16"], ["Thomas Jefferson and the Tripoli Pirates", "59.64"]),
  catalogueTask("horizon-catalogue-25", 55, 25, ["Patience", "10.16"], ["The Diary of a Young Girl", "59.90"]),
  stockTask("horizon-stock-mystery", 70, "Mystery", MYSTERY),
  catalogueTask("horizon-catalogue-50", 105, 50, ["An Abundance of Katherines", "10.00"], ["The Perfect Play", "59.99"]),
  stockTask("horizon-stock-sequential", 160, "Sequential Art", SEQUENTIAL_ART),

  // Breadth: 2, 4, 8 and 12 sources, each in its own tab.
  breadthTask(2),
  breadthTask(4),
  breadthTask(8),
  breadthTask(12),

  // Memory: a fact read early, needed at the end, with a growing amount of work between
  // (past the context compaction that trims old tool output once a request passes 12k tokens).
  {
    id: "memory-upc-gap10",
    dim: "memory",
    rung: 10,
    name: "Recall a UPC after ~10 steps",
    prompt:
      "First, on books.toscrape.com, open the product page of \"It's Only the Himalayas\" (Travel category) and note its UPC. Then go to quotes.toscrape.com and count how many quotes on pages 1 to 3 are by Albert Einstein. " +
      "At the end, reply with the UPC you noted and the Einstein count.",
    check: ({ reply }) => {
      const parts = [[has(reply, "a22124811bfa8350"), "UPC a22124811bfa8350"], [hasNumber(reply, 6), "count 6"]];
      return verdict(parts.filter(([ok]) => ok).length / 2, parts.map(([ok, t]) => `${t}: ${ok ? "right" : "missing"}`));
    },
  },
  {
    id: "memory-upc-gap25",
    dim: "memory",
    rung: 25,
    name: "Recall a UPC after ~25 steps",
    prompt:
      "First, on books.toscrape.com, open the product page of \"Full Moon over Noah's Ark\" (Travel category) and note its UPC. Then go to quotes.toscrape.com and count how many quotes on all 10 pages of the listing are by Albert Einstein. " +
      "At the end, reply with the UPC you noted and the Einstein count.",
    check: ({ reply }) => {
      const parts = [[has(reply, "ce60436f52c5ee68"), "UPC ce60436f52c5ee68"], [hasNumber(reply, 10), "count 10"]];
      return verdict(parts.filter(([ok]) => ok).length / 2, parts.map(([ok, t]) => `${t}: ${ok ? "right" : "missing"}`));
    },
  },
  {
    id: "memory-upc-gap55",
    dim: "memory",
    rung: 55,
    name: "Recall a UPC after ~55 steps",
    prompt:
      "First, on books.toscrape.com, open the product page of \"Sharp Objects\" (Mystery category) and note its UPC. Then look at pages 1 through 25 of the books.toscrape.com catalogue (https://books.toscrape.com/catalogue/page-1.html onward, every book on each page) and find the most expensive book on those pages. " +
      "At the end, reply with the UPC you noted and the most expensive book's title and price.",
    check: ({ reply }) => {
      const parts = [
        [has(reply, "e00eb4fd7b871a48"), "UPC e00eb4fd7b871a48"],
        [has(reply, "The Diary of a Young Girl") && has(reply, "59.90"), "Diary of a Young Girl 59.90"],
      ];
      return verdict(parts.filter(([ok]) => ok).length / 2, parts.map(([ok, t]) => `${t}: ${ok ? "right" : "missing"}`));
    },
  },
  {
    id: "memory-turns-5",
    dim: "memory",
    rung: 5,
    name: "Recall an early answer five turns later",
    prompts: [
      "On books.toscrape.com, open the product page of \"See America: A Celebration of Our National Parks & Treasured Sites\" (Travel category). Tell me its UPC and how many copies are in stock.",
      "Now go to quotes.toscrape.com and count how many quotes on pages 1 to 5 are by Albert Einstein.",
      "Now open the Mystery category on books.toscrape.com and tell me the title and price of the first book listed.",
      "Now go to https://www.scrapethissite.com/pages/forms/ and find how many games the Boston Bruins won in the 2008 season.",
      "Without opening any page again, tell me the UPC from my first question and the number of Einstein quotes you counted.",
    ],
    check: ({ turnReplies, turnToolCalls }) => {
      const last = turnReplies.at(-1) || "";
      const parts = [
        [has(turnReplies[0] || "", "f9705c362f070608") && hasNumber(turnReplies[0] || "", 14), "turn 1 UPC and stock 14"],
        [hasNumber(turnReplies[1] || "", 8), "turn 2 count 8"],
        [has(turnReplies[2] || "", "Sharp Objects") && has(turnReplies[2] || "", "47.82"), "turn 3 Sharp Objects 47.82"],
        [hasNumber(turnReplies[3] || "", 53), "turn 4 53 wins"],
        [has(last, "f9705c362f070608") && hasNumber(last, 8), "turn 5 recalled UPC and 8"],
      ];
      const score = parts.filter(([ok]) => ok).length / parts.length;
      const v = verdict(score, [...parts.map(([ok, t]) => `${t}: ${ok ? "right" : "wrong"}`), `turn 5 tool calls ${turnToolCalls.at(-1)}`]);
      // The rung measures the recall at the end; earlier turns are context for it.
      return { ...v, ok: parts[4][0] && turnToolCalls.at(-1) === 0 };
    },
  },
  {
    id: "memory-context-flood",
    dim: "memory",
    rung: 3,
    name: "Three very long pages read in a row (context flood)",
    prompt:
      "Read the full text of each of these Wikipedia articles in turn, using the page text tool on each: \"World War II\", \"Byzantine Empire\", \"History of China\". " +
      "After reading all three, tell me the year World War II ended, the year Constantinople fell to the Ottomans, and the dynasty that ruled China immediately before the Republic of China.",
    check: ({ reply, events }) => {
      const reads = events.filter((e) => e.type === "tool_call" && e.name === "get_page_text").length;
      const parts = [[hasNumber(reply, 1945), "1945"], [hasNumber(reply, 1453), "1453"], [/qing/i.test(reply), "Qing"]];
      return verdict(parts.filter(([ok]) => ok).length / 3, [...parts.map(([ok, t]) => `${t}: ${ok ? "right" : "missing"}`), `${reads} page text reads`], reads >= 3);
    },
  },

  // Precision: forms with many fields (filled, never submitted) and exact extraction.
  {
    id: "precision-form-7",
    dim: "precision",
    rung: 7,
    name: "Fill a 7-field order form exactly, without submitting",
    prompt:
      "Go to https://httpbin.org/forms/post and fill in the form exactly as follows, but do NOT submit it: Customer name \"Ada Lovelace\", Telephone \"555-0142\", E-mail address \"ada@example.com\", Pizza Size \"Large\", Toppings \"Cheese\" and \"Mushroom\" only, Preferred delivery time \"19:30\", Delivery instructions \"Ring twice\". " +
      "Leave the page open on the filled form and tell me when you are done.",
    check: ({ formValues, finalUrl }) => {
      const by = (name, value) => formValues.find((f) => f.name === name && (value == null || f.value === value));
      const parts = [
        [by("custname")?.value === "Ada Lovelace", "name"],
        [by("custtel")?.value === "555-0142", "telephone"],
        [by("custemail")?.value === "ada@example.com", "email"],
        [Boolean(by("size", "large")?.checked) && !by("size", "small")?.checked && !by("size", "medium")?.checked, "size"],
        [
          ["cheese", "mushroom"].every((v) => by("topping", v)?.checked) && !["bacon", "onion"].some((v) => by("topping", v)?.checked),
          "toppings",
        ],
        [by("delivery")?.value === "19:30", "delivery time"],
        [by("comments")?.value.trim() === "Ring twice", "instructions"],
      ];
      const notSubmitted = /httpbin\.org\/forms\/post/.test(finalUrl);
      return verdict(parts.filter(([ok]) => ok).length / parts.length, [notSubmitted ? "" : `left the form (url ${finalUrl})`, ...parts.filter(([ok]) => !ok).map(([, t]) => `${t} wrong`)], notSubmitted);
    },
  },
  {
    id: "precision-form-9",
    dim: "precision",
    rung: 9,
    name: "Fill a 9-control test form exactly, without submitting",
    prompt:
      "Go to https://www.selenium.dev/selenium/web/web-form.html and set the form exactly as follows, but do NOT submit it: Text input \"Browsby stress 42\", Password \"Pw-7731\", Textarea \"line one\", Dropdown (select) \"Two\", Dropdown (datalist) \"Seattle\", " +
      "the first checkbox unchecked and the second checkbox checked, the second radio button selected, Date picker \"10/04/2026\", and the Example range slider at 8. Leave the page open on the filled form and tell me when you are done.",
    check: ({ formValues, finalUrl }) => {
      const byName = (n) => formValues.filter((f) => f.name === n);
      const byId = (id) => formValues.find((f) => f.id === id);
      const parts = [
        [byName("my-text")[0]?.value === "Browsby stress 42", "text"],
        [byName("my-password")[0]?.value === "Pw-7731", "password"],
        [byName("my-textarea")[0]?.value.trim() === "line one", "textarea"],
        [byName("my-select")[0]?.value === "Two", "select"],
        [byName("my-datalist")[0]?.value === "Seattle", "datalist"],
        [byId("my-check-1")?.checked === false, "checkbox 1"],
        [byId("my-check-2")?.checked === true, "checkbox 2"],
        [byId("my-radio-2")?.checked === true, "radio"],
        [byName("my-date")[0]?.value === "10/04/2026", "date"],
        [byName("my-range")[0]?.value === "8", "range"],
      ];
      const notSubmitted = /web-form\.html/.test(finalUrl);
      return verdict(parts.filter(([ok]) => ok).length / parts.length, [notSubmitted ? "" : `left the form (url ${finalUrl})`, ...parts.filter(([ok]) => !ok).map(([, t]) => `${t} wrong`)], notSubmitted);
    },
  },
  {
    id: "precision-countries-18",
    dim: "precision",
    rung: 18,
    name: "Exact capital, population and area of 6 countries",
    prompt:
      "Go to https://www.scrapethissite.com/pages/simple/ and, for each of Bhutan, Fiji, Iceland, Latvia, Malta and Uruguay, report the capital, population and area exactly as that page lists them, " +
      "one line per country in the form \"<country>: <capital>, <population>, <area>\". Use the page's figures, not ones you remember.",
    check: ({ reply }) => {
      const rows = [
        ["Bhutan", "Thimphu", 699847, "47000"], ["Fiji", "Suva", 875983, "18270"], ["Iceland", "Reykjavik", 308910, "103000"],
        ["Latvia", "Riga", 2217969, "64589"], ["Malta", "Valletta", 403000, "316"], ["Uruguay", "Montevideo", 3477000, "176220"],
      ];
      const lines = reply.split("\n");
      let right = 0;
      const wrong = [];
      for (const [c, cap, pop, area] of rows) {
        const line = lines.find((l) => l.toLowerCase().includes(c.toLowerCase())) || "";
        const flat = line.replace(/(\d),(?=\d{3})/g, "$1");
        const got = [new RegExp(cap, "i").test(line), hasNumber(flat, pop), hasNumber(flat, area) || hasNumber(flat, `${area}.0`)];
        right += got.filter(Boolean).length;
        if (got.some((g) => !g)) wrong.push(c);
      }
      return verdict(right / 18, [`${right}/18 values right`, wrong.length ? `wrong: ${wrong.join(", ")}` : ""]);
    },
  },
  {
    id: "precision-hockey-22",
    dim: "precision",
    rung: 22,
    name: "Exact wins per season for one team (21 seasons + total)",
    prompt:
      "Go to https://www.scrapethissite.com/pages/forms/ and use it to find every season listed for the Boston Bruins. Reply with one line per season in the form \"<year>: <wins>\", then a final line \"Total: <sum of all wins>\".",
    check: ({ reply }) => {
      const wins = { 1990: 44, 1991: 36, 1992: 51, 1993: 42, 1994: 27, 1995: 40, 1996: 26, 1997: 39, 1998: 39, 1999: 24, 2000: 36, 2001: 43, 2002: 36, 2003: 41, 2005: 29, 2006: 35, 2007: 41, 2008: 53, 2009: 39, 2010: 46, 2011: 49 };
      const lines = reply.split("\n");
      const right = Object.entries(wins).filter(([y, w]) => lines.some((l) => l.includes(y) && hasNumber(l.replace(y, ""), w))).length;
      const totalOk = hasNumber(lines.filter((l) => /total/i.test(l)).join(" "), 816);
      return verdict((right + (totalOk ? 1 : 0)) / 22, [`${right}/21 seasons right`, totalOk ? "" : "total 816 missing"]);
    },
  },

  // Recovery: popups, slow and script-loaded content, dead links, and several in a row.
  {
    id: "recovery-modal-1",
    dim: "recovery",
    rung: 1,
    name: "Close a modal, then read the page",
    prompt:
      "Go to https://the-internet.herokuapp.com/entry_ad. A modal window may pop up; close it. Then tell me the modal's title and the main heading of the page behind it.",
    check: ({ reply }) => {
      const parts = [[/this is a modal window/i.test(reply), "modal title"], [/entry ad/i.test(reply), "page heading"]];
      return verdict(parts.filter(([ok]) => ok).length / 2, parts.map(([ok, t]) => `${t}: ${ok ? "right" : "missing"}`));
    },
  },
  {
    id: "recovery-dynamic-2",
    dim: "recovery",
    rung: 2,
    name: "Wait out two script-driven page changes",
    prompt:
      "Go to https://the-internet.herokuapp.com/dynamic_controls. Remove the checkbox using the Remove button and wait until the page confirms it is gone. Then enable the text input with the Enable button, wait until it is enabled, and type \"recovered\" into it. " +
      "Leave the page open and tell me the confirmation messages you saw.",
    check: ({ formValues, reply }) => {
      const text = formValues.find((f) => f.type === "text");
      const parts = [
        [text?.value === "recovered", "typed into the enabled input"],
        [!formValues.some((f) => f.type === "checkbox"), "checkbox removed"],
        [/gone/i.test(reply) && /enabled/i.test(reply), "reported both messages"],
      ];
      return verdict(parts.filter(([ok]) => ok).length / 3, parts.map(([ok, t]) => `${t}: ${ok ? "yes" : "no"}`));
    },
  },
  {
    id: "recovery-deadlink-2",
    dim: "recovery",
    rung: 2,
    name: "Recover from a dead link to reach a product",
    prompt:
      "Open https://books.toscrape.com/catalogue/category/books/travel_99/index.html, which should be the Travel category of books.toscrape.com. If that address does not work, find the Travel category another way. " +
      "Then tell me the price and number in stock of \"The Great Railway Bazaar\".",
    check: ({ reply }) => {
      const parts = [[has(reply, "30.54"), "price 30.54"], [hasNumber(reply, 6), "stock 6"]];
      return verdict(parts.filter(([ok]) => ok).length / 2, parts.map(([ok, t]) => `${t}: ${ok ? "right" : "missing"}`));
    },
  },
  {
    id: "recovery-ajax-2",
    dim: "recovery",
    rung: 2,
    name: "Data that loads only after a click",
    prompt:
      "Go to https://www.scrapethissite.com/pages/ajax-javascript/ and show the Oscar-winning films for 2013 (they load after you pick the year). Tell me how many films are listed for 2013, and which of them had the most nominations, with that number.",
    check: ({ reply }) => {
      const parts = [[hasNumber(reply, 12), "12 films"], [/gravity/i.test(reply) && hasNumber(reply, 10), "Gravity, 10 nominations"]];
      return verdict(parts.filter(([ok]) => ok).length / 2, parts.map(([ok, t]) => `${t}: ${ok ? "right" : "missing"}`));
    },
  },
  {
    id: "recovery-chain-5",
    dim: "recovery",
    rung: 5,
    name: "Five obstacles in a row (redirect, error page, iframe, frames, slow load)",
    prompt:
      "On https://the-internet.herokuapp.com do these in order and report each result: " +
      "1) open /redirector, click the redirect link, and tell me the address you land on; " +
      "2) open /status_codes/500 and tell me the status code the page says it returned; " +
      "3) open /iframe and tell me the text inside the editor; " +
      "4) open /nested_frames and tell me the text of the bottom frame; " +
      "5) open /dynamic_loading/2, click Start, wait for the loading to finish, and tell me the text that appears.",
    check: ({ reply, events }) => {
      const urls = events.filter((e) => e.type === "tool_call" && (e.name === "navigate" || e.name === "tabs")).map((e) => e.input?.url || "").join(" ");
      const visited = ["/iframe", "/nested_frames", "/dynamic_loading/2"].every((p) => urls.includes(p));
      const parts = [
        [/status_codes/i.test(reply), "redirect target"],
        [hasNumber(reply, 500), "500"],
        [/your content goes here/i.test(reply), "iframe text"],
        [/bottom/i.test(reply), "bottom frame"],
        [/hello world/i.test(reply), "loaded text"],
      ];
      return verdict(parts.filter(([ok]) => ok).length / 5, [...parts.filter(([ok]) => !ok).map(([, t]) => `${t} missing`), visited ? "" : "did not open every page"], visited);
    },
  },
];
