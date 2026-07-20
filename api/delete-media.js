import admin from "firebase-admin";
import { del } from "@vercel/blob";

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
  res.setHeader("Access-Control-Allow-Methods", "DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "DELETE") {
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

    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ error: "Missing media id" });
    }

    const mediaRef = db.collection("media").doc(id);
    const mediaSnap = await mediaRef.get();

    if (!mediaSnap.exists) {
      return res.status(404).json({ error: "Media not found" });
    }

    const media = mediaSnap.data();

    if (media.url) {
      try {
        await del(media.url);
      } catch (blobErr) {
        // If the blob is already gone, don't block cleanup of the
        // Firestore record — log and continue.
        console.error("Blob delete failed:", blobErr.message || blobErr);
      }
    }

    await mediaRef.delete();

    return res.status(200).json({ success: true, id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: err.message || "Could not delete media",
    });
  }
}