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

const DEFAULT_LIMIT = 100;

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

    const requestedLimit = parseInt(req.query.limit, 10);
    const limit =
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, 200)
        : DEFAULT_LIMIT;

    const snapshot = await db
      .collection("media")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    const media = snapshot.docs.map((doc) => {
      const data = doc.data();

      return {
        id: doc.id,
        url: data.url,
        filename: data.filename,
        mimeType: data.mimeType,
        size: data.size,
        uploadedBy: data.uploadedBy,
        uploadedByEmail: data.uploadedByEmail,
        createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null,
      };
    });

    return res.status(200).json({ success: true, media });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: err.message || "Could not load media library",
    });
  }
}