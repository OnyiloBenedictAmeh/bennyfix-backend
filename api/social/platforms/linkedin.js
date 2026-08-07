const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
const REDIRECT_URI =
  process.env.LINKEDIN_REDIRECT_URI ||
  process.env.META_REDIRECT_URI ||
  "https://bennyfix-backend-v.vercel.app/api/meta-callback";

export const meta = { name: "linkedin", displayName: "LinkedIn" };

export function buildAuthorizeUrl(state) {
  if (!LINKEDIN_CLIENT_ID) throw new Error("LINKEDIN_CLIENT_ID is not configured");

  const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", LINKEDIN_CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", "openid profile w_member_social");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function handleCallback(code) {
  if (!LINKEDIN_CLIENT_ID || !LINKEDIN_CLIENT_SECRET) {
    throw new Error("LinkedIn app credentials are not configured");
  }

  const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: LINKEDIN_CLIENT_ID,
      client_secret: LINKEDIN_CLIENT_SECRET,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(tokenData.error_description || tokenData.error || "LinkedIn token exchange failed");
  }

  const profileRes = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const profileData = await profileRes.json();
  if (!profileRes.ok || !profileData.sub) {
    throw new Error(profileData.message || "Could not load LinkedIn profile");
  }

  return {
    accessToken: tokenData.access_token,
    personId: profileData.sub,
    name: profileData.name || null,
    email: profileData.email || null,
    authType: "oauth2",
    expiresInSeconds: tokenData.expires_in || null,
  };
}

export async function checkStatus(data = {}) {
  if (!data.accessToken) return { connected: false, configured: false };

  const res = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${data.accessToken}` },
  });
  const body = await res.json();

  if (!res.ok) {
    return { connected: false, configured: true, reason: body.message };
  }

  return {
    connected: true,
    configured: true,
    personId: data.personId,
    name: body.name,
    email: body.email,
  };
}

export async function publish({ data, caption, images }) {
  const token = data.accessToken;
  const personId = data.personId;
  if (!token || !personId) throw new Error("LinkedIn isn't connected yet");
  if (images.length) throw new Error("LinkedIn image publishing is not enabled yet");

  const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify({
      author: `urn:li:person:${personId}`,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: caption },
          shareMediaCategory: "NONE",
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    }),
  });

  const text = await res.text();
  const responseData = text ? safeJson(text) : {};
  if (!res.ok) {
    throw new Error(responseData.message || responseData.error_description || "LinkedIn post failed");
  }

  return { success: true, id: res.headers.get("x-restli-id") || responseData.id || null };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

export async function disconnect() {
  return true;
}