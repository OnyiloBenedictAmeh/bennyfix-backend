// KEEP THIS FILE AT THIS PATH. This is the redirect_uri actually registered
// in the Meta App Dashboard, the Instagram API setup, LinkedIn app, and the
// X app. Moving this logic to /api/social/callback.js and deleting this file
// would reproduce the "Invalid redirect_uri" error you already debugged.
export { default } from "./social/callback.js";