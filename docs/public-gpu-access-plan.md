# Plan: sharing the Browsby GPU server through Cloudflare Tunnel, with access keys

Status: built 2026-10-24 (gate public listener, browsby-keys, browsby-public, extension access key); live once `browsby-public setup` runs with a Cloudflare API token.

## Goal

Anyone Diego gives an access key to can use the Browsby GPU server from the Browsby
extension, with no Tailscale, no SSH key and no open port on the home network. Every key can
be limited, watched and revoked at once. Nobody without a key can reach anything on the PC.

Today a user needs Tailscale (or an SSH key restricted to the gate, as on lyubas-macbook-air)
to reach 127.0.0.1:8090 on ai-linux.

## How a request travels

```
Browsby extension
  │  HTTPS to https://gpu.<domain>  (one pasted access key → 2 headers)
  ▼
Cloudflare edge ── layer 1: Cloudflare Access, Service Auth policy
  │                rejects any request without a valid service token (never reaches the PC)
  │                WAF: path allowlist, rate limit; no caching
  ▼
cloudflared on ai-linux (outbound-only connection; no inbound port opened)
  │  http://127.0.0.1:8091
  ▼
Browsby gate, public listener ── layer 2: gate access key
  │  checks the Access JWT, the key, the path, the model, the body, the limits
  ▼
same gate internals → llama.cpp router (8080) / Ollama (11435)
```

Diego's own tunnel, local-ai-workstation and scripts keep using 127.0.0.1:8090 unchanged.
Port 8091 is the only thing cloudflared can reach, and it only listens on 127.0.0.1.

## Why two layers

- Layer 1 (Cloudflare Access) stops scanners, guessing and floods at Cloudflare's edge, so
  they cost the PC nothing. It is free for up to 50 service tokens.
- Layer 2 (the gate key) is the authority: it holds the per-person limits, the model
  allowlist and the audit log, and it still protects the gate if Access is ever
  misconfigured or switched off.
- A request needs both to be valid. Revoking either one cuts a person off.

## The access key a person receives

One string, shown once, which the person pastes into Browsby:

```
bzk1_<base64url of {"u": "https://gpu.<domain>", "cid": <Access client id>, "cs": <Access client secret>, "k": <gate key>}>
```

- The extension decodes it locally into the server address and three headers, sent only to
  that address: `CF-Access-Client-Id` and `CF-Access-Client-Secret` for Access, and
  `X-Browsby-Key: bgk_<id>_<secret>` for the gate. (Not Access's single `Authorization`
  header: the OpenAI client library sets `Authorization` itself.)
- The `bzk1_` prefix lets GitHub secret scanning (a custom pattern) and log scrubbers spot a
  leaked key.
- Gate key format: `bgk_<id>_<secret>`. `id` is 8 random base32 characters, used to find the
  record. `secret` is 32 random bytes (256 bits), base64url.

## Layer 2: the gate's public listener (gate.py)

A second `ThreadingHTTPServer` on 127.0.0.1:8091 in the same process (`~/browsby/public.py`), so it shares the GPU
switching lock, the busy tracking and gaming mode. Each request goes through these checks in
order, and the first failure answers at once:

1. **Size and shape.** `Content-Length` is required on POST and capped (20 MB, room for
   screenshots); chunked uploads are refused. Request line and headers are capped by the
   HTTP server.
