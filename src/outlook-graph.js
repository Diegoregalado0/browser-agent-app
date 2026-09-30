// Outlook for the extension edition: a few Microsoft Graph tools for the model, with the
// same interface as McpServers (toolDefs, has, isReadOnly, call) and mcp__ names, so the
// agent gives them the same safety checks and prompt injection scans. Sign-in is the
// authorization code flow with PKCE on the owner's Entra app registration; the tokens stay
// in the auth store and never reach the model, the UI or logs.

// The owner's Entra app registration (README, "Outlook in the extension"). Empty means
// Outlook is not configured in this build, and the build then leaves out the identity
// permission and the Microsoft hosts (scripts/build-extension.js).
export const OUTLOOK_CLIENT_ID = "";

import { keyProblem } from "./config-core.js";

const AUTHORITY = "https://login.microsoftonline.com/common/oauth2/v2.0";
const GRAPH = "https://graph.microsoft.com/v1.0";
const SCOPES = "openid profile offline_access User.Read Mail.ReadWrite Mail.Send Calendars.ReadWrite";
const BODY_MAX_CHARS = 8000;
// Renew a little before the access token expires.
const EXPIRY_MARGIN_MS = 60000;

const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// PKCE: a random verifier and its SHA-256 challenge, plus a state value.
export async function newPkce() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  return { verifier, challenge, state: base64url(crypto.getRandomValues(new Uint8Array(16))) };
}

const recipients = (list) => (list ?? []).map((address) => ({ emailAddress: { address } }));
const who = (r) => r?.emailAddress?.address ?? "";
const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const emails = { type: "array", items: { type: "string" } };
// A local date or date-time from the model as a UTC instant, for Graph's calendar ranges.
function instant(value) {
  const date = new Date(/^\d{4}-\d\d-\d\d$/.test(value) ? `${value}T00:00` : value);
  if (Number.isNaN(date.getTime())) throw new Error(`Not a date: ${value}`);
  return date.toISOString();
}

