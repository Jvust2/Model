# Drive OAuth Bridge

This Worker is shared by:

- https://jvust.github.io/drive-original-player/
- https://jvust2.github.io/Model/

## Why the old Worker returned to the wrong site

The old implementation used one hard-coded RETURN_URL and one hard-coded ALLOWED_ORIGIN. Model could complete Google OAuth, but the callback always redirected to drive-original-player, and Model would also be rejected by the /token CORS check.

## New flow

1. The website calls /auth?return_to=<allowed site>.
2. The Worker validates return_to against an exact allowlist.
3. The Worker stores returnTo with the random OAuth state in OAUTH_KV for 10 minutes.
4. Google returns to the Worker /callback.
5. The Worker validates state, exchanges the code, creates a browser session, and redirects to the stored site using the URL fragment.
6. /token accepts both GitHub Pages origins and binds each session to the origin that created it.

## Cloudflare deployment

Replace the existing drive-oauth-bridge Worker code with:

    workers/drive-oauth-bridge.mjs

Keep the existing bindings/secrets:

- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- REDIRECT_URI
- OAUTH_KV

No new Google Cloud project or Drive API is required. REDIRECT_URI remains the Worker callback URL already registered in Google Cloud.

After deployment, merge Model PR #2 so Model sends its return_to value.

## Security

return_to is not an open redirect. Only these exact URLs are accepted:

- https://jvust.github.io/drive-original-player/
- https://jvust2.github.io/Model/

Each browser session is stored under a SHA-256 hash and tied to the origin that initiated authorization.
