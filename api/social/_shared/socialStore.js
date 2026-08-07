import admin, { db } from "./firebaseAdmin.js";

const COLLECTION = "settings";
const DOCUMENT = "social";

function ref() {
  return db.collection(COLLECTION).doc(DOCUMENT);
}

export async function getSocialSettings() {
  const snap = await ref().get();
  return snap.exists ? snap.data() : {};
}

export async function getPlatform(platform) {
  const social = await getSocialSettings();
  return social[platform] || {};
}

export async function savePlatform(platform, data) {
  await ref().set(
    {
      [platform]: {
        connected: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...data,
      },
    },
    { merge: true }
  );
}

export async function disconnectPlatform(platform) {
  await ref().set(
    {
      [platform]: {
        connected: false,
        disconnectedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    },
    { merge: true }
  );
}

export async function getConnectedPlatforms() {
  const social = await getSocialSettings();
  return Object.entries(social)
    .filter(([, value]) => value?.connected)
    .map(([name]) => name);
}