// Short on purpose: these ride on every model request.
const TOOLS = [
  {
    name: "mcp__outlook__mail_search",
    readOnly: true,
    description: "[Outlook] List recent mail in a folder, or search all mail. Returns ids, senders, subjects, previews.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search words; omit for the newest" },
        folder: { type: "string", description: "inbox (default), sentitems, drafts, archive" },
        top: { type: "number", description: "Max results, default 10" },
      },
    },
  },
  {
    name: "mcp__outlook__mail_read",
    readOnly: true,
    description: "[Outlook] Read one message by id.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "mcp__outlook__draft",
    description: "[Outlook] Save a draft (not sent). With reply_to_id, a reply draft to that message.",
    input_schema: {
      type: "object",
      properties: { to: emails, cc: emails, subject: { type: "string" }, body: { type: "string" }, reply_to_id: { type: "string" }, reply_all: { type: "boolean" } },
      required: ["body"],
    },
  },
  {
    name: "mcp__outlook__send",
    description: "[Outlook] Send a saved draft (draft_id), or a new message (to, subject, body).",
    input_schema: { type: "object", properties: { draft_id: { type: "string" }, to: emails, cc: emails, subject: { type: "string" }, body: { type: "string" } } },
  },
  {
    name: "mcp__outlook__events",
    readOnly: true,
    description: "[Outlook] List calendar events between two local ISO 8601 date-times.",
    input_schema: { type: "object", properties: { start: { type: "string" }, end: { type: "string" } }, required: ["start", "end"] },
  },
  {
    name: "mcp__outlook__event_create",
    description: "[Outlook] Create a calendar event (local ISO 8601 times). Attendees get invitations.",
    input_schema: {
      type: "object",
      properties: { subject: { type: "string" }, start: { type: "string" }, end: { type: "string" }, location: { type: "string" }, body: { type: "string" }, attendees: emails },
      required: ["subject", "start", "end"],
    },
  },
];
const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export class OutlookGraph {
  // loadAuth/saveAuth: the token store, { accessToken, refreshToken, expiresAt, account } or
  // null. launchAuth(url, interactive): opens Microsoft's sign-in page and resolves to the
  // address it redirected to (chrome.identity.launchWebAuthFlow). redirectUri: that
  // redirect (https://<extension id>.chromiumapp.org/). fetch, authority and graph are
  // replaceable for the offline checks.
  constructor({ loadAuth, saveAuth, launchAuth, redirectUri, clientId = OUTLOOK_CLIENT_ID, fetch = globalThis.fetch.bind(globalThis), authority = AUTHORITY, graph = GRAPH }) {
    Object.assign(this, { loadAuth, saveAuth, launchAuth, redirectUri, clientId, fetch, authority, graph });
    // Whether a sign-in is stored; the model gets the tools only then.
    this.signedIn = false;
  }

  get configured() {
    return Boolean(this.clientId);
  }

  // A sign-in stored while Outlook was set up does not count in a build where it is not.
  async init() {
    this.signedIn = this.configured && Boolean((await this.loadAuth())?.refreshToken);
  }

  // What the UI shows: never a token.
  async status() {
    const auth = await this.loadAuth();
    return { type: "outlook_status", configured: this.configured, signedIn: this.configured && Boolean(auth?.refreshToken), account: auth?.account ?? "" };
  }

  // Microsoft's sign-in page for a PKCE challenge.
  authUrl({ challenge, state, prompt }) {
    const q = new URLSearchParams({
      client_id: this.clientId,
      response_type: "code",
      redirect_uri: this.redirectUri,
      response_mode: "query",
      scope: SCOPES,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      ...(prompt && { prompt }),
    });
    return `${this.authority}/authorize?${q}`;
  }

  // Signs in on Microsoft's page and stores the tokens; resolves to the account name.
  // Without interaction (a renewal), it works only while the user's Microsoft session is
  // still signed in.
  async signIn({ interactive = true } = {}) {
    if (!this.configured) throw new Error("Outlook is not set up in this version of the extension yet.");
    const { verifier, challenge, state } = await newPkce();
    const url = this.authUrl({ challenge, state, prompt: interactive ? "select_account" : "none" });
    const redirected = new URL(await this.launchAuth(url, interactive));
    const q = redirected.searchParams;
    if (q.get("state") !== state) throw new Error("Microsoft sign-in returned an unexpected answer.");
    if (!q.get("code")) throw new Error(`Microsoft sign-in did not finish: ${q.get("error_description")?.split("\n")[0] || q.get("error") || "no code"}`);
    const auth = await this.#token({ grant_type: "authorization_code", code: q.get("code"), code_verifier: verifier, redirect_uri: this.redirectUri });
    const me = await this.#graphFetch(auth.accessToken, "GET", "/me?$select=userPrincipalName,mail,displayName");
    auth.account = me.userPrincipalName || me.mail || me.displayName || "";
    await this.saveAuth(auth);
    this.signedIn = true;
    return auth.account;
  }

  async signOut() {
    await this.saveAuth(null);
    this.signedIn = false;
  }

  async #token(params) {
    const res = await this.fetch(`${this.authority}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.clientId, scope: SCOPES, ...params }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) throw new Error(`Microsoft sign-in failed: ${data.error_description?.split("\n")[0] || data.error || res.status}`);
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + data.expires_in * 1000 };
  }

  // A valid access token, renewed with the refresh token when it has (nearly) expired.
  async #accessToken(force = false) {
    const auth = await this.loadAuth();
    if (!auth?.refreshToken) throw new Error("Outlook is not signed in. Ask the user to connect Outlook in the Connections panel.");
    if (!force && auth.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return auth.accessToken;
    let fresh;
    try {
      fresh = await this.#token({ grant_type: "refresh_token", refresh_token: auth.refreshToken });
    } catch (err) {
      // Refresh tokens from a browser sign-in last about a day; a silent sign-in renews it.
      if (await this.signIn({ interactive: false }).then(() => true, () => false)) return (await this.loadAuth()).accessToken;
      await this.signOut();
      throw new Error(`Outlook sign-in expired; ask the user to sign in again in the Connections panel. (${err.message})`);
    }
    await this.saveAuth({ ...fresh, refreshToken: fresh.refreshToken || auth.refreshToken, account: auth.account });
    return fresh.accessToken;
  }

  async #graphFetch(token, method, path, body, headers = {}, signal) {
    // A stored token that cannot go in a header is handled like a rejected one: renewed.
    if (keyProblem(token)) throw Object.assign(new Error("Outlook rejected the sign-in."), { status: 401 });
    const res = await this.fetch(`${this.graph}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body && { "Content-Type": "application/json" }), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
    if (res.status === 401) throw Object.assign(new Error("Outlook rejected the sign-in."), { status: 401 });
    const data = res.status === 202 || res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) throw new Error(`Outlook: ${data?.error?.message || `request failed (${res.status})`}`);
    return data;
  }

  // One Graph request, retried once with a renewed token when the access token is rejected.
  async #graph(signal, method, path, body, headers) {
    try {
      return await this.#graphFetch(await this.#accessToken(), method, path, body, headers, signal);
    } catch (err) {
      if (err.status !== 401) throw err;
      return this.#graphFetch(await this.#accessToken(true), method, path, body, headers, signal);
    }
  }

  toolDefs() {
    return this.signedIn ? TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema })) : [];
  }

  has(name) {
    return this.signedIn && BY_NAME.has(name);
  }

  isReadOnly(name) {
    return BY_NAME.get(name)?.readOnly === true;
  }

  async call(name, input = {}, { signal } = {}) {
    const text = await this.#run(name.replace("mcp__outlook__", ""), input, (...args) => this.#graph(signal, ...args));
    return [{ type: "text", text }];
  }

  async #run(tool, a, graph) {
    const message = () => ({
      ...(a.subject !== undefined && { subject: a.subject }),
      ...(a.body !== undefined && { body: { contentType: "Text", content: a.body } }),
      ...(a.to && { toRecipients: recipients(a.to) }),
      ...(a.cc && { ccRecipients: recipients(a.cc) }),
    });
    const id = (value) => encodeURIComponent(String(value ?? ""));
    switch (tool) {
      case "mail_search": {
        const top = Math.min(Math.max(Number(a.top) || 10, 1), 25);
        const select = "$select=id,subject,from,receivedDateTime,bodyPreview,isRead";
        const path = a.query
          ? `/me/messages?$search=${encodeURIComponent(`"${String(a.query).replace(/"/g, "")}"`)}&$top=${top}&${select}`
          : `/me/mailFolders/${id(a.folder || "inbox")}/messages?$orderby=receivedDateTime%20desc&$top=${top}&${select}`;
        const { value } = await graph("GET", path);
        if (!value.length) return "No messages.";
        return value.map((m) => `id: ${m.id}\n${m.receivedDateTime} from ${who(m.from)}${m.isRead ? "" : " (unread)"}\n${m.subject}\n${(m.bodyPreview ?? "").slice(0, 200)}`).join("\n\n");
      }
      case "mail_read": {
        const m = await graph("GET", `/me/messages/${id(a.id)}?$select=subject,from,toRecipients,ccRecipients,receivedDateTime,body`, null, { Prefer: 'outlook.body-content-type="text"' });
        const body = m.body?.content ?? "";
        return [
          `Subject: ${m.subject}`,
          `From: ${who(m.from)}`,
          `To: ${(m.toRecipients ?? []).map(who).join(", ")}`,
          ...(m.ccRecipients?.length ? [`Cc: ${m.ccRecipients.map(who).join(", ")}`] : []),
          `Date: ${m.receivedDateTime}`,
          "",
          body.length > BODY_MAX_CHARS ? `${body.slice(0, BODY_MAX_CHARS)}\n[truncated]` : body,
        ].join("\n");
      }
      case "draft": {
        let draft;
        if (a.reply_to_id) {
          draft = await graph("POST", `/me/messages/${id(a.reply_to_id)}/${a.reply_all ? "createReplyAll" : "createReply"}`, { comment: a.body });
          const extra = { ...(a.to && { toRecipients: recipients(a.to) }), ...(a.cc && { ccRecipients: recipients(a.cc) }), ...(a.subject && { subject: a.subject }) };
          if (Object.keys(extra).length) draft = await graph("PATCH", `/me/messages/${id(draft.id)}`, extra);
        } else {
          draft = await graph("POST", "/me/messages", message());
        }
        return `Draft saved (not sent). draft_id: ${draft.id}`;
      }
      case "send": {
        if (a.draft_id) {
          await graph("POST", `/me/messages/${id(a.draft_id)}/send`);
          return "Sent.";
        }
        if (!a.to?.length) throw new Error("Give draft_id, or to, subject and body.");
        await graph("POST", "/me/sendMail", { message: message(), saveToSentItems: true });
        return "Sent.";
      }
      case "events": {
        const q = new URLSearchParams({ startDateTime: instant(a.start), endDateTime: instant(a.end), $select: "subject,start,end,location,isAllDay", $orderby: "start/dateTime", $top: "50" });
        const { value } = await graph("GET", `/me/calendarView?${q}`, null, { Prefer: `outlook.timezone="${timeZone()}"` });
        if (!value.length) return "No events.";
        return value
          .map((e) => `${e.start.dateTime.slice(0, 16)} to ${e.end.dateTime.slice(0, 16)}${e.isAllDay ? " (all day)" : ""}: ${e.subject}${e.location?.displayName ? ` @ ${e.location.displayName}` : ""}`)
          .join("\n");
      }
      case "event_create": {
        const zone = timeZone();
        const event = await graph("POST", "/me/events", {
          subject: a.subject,
          start: { dateTime: a.start, timeZone: zone },
          end: { dateTime: a.end, timeZone: zone },
          ...(a.location && { location: { displayName: a.location } }),
          ...(a.body && { body: { contentType: "Text", content: a.body } }),
          ...(a.attendees && { attendees: a.attendees.map((address) => ({ emailAddress: { address }, type: "required" })) }),
        });
        return `Event created: ${event.subject}, ${event.start?.dateTime?.slice(0, 16) ?? a.start}.`;
      }
    }
    throw new Error(`Unknown Outlook tool ${tool}.`);
  }
}