2. **Came through Cloudflare Access.** The `Cf-Access-Jwt-Assertion` header must be a valid
   RS256 JWT: signature checked against
   `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` (keys cached, refetched on
   an unknown `kid`), `iss` equal to the team domain, `aud` equal to the application's AUD
   tag, `exp` in the future. This means a process on the PC that reaches 8091 directly
   still needs a key, and a request that skipped Access is refused.
   (Verified with the standard library: the full PKCS#1 v1.5 encoding is compared.)
3. **The key.** `X-Browsby-Key` parsed into id and secret; the record is found by id;
   `hmac.compare_digest(HMAC-SHA256(pepper, secret), stored_hash)`. Refused when missing,
   malformed, unknown, revoked or expired, always with the same `401 {"error": "invalid
   access key"}` and the same timing, so nothing can be learned from the answer.
4. **Failed-key throttle.** Per `CF-Connecting-IP`: after 10 failed keys in 10 minutes, every
   request from that address gets 429 for 30 minutes. Logged.
5. **Path allowlist.** Only:
   - `POST /v1/chat/completions`
   - `GET /v1/models` (answers with the key's catalog models only)
   - `GET /browsby/models` (the catalog, filtered to the key's models, backends left out)
   - `GET /browsby/busy`
   Everything else is 404, including llama.cpp's router API (`/models/load`, `/models/unload`,
   `/slots`, `/props`, `/metrics`), Ollama (`/api/*`, so no pulls or deletes) and `/gaming/*`.
6. **Model allowlist.** `model` must be a catalog id (not a raw preset or Ollama tag) and in
   the key's allowed models.
7. **Body allowlist.** JSON only. Top-level fields kept: `model, messages, tools, tool_choice,
   stream, stream_options, temperature, top_p, top_k, min_p, presence_penalty,
   frequency_penalty, max_tokens, max_completion_tokens, stop, seed, response_format,
   parallel_tool_calls, reasoning_effort`, and `chat_template_kwargs.enable_thinking`. Every
   other field is dropped (llama.cpp extras such as `id_slot`, `lora`, `samplers`,
   `n_probs`, `cache_prompt`, `grammar`). `max_tokens` is capped (8192); `n` must be 1.
8. **Limits per key**, all configurable:
   - concurrent requests (default 1)
   - requests per minute (default 30)
   - tokens per day (default 2M), counted from each response's `usage`; streams get
     `stream_options.include_usage` forced on so the final chunk carries it
   - expiry date (default 90 days)
   Over a limit: 429 with `Retry-After` and a plain reason ("daily token limit reached").
9. **Forward** through the existing dispatch (slots, GPU switching, gaming mode, busy notice).
10. **Keep the connection alive for Cloudflare.** Cloudflare ends a request that sends nothing
    for about 100 to 125 seconds (error 524), and a cold model can take longer to load. For
    `stream: true` requests the gate sends the response headers at once and an SSE comment
    (`: loading`) every 15 seconds until the backend answers. Non-stream requests (safety
    checks, titles) already time out at 60 seconds in Browsby, so they are unaffected.
11. **Audit log.** One line per request to journald: key name and id, client IP, path, model,
    status, duration, tokens. Never the key, never prompts or replies.

Errors to the outside never carry stack traces, backend addresses or preset names.

## Key storage and the `browsby-keys` command

- `~/browsby/keys.json`, mode 600, written atomically (temp file and rename) like the
  catalog. Per key: `id, name, hash, created, expires, revoked, models, limits,
  last_used, cf_token_id`. No secrets.
- `~/.config/browsby/pepper`, mode 600: 32 random bytes for the HMAC, so a copy of
  keys.json alone cannot even be used to test guesses.
- `~/.config/browsby/cloudflare.env`, mode 600: a Cloudflare API token scoped to
  "Access: Service Tokens Edit" on this account only, so the command can create and revoke
  Access service tokens.
- The gate re-reads keys.json when it changes (same as the catalog), so a revoke takes effect
  on the next request.

```
browsby-keys create "Lyuba" [--models Browsby-Steady,Zigger-1.0] [--expires 90d]
                            [--rpm 30] [--concurrent 1] [--daily-tokens 2M]
    → creates the Access service token (same expiry) and the gate key, prints the bzk1_ key once
browsby-keys list            names, ids, expiry, last used, today's tokens; never secrets
browsby-keys usage [name]    requests and tokens per day
browsby-keys edit  <name> --rpm 60 --models ...
browsby-keys rotate <name>   new key, old one revoked (optionally after a grace period)
browsby-keys revoke <name>   gate key revoked at once, Access service token deleted
```

## Cloudflare setup (one time)

1. A domain on Cloudflare (DNS managed there). The tunnel uses a subdomain, e.g.
   `gpu.<domain>`.
2. Install cloudflared on ai-linux from Cloudflare's signed apt repository
   (pkg.cloudflare.com); unattended security upgrades keep it current.
3. Named tunnel, run as a systemd service (root, since `cloudflared service install` puts its
   config in /etc/cloudflared/config.yml):
   ```yaml
   tunnel: <uuid>
   credentials-file: /etc/cloudflared/<uuid>.json   # root:root 600
   ingress:
     - hostname: gpu.<domain>
       service: http://127.0.0.1:8091
       originRequest:
         connectTimeout: 10s
     - service: http_status:404
   ```
   Checked with `cloudflared tunnel ingress validate` and `ingress rule https://gpu.<domain>/x`.
   `cloudflared tunnel route dns` creates the CNAME.
4. Zero Trust (free): a self-hosted Access application for `gpu.<domain>` with one policy,
   action **Service Auth**, including the service tokens `browsby-keys` creates;
   `read_service_tokens_from_header: "Authorization"` set through the API.
5. Zone settings for the hostname: SSL Full (strict) at the edge, minimum TLS 1.2, Always
   Use HTTPS, HSTS; a Cache Rule that bypasses cache; Bot Fight Mode off for this hostname
   (it blocks API clients); a WAF custom rule blocking every path outside the allowlist; a
   rate limiting rule per IP as a backstop to the gate's own limits.

## Extension changes

- The Browsby GPU server connection gets an **Access key** field (a password field, saved
  with the other keys and never shown again). Pasting a `bzk1_` key fills in the server
  address too.
- Every request to the server (chat, safety checks, titles, catalog, busy) sends the two
  headers. The address is checked to be https when a key is set.
- Browsby asks for host permission for the server's address when it is saved, as for any
  custom server.
- Plain-language errors for 401 ("This access key is not valid or was revoked. Ask the
  server owner for a new one."), 429 (the limit and when it resets) and 524.

## Kill switches

- `browsby-public off|on|status`: stops or starts cloudflared. Off means nothing from outside
  reaches the PC, at once.
- Gaming mode keeps working as today: public requests get the same 503.
- Revoking a key works per person; `browsby-keys revoke --all` for everyone.

## Threats and answers

| Threat | Answer |
|---|---|
| Internet scanners and floods | Access rejects them at Cloudflare's edge; no inbound port exists |
| A guessed or brute-forced key | 256-bit secrets; same 401 for every failure; failed-key throttle per IP |
| A leaked access key | `browsby-keys revoke`; per-key limits cap the damage until then; `bzk1_` prefix for secret scanning |
| A copy of keys.json | Holds only HMAC hashes with a pepper stored elsewhere |
| A key holder loading other models, pulling or deleting models, reaching llama.cpp's admin API | Path, model and body allowlists; raw presets and `/api/*` are unreachable |
| A key holder hogging the GPU | Concurrency, per-minute and daily token limits; the busy notice; Diego can revoke |
| Someone on the PC reaching 8091 directly | The Access JWT check fails without Cloudflare |
| Cloudflare seeing traffic | Cloudflare ends TLS at its edge, so prompts and screenshots pass through it in readable form. Key holders should be told. |
| Long model loads cut off by Cloudflare (524) | SSE keepalive for streams |
| Gate bug exposes something | The second listener runs only the public pipeline; tests below cover every refusal |

## Testing before anyone gets a key

- Python unit tests for the public pipeline: missing, malformed, wrong, revoked and expired
  keys (same 401), throttle after 10 failures, every path outside the allowlist (404), raw
  preset and Ollama tag models (refused), dropped body fields, max_tokens cap, each limit
  (429 with Retry-After), a bad or missing JWT, oversize body, chunked body.
- Through the tunnel with curl: no headers (Access 403 from Cloudflare), service token only
  (gate 401), both (200), revoked (401 within a second).
- From outside the home network: a port scan of the WAN address shows nothing new.
- A Browsby end-to-end run from a throwaway profile with a real key: catalog, chat with
  screenshots, safety checks, titles, a cold model load over 2 minutes (keepalive).
- A load test with two keys at their limits while Diego runs a task.

## Build order

1. Gate public listener, keys.json, `browsby-keys` (gate key only), unit tests. Test locally
   with a fake JWT issuer.
2. Extension: Access key field, headers, error messages; checks.
3. Cloudflare: domain, cloudflared, Access application, zone settings; `browsby-keys` creates
   Access tokens through the API.
4. End-to-end and outside tests; then the first real key.
5. Server change log entry with undo steps for every piece.

## Decisions needed from Diego

1. Which domain on Cloudflare to use (and whether it is already on Cloudflare DNS).
2. Default limits per key (proposed: 1 concurrent, 30 requests/minute, 2M tokens/day,
   90-day expiry).
3. Whether Diego's own tasks should take priority over key holders' when both wait for the
   GPU.
4. Installing cloudflared needs root on ai-linux (apt repository and a system service).
