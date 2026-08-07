const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v23.0";
const APP_ID = process.env.META_APP_ID;
const APP_SECRET = process.env.META_APP_SECRET;
// IMPORTANT: this must stay pointed at the URL actually registered in the
// Meta App Dashboard (/api/meta-callback). Changing this default without
// also updating the dashboard reproduces the "Invalid redirect_uri" error.
const REDIRECT_URI =
  process.env.META_REDIRECT_URI || "https://bennyfix-backend-v.vercel.app/api/meta-callback";

export const meta = { name: "facebook", displayName: "Facebook" };

export function buildAuthorizeUrl(state) {
  if (!APP_ID) throw new Error("META_APP_ID is not configured");

  const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", APP_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "pages_show_list,pages_read_engagement,pages_manage_posts");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function handleCallback(code) {
  if (!APP_ID || !APP_SECRET) {
    throw new Error("Facebook app credentials are not configured");
  }

  // Step 1: short-lived user token
  const shortUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
  shortUrl.searchParams.set("client_id", APP_ID);
  shortUrl.searchParams.set("client_secret", APP_SECRET);
  shortUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  shortUrl.searchParams.set("code", code);

  const shortRes = await fetch(shortUrl);
  const shortData = await shortRes.json();
  if (!shortRes.ok || !shortData.access_token) {
    throw new Error(shortData.error?.message || "Facebook token exchange failed");
  }

  // Step 2: long-lived user token (~60 days)
  const longUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
  longUrl.searchParams.set("grant_type", "fb_exchange_token");
  longUrl.searchParams.set("client_id", APP_ID);
  longUrl.searchParams.set("client_secret", APP_SECRET);
  longUrl.searchParams.set("fb_exchange_token", shortData.access_token);

  const longRes = await fetch(longUrl);
  const longData = await longRes.json();
  if (!longRes.ok || !longData.access_token) {
    throw new Error(longData.error?.message || "Facebook long-lived token exchange failed");
  }

  // Step 3: every Page this account manages
  const pagesUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/me/accounts`);
  pagesUrl.searchParams.set("fields", "id,name,access_token,tasks");
  pagesUrl.searchParams.set("access_token", longData.access_token);
  pagesUrl.searchParams.set("limit", "100");

  const pagesRes = await fetch(pagesUrl);
  const pagesData = await pagesRes.json();
  if (!pagesRes.ok || !pagesData.data?.length) {
    throw new Error(pagesData.error?.message || "No Facebook Pages found for this account");
  }

  const pages = pagesData.data.map((page) => ({
    pageId: page.id,
    pageName: page.name,
    pageAccessToken: page.access_token,
    tasks: page.tasks || [],
  }));

  return {
    pages,
    userAccessToken: longData.access_token,
    expiresInSeconds: longData.expires_in || null,
    authType: "facebook_login",
  };
}

export async function checkStatus(data = {}) {
  if (!data.userAccessToken) {
    return { connected: false, configured: false };
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/me?access_token=${data.userAccessToken}`;
  const res = await fetch(url);
  const body = await res.json();

  if (!res.ok) {
    return { connected: false, configured: true, reason: body.error?.message };
  }

  return { connected: true, configured: true, pages: data.pages || [] };
}

export async function publish({ data, caption, images, options = {} }) {
  const pages = data.pages || [];
  if (!pages.length) throw new Error("No Facebook Pages connected");

  const pageIds = options.pageIds || [];
  const targetPages = pageIds.length
    ? pages.filter((p) => pageIds.includes(p.pageId))
    : pages;

  if (!targetPages.length) throw new Error("No selected Facebook Pages are connected");

  const base = `https://graph.facebook.com/${GRAPH_VERSION}`;
  const results = {};

  for (const page of targetPages) {
    results[page.pageId] = await publishToPage({ base, page, caption, images }).catch((err) => ({
      success: false,
      pageId: page.pageId,
      pageName: page.pageName,
      error: err.message,
    }));
  }

  const anySucceeded = Object.values(results).some((r) => r.success);
  return { success: anySucceeded, pages: results };
}

async function publishToPage({ base, page, caption, images }) {
  const { pageId, pageAccessToken: token, pageName } = page;
  if (!pageId || !token) throw new Error("Missing Facebook Page token");

  if (!images.length) {
    const res = await fetch(`${base}/${pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ message: caption, access_token: token }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "Facebook post failed");
    return { success: true, pageId, pageName, id: data.id };
  }

  if (images.length === 1) {
    const res = await fetch(`${base}/${pageId}/photos`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ url: images[0].url, caption, access_token: token }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "Facebook photo post failed");
    return { success: true, pageId, pageName, id: data.id || data.post_id };
  }

  // Multiple images: upload each unpublished, then attach all to one feed post
  const uploadedIds = [];
  for (const image of images) {
    const res = await fetch(`${base}/${pageId}/photos`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ url: image.url, published: "false", access_token: token }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "Facebook image upload failed");
    uploadedIds.push(data.id);
  }

  const feedForm = new URLSearchParams({ message: caption, access_token: token });
  uploadedIds.forEach((id, i) => feedForm.set(`attached_media[${i}]`, JSON.stringify({ media_fbid: id })));

  const feedRes = await fetch(`${base}/${pageId}/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: feedForm,
  });
  const feedData = await feedRes.json();
  if (!feedRes.ok) throw new Error(feedData.error?.message || "Facebook multi-photo post failed");

  return { success: true, pageId, pageName, id: feedData.id };
}

export async function disconnect() {
  return true;
}