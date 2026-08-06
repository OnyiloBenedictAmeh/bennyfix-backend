import admin from "firebase-admin";
import { getSocialSettings } from "./social-store.js";
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

// const db = admin.firestore();

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

    const meta = await getSocialSettings();

return res.status(200).json({
    facebook: {
        connected:
             !!meta.facebook?.connected,
        pages: normalizeFacebookPages(meta.facebook),
    },

    instagram: {
        connected: !!meta.instagram?.connected,
        userId: meta.instagram?.userId || null,
        username: meta.instagram?.username || null,
        accountType: meta.instagram?.accountType || null,
        authType: meta.instagram?.authType || null,
    },

    linkedin: {
        connected: !!meta.linkedin?.connected,
        personId: meta.linkedin?.personId || null,
        name: meta.linkedin?.name || null,
    },

    twitter: {
        connected: !!meta.twitter?.connected,
        userId: meta.twitter?.userId || null,
        username: meta.twitter?.username || null,
        name: meta.twitter?.name || null,
    },
});
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Could not load status" });
  }
}

function normalizeFacebookPages(facebook = {}) {
    return (facebook.pages || []).map(page => ({
        pageId: page.pageId,
        pageName: page.pageName,
        tasks: page.tasks || [],
    }));
}
