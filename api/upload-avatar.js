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

function parseForm(req) {
  return new Promise((resolve, reject) => {

    const files = {};

    const busboy = Busboy({
      headers: req.headers,
      limits: {
        files: 1,
        fileSize: 5 * 1024 * 1024,
      },
    });

    busboy.on("file", (name, file, info) => {

      const chunks = [];

      file.on("data", (chunk) => {
        chunks.push(chunk);
      });

      file.on("limit", () => {
        reject(
          new Error("Image must be 5MB or less")
        );
      });

      file.on("end", () => {

        files[name] = {
          buffer: Buffer.concat(chunks),
          filename:
            info.filename || "avatar",
          mimeType:
            info.mimeType ||
            "application/octet-stream",
        };

      });

    });

    busboy.on("finish", () => {
      resolve({ files });
    });

    busboy.on("error", reject);

    req.pipe(busboy);

  });
}

export default async function handler(
  req,
  res
) {

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  try {

    const authHeader =
      req.headers.authorization || "";

    const idToken =
      authHeader.replace(
        "Bearer ",
        ""
      );

    if (!idToken) {
      return res.status(401).json({
        error: "Login required",
      });
    }

    const decoded =
      await admin
        .auth()
        .verifyIdToken(idToken);

    const { files } =
      await parseForm(req);
    console.log("FILES RECEIVED:", Object.keys(files));
    const avatar =
      files.avatar;

    if (!avatar) {
      return res.status(400).json({
        error: "No image selected",
      });
    }

    const safeName =
      avatar.filename.replace(
        /[^a-zA-Z0-9.-]/g,
        "_"
      );

    const blob = await put(
      `profile-images/${decoded.uid}-${Date.now()}-${safeName}`,
      avatar.buffer,
      {
        access: "public",
        contentType:
          avatar.mimeType,
      }
    );

    await db
      .collection("users")
      .doc(decoded.uid)
      .update({
        avatar: blob.url,
        updatedAt:
          admin.firestore.FieldValue.serverTimestamp(),
      });

    return res.status(200).json({
      success: true,
      avatarUrl: blob.url,
    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      error:
        err.message ||
        "Could not upload avatar",
    });

  }

}