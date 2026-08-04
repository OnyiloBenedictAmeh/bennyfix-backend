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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.replace("Bearer ", "");

    if (!idToken) {
      return res.status(401).json({ error: "Login required" });
    }

    const decoded = await admin.auth().verifyIdToken(idToken);

    const userSnap = await db.collection("users").doc(decoded.uid).get();
    const user = userSnap.exists ? userSnap.data() : null;

    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Admin only" });
    }

    let metaSnap = await db.collection("integrations").doc(decoded.uid).get();
    if (!metaSnap.exists) {
      metaSnap = await db.collection("integrations").doc("meta").get();
    }
    const meta = metaSnap.exists ? metaSnap.data() : {};

    return res.status(200).json({
      facebook: {
        connected: (meta.facebook?.pages || []).length > 0 || !!meta.facebook?.pageAccessToken,
        pages: normalizeFacebookPages(meta.facebook),
      },
      instagram: {
        connected: !!meta.instagram?.accessToken,
        userId: meta.instagram?.userId || null,
        username: meta.instagram?.username || null,
        accountType: meta.instagram?.accountType || null,
        authType: meta.instagram?.authType || null,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Could not load status" });
  }
}

function normalizeFacebookPages(facebook = {}) {
  if (Array.isArray(facebook.pages) && facebook.pages.length) {
    return facebook.pages.map((page) => ({
      pageId: page.pageId,
      pageName: page.pageName,
      tasks: page.tasks || [],
    }));
  }

  if (facebook.pageId) {
    return [{
      pageId: facebook.pageId,
      pageName: facebook.pageName || "Facebook Page",
      tasks: facebook.tasks || [],
    }];
  }

  return [];
}
