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
const META_APP_ID = process.env.META_APP_ID;
const INSTAGRAM_APP_ID = process.env.INSTAGRAM_APP_ID;
const REDIRECT_URI =
  process.env.META_REDIRECT_URI || "https://bennyfix-backend-v.vercel.app/api/meta-callback";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const platform = String(req.query.platform || "").toLowerCase();
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.replace("Bearer ", "") || req.query.idToken;

    if (!idToken) {
      return res.status(401).json({ error: "Login required" });
    }

    const decoded = await admin.auth().verifyIdToken(idToken);
    const userSnap = await db.collection("users").doc(decoded.uid).get();
    const user = userSnap.exists ? userSnap.data() : null;

    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Admin only" });
    }

    const state = `${platform}:${idToken}`;
    let authorizeUrl;

    if (platform === "instagram") {
      if (!INSTAGRAM_APP_ID) {
        return res.status(500).json({ error: "INSTAGRAM_APP_ID is not configured" });
      }

      authorizeUrl = new URL("https://www.instagram.com/oauth/authorize");
      authorizeUrl.searchParams.set("client_id", INSTAGRAM_APP_ID);
      authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set(
        "scope",
        "instagram_business_basic,instagram_business_content_publish"
      );
      authorizeUrl.searchParams.set("enable_fb_login", "0");
      authorizeUrl.searchParams.set("force_authentication", "1");
      authorizeUrl.searchParams.set("state", state);
    } else if (platform === "facebook") {
      if (!META_APP_ID) {
        return res.status(500).json({ error: "META_APP_ID is not configured" });
      }

      authorizeUrl = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
      authorizeUrl.searchParams.set("client_id", META_APP_ID);
      authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set(
        "scope",
        "pages_show_list,pages_read_engagement,pages_manage_posts"
      );
      authorizeUrl.searchParams.set("state", state);
    } else {
      return res.status(400).json({ error: "Unknown platform" });
    }

    res.writeHead(302, { Location: authorizeUrl.toString() });
    res.end();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Could not start connection" });
  }
}
