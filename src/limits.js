// Usage limits and site policies applied by the agent in both editions.

// Resolves after ms, or as soon as the signal aborts.
export const sleep = (ms, signal) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

// Sliding one-minute windows for model requests and browser actions. When a window is
// full, take() waits for room instead of failing, so a runaway loop slows down rather
// than spending the user's quota at full speed.
export class RateLimiter {
  constructor() {
    this.windows = new Map();
  }

  // Resolves once one more event of this kind fits under perMinute (0 means no limit).
  // onWait(seconds) is called before each pause.
  async take(kind, perMinute, signal, onWait) {
    if (!perMinute) return;
    const times = this.windows.get(kind) ?? [];
    this.windows.set(kind, times);
    for (;;) {
      const now = Date.now();
      while (times.length && now - times[0] >= 60000) times.shift();
      if (times.length < perMinute) {
        times.push(now);
        return;
      }
      const waitMs = 60000 - (now - times[0]) + 50;
      onWait(Math.ceil(waitMs / 1000));
      await sleep(waitMs, signal);
      if (signal?.aborted) return;
    }
  }
}

// Sites where a wrong action is costly: banks and payments, password managers, account
// security, and crypto exchanges. State-changing actions on them always need the user's
// approval, in every safety mode. Matched against the hostname and its parent domains.
const SENSITIVE_DOMAINS = [
  "paypal.com", "venmo.com", "cash.app", "stripe.com", "wise.com", "revolut.com", "zelle.com",
  "chase.com", "bankofamerica.com", "wellsfargo.com", "citi.com", "capitalone.com", "usbank.com",
  "americanexpress.com", "discover.com", "schwab.com", "fidelity.com", "vanguard.com", "robinhood.com",
  "etrade.com", "hsbc.com", "barclays.co.uk", "santander.com", "ing.com", "bnpparibas.com", "n26.com",
  "coinbase.com", "binance.com", "kraken.com", "gemini.com", "crypto.com", "metamask.io",
  "1password.com", "bitwarden.com", "lastpass.com", "dashlane.com", "keepersecurity.com", "proton.me",
  "accounts.google.com", "myaccount.google.com", "passwords.google.com", "pay.google.com",
  "appleid.apple.com", "account.apple.com", "account.microsoft.com", "login.microsoftonline.com",
  "irs.gov", "ssa.gov", "login.gov",
];
// Hostname words that usually mean a bank or a wallet.
const SENSITIVE_WORDS = /(^|[.-])(bank|banking|creditunion|wallet)([.-]|$)/;

// Whether a URL is on a sensitive site, built in or added by the user (hostnames or
// domains, one per entry).
export function isSensitiveSite(url, extra = []) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  const domains = [...SENSITIVE_DOMAINS, ...extra.map((d) => d.trim().toLowerCase().replace(/^\*\./, "")).filter(Boolean)];
  return domains.some((d) => host === d || host.endsWith(`.${d}`)) || SENSITIVE_WORDS.test(host);
}

// The local date, as the key for daily usage.
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
