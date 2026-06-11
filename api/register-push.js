import admin from "firebase-admin";

function getFirebaseAdmin() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      }),
    });
  }

  return admin;
}

function safeId(value) {
  return Buffer.from(value)
    .toString("base64")
    .replaceAll("/", "_")
    .replaceAll("+", "-")
    .replaceAll("=", "");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const firebaseAdmin = getFirebaseAdmin();
    const db = firebaseAdmin.firestore();

    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.replace("Bearer ", "");

    const decoded = await firebaseAdmin.auth().verifyIdToken(idToken);

    const userSnap = await db.collection("users").doc(decoded.uid).get();
    const user = userSnap.exists ? userSnap.data() : null;

    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Admin only" });
    }

    const { subscription } = req.body;

    if (!subscription?.endpoint) {
      return res.status(400).json({ error: "Missing push subscription" });
    }

    await db.collection("adminPushSubscriptions").doc(safeId(subscription.endpoint)).set({
      uid: decoded.uid,
      email: decoded.email || user.email || "",
      subscription,
      active: true,
      updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Could not register push" });
  }
}