import admin from "firebase-admin";
import { put } from "@vercel/blob";
import Busboy from "busboy";

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

function parseForm(req) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const files = {};

    const busboy = Busboy({
      headers: req.headers,
      limits: {
        files: 1,
        fileSize: 5 * 1024 * 1024,
      },
    });

    busboy.on("field", (name, value) => {
      fields[name] = value;
    });

    busboy.on("file", (name, file, info) => {
      const chunks = [];

      file.on("data", (chunk) => chunks.push(chunk));
      file.on("limit", () => reject(new Error("Image must be 5MB or less")));

      file.on("end", () => {
        files[name] = {
          buffer: Buffer.concat(chunks),
          filename: info.filename,
          mimeType: info.mimeType,
        };
      });
    });

    busboy.on("finish", () => resolve({ fields, files }));
    busboy.on("error", reject);

    req.pipe(busboy);
  });
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
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.replace("Bearer ", "");

    if (!idToken) {
      return res.status(401).json({ error: "Login required" });
    }

    const decoded = await admin.auth().verifyIdToken(idToken);
    const { fields, files } = await parseForm(req);

    const userSnap = await db.collection("users").doc(decoded.uid).get();
    const userProfile = userSnap.exists ? userSnap.data() : {};

    let imageUrl = null;
    const image = files.deviceImage;

    if (image?.buffer?.length) {
      const safeName = image.filename.replace(/[^a-zA-Z0-9.-]/g, "_");

      const blob = await put(
        `repair-images/${decoded.uid}-${Date.now()}-${safeName}`,
        image.buffer,
        {
          access: "public",
          contentType: image.mimeType,
        }
      );

      imageUrl = blob.url;
    }

    const repairRef = db.collection("repairs").doc();

    await repairRef.set({
      category: fields.category || "",
      deviceName: fields.deviceName || "",
      problemType: fields.problemType || "",
      issue: fields.issue || "",
      urgency: fields.urgency || "Normal",
      contact: fields.contact || "",
      serviceType: fields.serviceType || "",
      uid: decoded.uid,
      customerName:
        userProfile.name || decoded.email?.split("@")[0] || "Customer",
      email: userProfile.email || decoded.email || "",
      imageUrl,
      status: "Pending",
      timeline: [
        {
          stage: "Pending",
          time: new Date().toLocaleString(),
        },
      ],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await db.collection("notifications").add({
      audience: "admin",
      type: "new_repair",
      repairId: repairRef.id,
      message: `New repair request: ${fields.deviceName || "Unknown device"}`,
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(200).json({
      success: true,
      repairId: repairRef.id,
      imageUrl,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: err.message || "Could not create repair",
    });
  }
}