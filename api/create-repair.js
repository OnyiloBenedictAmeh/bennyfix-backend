import admin from "firebase-admin";
import { put } from "@vercel/blob";
import Busboy from "busboy";
import webPush from "web-push";

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

function configureWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) {
    throw new Error("Missing VAPID environment variables");
  }

  webPush.setVapidDetails(subject, publicKey, privateKey);
}

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
          filename: info.filename || "repair-image",
          mimeType: info.mimeType || "application/octet-stream",
        };
      });
    });

    busboy.on("finish", () => resolve({ fields, files }));
    busboy.on("error", reject);

    req.pipe(busboy);
  });
}

async function sendAdminPushNotifications({ repairId, deviceName, issue }) {
  configureWebPush();

  const snapshot = await db
    .collection("adminPushSubscriptions")
    .where("active", "==", true)
    .get();

  console.log("Active push subscriptions:", snapshot.size);

  if (snapshot.empty) return;

  const payload = JSON.stringify({
    title: "New repair request",
    body: `${deviceName || "Unknown device"} - ${issue || "No issue provided"}`,
    url: `/admin.html?repairId=${repairId}`,
    repairId,
  });

  const results = await Promise.allSettled(
    snapshot.docs.map(async (docSnap) => {
      const { subscription } = docSnap.data();

      if (!subscription?.endpoint) {
        console.log("Missing subscription endpoint:", docSnap.id);
        return;
      }

      try {
        await webPush.sendNotification(subscription, payload);
        console.log("Push sent:", docSnap.id);
      } catch (err) {
        console.error("Push notification failed:", {
          id: docSnap.id,
          statusCode: err.statusCode,
          message: err.message,
          body: err.body,
        });

        const isExpired = err.statusCode === 404 || err.statusCode === 410;

        if (isExpired) {
          await docSnap.ref.update({
            active: false,
            disabledAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      }
    })
  );

  console.log("Push send results:", results.map((result) => result.status));
}
export const config = {
  api: {
    bodyParser: false,
  },
};

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

    try {
      await sendAdminPushNotifications({
        repairId: repairRef.id,
        deviceName: fields.deviceName,
        issue: fields.issue,
      });
    } catch (pushErr) {
      console.error("Admin push send failed:", pushErr.message || pushErr);
    }

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
