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

export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_FILES = 10;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB per image

function parseForm(req) {
  return new Promise((resolve, reject) => {
    const files = [];
    let fileLimitHit = false;
    let sizeLimitHit = false;

    const busboy = Busboy({
      headers: req.headers,
      limits: {
        files: MAX_FILES,
        fileSize: MAX_FILE_SIZE,
      },
    });

    busboy.on("file", (name, file, info) => {
      const chunks = [];

      file.on("data", (chunk) => chunks.push(chunk));

      file.on("limit", () => {
        sizeLimitHit = true;
      });

      file.on("end", () => {
        if (file.truncated) return; // dropped for exceeding size limit

        files.push({
          buffer: Buffer.concat(chunks),
          filename: info.filename || "media-image",
          mimeType: info.mimeType || "application/octet-stream",
        });
      });
    });

    busboy.on("filesLimit", () => {
      fileLimitHit = true;
    });

    busboy.on("finish", () => resolve({ files, fileLimitHit, sizeLimitHit }));
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

    const userSnap = await db.collection("users").doc(decoded.uid).get();
    const user = userSnap.exists ? userSnap.data() : null;

    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Admin only" });
    }

    const { files, fileLimitHit, sizeLimitHit } = await parseForm(req);

    if (!files.length) {
      return res.status(400).json({ error: "No images selected" });
    }

    const uploaded = [];

    for (const image of files) {
      const safeName = image.filename.replace(/[^a-zA-Z0-9.-]/g, "_");

      const blob = await put(
        `marketing-media/${decoded.uid}-${Date.now()}-${safeName}`,
        image.buffer,
        {
          access: "public",
          contentType: image.mimeType,
        }
      );

      const mediaRef = db.collection("media").doc();

      const mediaDoc = {
        url: blob.url,
        filename: safeName,
        mimeType: image.mimeType,
        size: image.buffer.length,
        uploadedBy: decoded.uid,
        uploadedByEmail: decoded.email || "",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      await mediaRef.set(mediaDoc);

      uploaded.push({ id: mediaRef.id, ...mediaDoc, createdAt: new Date().toISOString() });
    }

    return res.status(200).json({
      success: true,
      uploaded,
      warning: fileLimitHit
        ? `Only the first ${MAX_FILES} images were uploaded`
        : sizeLimitHit
        ? "One or more images were skipped for exceeding 5MB"
        : undefined,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: err.message || "Could not upload media",
    });
  }
}