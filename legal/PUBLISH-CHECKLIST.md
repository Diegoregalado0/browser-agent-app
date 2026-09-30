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

## Outlook (optional for launch)

- [ ] Register the Entra app (README, "Outlook in the extension") and set `OUTLOOK_CLIENT_ID`.
- [ ] Add `https://<store id>.chromiumapp.org/` as a second redirect URI after the first upload.
- [ ] Privacy and terms URLs in the app registration's branding; publisher verification to remove the "unverified" label.

## Open product questions

- [ ] Plain http for the OpenAI base URL and Ollama host: keep allowing it for non-local addresses, or only for localhost (the store frowns on unencrypted personal data).
