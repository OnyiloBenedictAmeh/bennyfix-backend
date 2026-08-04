import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

const db = admin.firestore();

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v23.0";
const APP_ID = process.env.META_APP_ID;
const APP_SECRET = process.env.META_APP_SECRET;
const INSTAGRAM_APP_ID = process.env.INSTAGRAM_APP_ID;
const INSTAGRAM_APP_SECRET = process.env.INSTAGRAM_APP_SECRET;
// Must exactly match what's registered in the Meta App Dashboard and what
// the frontend used to build the authorize URL. No query string on this one
// on purpose — the platform is carried in `state` instead, so we only ever
// need a single redirect URI registered with Meta.
const REDIRECT_URI =
  process.env.META_REDIRECT_URI || "https://bennyfix-backend-v.vercel.app/api/meta-callback";
const APP_URL = process.env.APP_URL;

function redirectToAdmin(res, status, message) {
  const url = new URL("admin.html", APP_URL);
  url.searchParams.set("metaConnect", status);
  if (message) url.searchParams.set("metaMessage", message);
  res.writeHead(302, { Location: url.toString() });
  res.end();
}

export default async function handler(req, res) {
  const { code, state, error, error_description } = req.query;

  if (error) {
    return redirectToAdmin(res, "error", error_description || error);
  }

  if (!code || !state || !state.includes(":")) {
    return redirectToAdmin(res, "error", "Missing or malformed callback parameters");
  }

  const [platform, idToken] = state.split(":");

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(idToken);
  } catch (err) {
    return redirectToAdmin(res, "error", "Session expired, please reconnect");
  }

  try {
    const userSnap = await db.collection("users").doc(decoded.uid).get();
    const user = userSnap.exists ? userSnap.data() : null;

    if (!user || user.role !== "admin") {
      return redirectToAdmin(res, "error", "Admin only");
    }

    if (platform === "instagram") {
      await connectInstagram(code, decoded.uid);
    } else if (platform === "facebook") {
      await connectFacebook(code, decoded.uid);
    } else {
      return redirectToAdmin(res, "error", "Unknown platform");
    }

    return redirectToAdmin(res, "success", `${platform} connected`);
  } catch (err) {
    console.error(err);
    return redirectToAdmin(res, "error", err.message || "Connection failed");
  }
}

async function connectInstagram(code, uid) {
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

  const longRes = await fetch(longUrl.toString());
  const longData = await longRes.json();

  if (!longRes.ok || !longData.access_token) {
    throw new Error(longData.error?.message || "Instagram long-lived token exchange failed");
  }

  const profileUrl = new URL(`https://graph.instagram.com/${GRAPH_VERSION}/${shortData.user_id}`);
  profileUrl.searchParams.set("fields", "user_id,username,account_type");
  profileUrl.searchParams.set("access_token", longData.access_token);

  const profileRes = await fetch(profileUrl.toString());
  const profileData = await profileRes.json();

  if (!profileRes.ok) {
    throw new Error(profileData.error?.message || "Could not load Instagram profile");
  }

  await db.collection("integrations")
    .doc(uid)
    .set(
    {
      instagram: {
        userId: String(profileData.user_id || shortData.user_id),
        username: profileData.username || null,
        accountType: profileData.account_type || null,
        accessToken: longData.access_token,
        authType: "instagram_login",
        obtainedAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresInSeconds: longData.expires_in || null,
      },
    },
    { merge: true }
  );
}

async function connectFacebook(code, uid) {
  // Step 1: exchange the authorization code for a short-lived user token.
  const shortUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
  shortUrl.searchParams.set("client_id", APP_ID);
  shortUrl.searchParams.set("client_secret", APP_SECRET);
  shortUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  shortUrl.searchParams.set("code", code);

  const shortRes = await fetch(shortUrl.toString());
  const shortData = await shortRes.json();

  if (!shortRes.ok || !shortData.access_token) {
    throw new Error(shortData.error?.message || "Facebook token exchange failed");
  }

  // Step 2: exchange for a long-lived user token (~60 days).
  const longUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
  longUrl.searchParams.set("grant_type", "fb_exchange_token");
  longUrl.searchParams.set("client_id", APP_ID);
  longUrl.searchParams.set("client_secret", APP_SECRET);
  longUrl.searchParams.set("fb_exchange_token", shortData.access_token);

  const longRes = await fetch(longUrl.toString());
  const longData = await longRes.json();

  if (!longRes.ok || !longData.access_token) {
    throw new Error(longData.error?.message || "Facebook long-lived token exchange failed");
  }

  // Step 3: fetch every Page this account manages — not just the first.
  // A Page token derived this way stays valid as long as the admin keeps
  // their role on the Page — no 60-day refresh needed for this part.
  const pagesUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/me/accounts`);
  pagesUrl.searchParams.set("fields", "id,name,access_token,tasks");
  pagesUrl.searchParams.set("access_token", longData.access_token);
  pagesUrl.searchParams.set("limit", "100");

  const pagesRes = await fetch(pagesUrl.toString());
  const pagesData = await pagesRes.json();

  if (!pagesRes.ok || !pagesData.data?.length) {
    throw new Error(pagesData.error?.message || "No Facebook Pages found for this account");
  }

  const pages = pagesData.data.map((page) => ({
    pageId: page.id,
    pageName: page.name,
    pageAccessToken: page.access_token,
    tasks: page.tasks || [],
    connected: true,
  }));

  // Full overwrite: /me/accounts always returns the complete current set
  // for this login, so this naturally drops Pages you no longer manage.
  await db.collection("integrations")
    .doc(uid)
    .set(
    {
      facebook: {
        accessToken: longData.access_token,
        pages,
        connectedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    },
    { merge: true }
  );
}
