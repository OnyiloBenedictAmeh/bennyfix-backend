import * as facebook from "./social/_shared/platforms/facebook.js";
import * as instagram from "./social/_shared/platforms/instagram.js";
import * as linkedin from "./social/_shared/platforms/linkedin.js";
import * as twitter from "./social/_shared/platforms/twitter.js";

// To add a new platform (Threads, YouTube, TikTok, Google Business, Pinterest):
// 1. Create ./platformName.js exporting the same shape as the modules above
//    (meta, buildAuthorizeUrl, handleCallback, checkStatus, publish, disconnect)
// 2. Import it and add it to PLATFORMS below.
// Nothing else in /api/social/ needs to change.
export const PLATFORMS = { facebook, instagram, linkedin, twitter };

export function getPlatformModule(name) {
  return PLATFORMS[name];
}

export function listPlatformNames() {
  return Object.keys(PLATFORMS);
}