const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v23.0";
const INSTAGRAM_APP_ID = process.env.INSTAGRAM_APP_ID;
const INSTAGRAM_APP_SECRET = process.env.INSTAGRAM_APP_SECRET;
const REDIRECT_URI =
  process.env.INSTAGRAM_REDIRECT_URI ||
  process.env.META_REDIRECT_URI ||
  "https://bennyfix-backend-v.vercel.app/api/meta-callback";

export const meta = { name: "instagram", displayName: "Instagram" };

export function buildAuthorizeUrl(state) {
  if (!INSTAGRAM_APP_ID) throw new Error("INSTAGRAM_APP_ID is not configured");

  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", INSTAGRAM_APP_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "instagram_business_basic,instagram_business_content_publish");
  url.searchParams.set("enable_fb_login", "0");
  url.searchParams.set("force_authentication", "1");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function handleCallback(code) {
  if (!INSTAGRAM_APP_ID || !INSTAGRAM_APP_SECRET) {
    throw new Error("Instagram app credentials are not configured");
  }

  const shortRes = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: INSTAGRAM_APP_ID,
      client_secret: INSTAGRAM_APP_SECRET,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
      code,
    }),
  });
  const shortData = await shortRes.json();
  if (!shortRes.ok || !shortData.access_token || !shortData.user_id) {
    throw new Error(shortData.error?.message || "Instagram token exchange failed");
  }

  const longUrl = new URL("https://graph.instagram.com/access_token");
  longUrl.searchParams.set("grant_type", "ig_exchange_token");
  longUrl.searchParams.set("client_secret", INSTAGRAM_APP_SECRET);
  longUrl.searchParams.set("access_token", shortData.access_token);

  const longRes = await fetch(longUrl);
  const longData = await longRes.json();
  if (!longRes.ok || !longData.access_token) {
    throw new Error(longData.error?.message || "Instagram long-lived token exchange failed");
  }

  const profileUrl = new URL("https://graph.instagram.com/me");
  profileUrl.searchParams.set("fields", "id,username,account_type");
  profileUrl.searchParams.set("access_token", longData.access_token);

  const profileRes = await fetch(profileUrl);
  const profileData = await profileRes.json();
  if (!profileRes.ok) {
    throw new Error(profileData.error?.message || "Could not load Instagram profile");
  }

  return {
    userId: String(profileData.id),
    username: profileData.username || null,
    accountType: profileData.account_type || null,
    accessToken: longData.access_token,
    authType: "instagram_login",
    expiresInSeconds: longData.expires_in || null,
  };
}

export async function checkStatus(data = {}) {
  if (!data.accessToken) return { connected: false, configured: false };

  const url = new URL("https://graph.instagram.com/me");
  url.searchParams.set("fields", "id,username");
  url.searchParams.set("access_token", data.accessToken);

  const res = await fetch(url);
  const body = await res.json();

  if (!res.ok) {
    return { connected: false, configured: true, reason: body.error?.message };
  }

  return {
    connected: true,
    configured: true,
    id: body.id,
    username: body.username,
    accountType: data.accountType || null,
  };
}

export async function publish({ data, caption, images }) {
  const igUserId = data.userId;
  const token = data.accessToken;

  if (!igUserId || !token) throw new Error("Instagram isn't connected yet");
  if (!images.length) throw new Error("Instagram posts need at least one image");

  // FIX: Instagram Login accounts (authType "instagram_login") only work
  // against graph.instagram.com — graph.facebook.com will reject these
  // tokens. The previous publish-post.js hardcoded graph.facebook.com here,
  // which silently broke Instagram publishing.
  const base = `https://graph.instagram.com/${GRAPH_VERSION}`;

  if (images.length === 1) {
    const creationId = await createContainer({
      base,
      igUserId,
      token,
      params: { image_url: images[0].url, caption },
    });
    await waitUntilReady({ base, creationId, token });
    const publishId = await publishContainer({ base, igUserId, token, creationId });
    return { success: true, id: publishId };
  }

  const childIds = [];
  for (const image of images.slice(0, 10)) {
    childIds.push(
      await createContainer({
        base,
        igUserId,
        token,
        params: { image_url: image.url, is_carousel_item: "true" },
      })
    );
  }

  const carouselId = await createContainer({
    base,
    igUserId,
    token,
    params: { media_type: "CAROUSEL", caption, children: childIds.join(",") },
  });
  await waitUntilReady({ base, creationId: carouselId, token });
  const publishId = await publishContainer({ base, igUserId, token, creationId: carouselId });
  return { success: true, id: publishId };
}

async function createContainer({ base, igUserId, token, params }) {
  const res = await fetch(`${base}/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, access_token: token }),
  });
  const data = await res.json();
  if (!res.ok || !data.id) throw new Error(data.error?.message || "Instagram container creation failed");
  return data.id;
}

async function publishContainer({ base, igUserId, token, creationId }) {
  const res = await fetch(`${base}/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ creation_id: creationId, access_token: token }),
  });
  const data = await res.json();
  if (!res.ok || !data.id) throw new Error(data.error?.message || "Instagram publish failed");
  return data.id;
}

async function waitUntilReady({ base, creationId, token, attempts = 5 }) {
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(
      `${base}/${creationId}?fields=status_code&access_token=${encodeURIComponent(token)}`
    );
    const data = await res.json();
    if (data.status_code === "FINISHED") return;
    if (data.status_code === "ERROR") throw new Error("Instagram media processing failed");
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

export async function disconnect() {
  return true;
}