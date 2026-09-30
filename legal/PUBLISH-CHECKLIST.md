# Publish checklist

Everything left before Browsby goes to the Chrome Web Store. Not published on GitHub Pages.

## Owner details for the policies

- [ ] Publisher name (an individual or a company): `[PUBLISHER NAME]` in LICENSE, README, PRIVACY, TERMS.
- [ ] Contact email: `[CONTACT EMAIL]` in PRIVACY and TERMS.
- [ ] Security contact email (can be the same) and response time: `[SECURITY CONTACT EMAIL]`, `[ACKNOWLEDGE WITHIN]` in SECURITY.md.
- [ ] Effective date: `[EFFECTIVE DATE]` in PRIVACY and TERMS (the day the policies go public).
- [ ] Optional lawyer review: limitation of liability, indemnity and venue for EU and UK consumers; GDPR or CCPA wording; the consent commitment in PRIVACY section 9.

## Hosting

- [ ] Turn on GitHub Pages (main branch, root) once the placeholders are filled, and check that `/legal/PRIVACY` and `/legal/TERMS` load.
- [ ] Turn on private vulnerability reporting in the repository's security settings.

## Licensing

- [ ] Decide whether the LICENSE allows building from source for personal use, or change the README Install section to point at the store once it is listed.
- [ ] Paste the upstream MIT license text for `standardwebhooks` into the notices (its npm package ships none; the build warns).

## Store listing

- [ ] Screenshots, promo tile and description (from brand/ and the README).
- [ ] Permission justifications and privacy practices answers from legal/WEB-STORE.md.
- [ ] Reviewer test notes, and a low-limit test key if reviewers need one (the `[OWNER: ...]` note in WEB-STORE.md).
- [ ] Raise `version` in package.json.
- [ ] First upload as a draft. Then put the store's public key in `EXTENSION_KEY` (scripts/build-extension.js).

## Real-task testing

- [ ] Run the real-task pass on OpenAI (gpt-6-sol with gpt-6-luna for safety checks). The 2026-09-30 pass could not: the test account had no credit left, so only Mistral (Ministral 14B) ran tasks end to end.
- [ ] Run a few tasks on an Ollama model that supports tools. Not tested end to end: the test Mac had too little free disk to pull a model.
- [ ] Once the store id exists, narrow the Ollama command in setup and Settings to `OLLAMA_ORIGINS=chrome-extension://<store id>`: the `chrome-extension://*` shown now lets every installed extension call the user's Ollama.

## Outlook (optional for launch)

- [ ] Register the Entra app (README, "Outlook in the extension") and set `OUTLOOK_CLIENT_ID`.
- [ ] Add `https://<store id>.chromiumapp.org/` as a second redirect URI after the first upload.
- [ ] Privacy and terms URLs in the app registration's branding; publisher verification to remove the "unverified" label.

## Security review (legal/THREAT-MODEL.md)

- [ ] In a real browser with a throwaway profile, check the review's fixes: a filled password field shows as `value=[hidden]` in read_page; a login request's body shows `password=[hidden]` in network_requests; a denied sensitive-site click followed by navigating to its address asks again at the computer; a page that redirects during a safety check does not get the click.
- [ ] Repeat the Ministral decline test from the 2026-09-30 pass with this branch.
- [ ] Decide the security recommendations in legal/THREAT-MODEL.md: end the task after a Deny, always ask before Outlook send, sensitive checks for payment iframes and private addresses, page scripts in an isolated world.

## Open product questions

- [ ] Plain http for the OpenAI base URL and Ollama host: keep allowing it for non-local addresses, or only for localhost (the store frowns on unencrypted personal data).
