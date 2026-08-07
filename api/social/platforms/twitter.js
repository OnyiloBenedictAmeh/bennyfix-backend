import crypto from "crypto";

const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID;
const TWITTER_CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET;
const REDIRECT_URI =
  process.env.TWITTER_REDIRECT_URI ||
  process.env.META_REDIRECT_URI ||
  "https://bennyfix-backend-v.vercel.app/api/meta-callback";

export const meta = { name: "twitter", displayName: "X / Twitter" };

// X requires PKCE, which needs a codeVerifier carried through `state` and
// returned unchanged on the callback. This doesn't fit the plain
// buildAuthorizeUrl(state) shape every other platform uses, so connect.js
// special-cases "twitter" and calls this instead.
export function buildAuthorizeUrlWithPkce(encodeState, baseStateData) {
  if (!TWITTER_CLIENT_ID) throw new Error("TWITTER_CLIENT_ID is not configured");

  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const state = encodeState({ ...baseStateData, codeVerifier });

  const url = new URL("https://x.com/i/oauth2/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", TWITTER_CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", "tweet.read tweet.write users.read offline.access");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeVerifier);
  url.searchParams.set("code_challenge_method", "plain");
  return url.toString();
}

export function buildAuthorizeUrl() {
  throw new Error("Twitter requires PKCE — use buildAuthorizeUrlWithPkce instead");
}

export async function handleCallback(code, extra = {}) {
  const { codeVerifier } = extra;
  if (!TWITTER_CLIENT_ID || !codeVerifier) {
    throw new Error("X app credentials are not configured");
  }

  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  if (TWITTER_CLIENT_SECRET) {
    headers.Authorization = `Basic ${Buffer.from(
      `${TWITTER_CLIENT_ID}:${TWITTER_CLIENT_SECRET}`
    ).toString("base64")}`;
  }

  const tokenRes = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers,
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: TWITTER_CLIENT_ID,
      code_verifier: codeVerifier,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(tokenData.error_description || tokenData.error || "X token exchange failed");
  }

  const userRes = await fetch("https://api.x.com/2/users/me?user.fields=username,name", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const userData = await userRes.json();
  if (!userRes.ok || !userData.data?.id) {
    throw new Error(userData.detail || "Could not load X profile");
  }

  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || null,
    userId: userData.data.id,
    username: userData.data.username || null,
    name: userData.data.name || null,
    authType: "oauth2_pkce",
    expiresInSeconds: tokenData.expires_in || null,
  };
}

export async function checkStatus(data = {}) {
  if (!data.accessToken) return { connected: false, configured: false };

  const res = await fetch("https://api.x.com/2/users/me", {
    headers: { Authorization: `Bearer ${data.accessToken}` },
  });
  const body = await res.json();

  if (!res.ok) {
    return { connected: false, configured: true, reason: body.detail || body.title };
  }

  return {
    connected: true,
    configured: true,
    userId: body.data.id,
    username: body.data.username,
    name: body.data.name,
  };
}

export async function publish({ data, caption, images }) {
  const token = data.accessToken;
  if (!token) throw new Error("X/Twitter isn't connected yet");
  if (images.length) throw new Error("X/Twitter image publishing is not enabled yet");

  const res = await fetch("https://api.x.com/2/tweets", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text: caption }),
  });
  const responseData = await res.json();
  if (!res.ok || !responseData.data?.id) {
    throw new Error(responseData.detail || responseData.title || "X/Twitter post failed");
  }

  return { success: true, id: responseData.data.id, text: responseData.data.text };
}

export async function disconnect() {
  return true;
}