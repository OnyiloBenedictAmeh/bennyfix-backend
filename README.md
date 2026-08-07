# Marketing Studio V2 — Phase 1 Migration

## What this delivers
- Workspace-based `settings/social` store (already partially in place via your `social-store.js` — this generalizes it)
- All 4 platforms (Facebook, Instagram, LinkedIn, X) modularized into `/api/social/platforms/*.js`, each with an identical interface
- One generic endpoint per action (`connect`, `callback`, `status`, `publish`, `disconnect`) instead of duplicated per-platform logic
- **Zero frontend changes required** — old routes (`/api/meta-connect`, `/api/meta-callback`, `/api/meta-status`, `/api/publish-post`) still work, now as one-line delegates to the new code
- Two real bugs fixed along the way (see below)

## File placement

**Add these new files** (create the folders):
```
api/social/_shared/firebaseAdmin.js
api/social/_shared/cors.js
api/social/_shared/requireAdmin.js
api/social/_shared/oauthState.js
api/social/_shared/socialStore.js
api/social/platforms/facebook.js
api/social/platforms/instagram.js
api/social/platforms/linkedin.js
api/social/platforms/twitter.js
api/social/platforms/registry.js
api/social/connect.js
api/social/callback.js
api/social/status.js
api/social/publish.js
api/social/disconnect.js
```

**Replace these existing files** (contents in `api-root-replacements/`, same filenames, goes in your `api/` root — same location they're already in):
```
api/meta-connect.js
api/meta-callback.js   ← keep this exact path, see note in the file
api/meta-status.js
api/publish-post.js
```

**Delete these** (fully superseded, safe to remove once the above is in place):
```
api/social-store.js       (replaced by api/social/_shared/socialStore.js)
api/social-health.js      (see security note below — replaced by api/social/status.js)
```

## No environment variable changes needed
Every platform module's `REDIRECT_URI` still defaults to your existing `META_REDIRECT_URI` / `*_REDIRECT_URI` env vars, pointing at `/api/meta-callback` — the exact URL already registered in the Meta App Dashboard, Instagram API setup, LinkedIn app, and X app. Nothing to update on any provider's dashboard.

## ⚠️ Security issue found: `social-health.js`
This endpoint has **no admin auth check at all** — it's publicly reachable and returns connected-account usernames, names, emails, and Facebook Page lists to anyone who requests the URL. Options:
1. **Delete it** — `/api/social/status.js` (admin-protected) now covers this need, or
2. If you need a public health check for uptime monitoring, keep a stripped version that returns only `{connected: true/false}` per platform with no other fields.

I'd recommend option 1 unless something external is already depending on this exact URL.

## Two bugs fixed during modularization
1. **Instagram publishing was broken** — `publish-post.js` hardcoded `graph.facebook.com` as the base URL for Instagram, but Instagram Login tokens (`authType: "instagram_login"`) only work against `graph.instagram.com`. Fixed in `platforms/instagram.js`.
2. **Dead duplicate function** in the old `publish-post.js`'s `normalizeFacebookPagesForPublish` (a nested function shadowing itself, never called). Not present in the new `platforms/facebook.js`.

## Testing checklist after deploying
- [ ] `GET /api/meta-status` still returns the same shape your admin dashboard expects
- [ ] Connect Facebook — full OAuth round trip
- [ ] Connect Instagram — full OAuth round trip, then **publish a test post with an image** (this was silently broken before)
- [ ] Connect LinkedIn, connect X — OAuth round trips
- [ ] Publish a post targeting 2+ platforms where one is intentionally disconnected — confirm the connected ones still succeed and only the disconnected one reports an error
- [ ] Confirm `/api/social-health` is gone or no longer leaks data if you kept it

## What's next (Phase 2+)
Once this is deployed and verified working, next up per the original plan: multi-Page Facebook targeting in the admin UI (the backend already supports it via `pageIds`), token expiry tracking/auto-refresh, and the analytics dashboard. Say the word when you're ready to keep going.