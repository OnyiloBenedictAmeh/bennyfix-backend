import admin, { db } from "./firebaseAdmin.js";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Verifies the caller is a logged-in admin.
 * Accepts the ID token via Authorization: Bearer header (fetch calls)
 * or ?idToken= query param (needed for top-level OAuth redirects, which
 * can't send custom headers).
 */
export async function requireAdmin(req) {
  const authHeader = req.headers.authorization || "";
  const idToken = authHeader.replace("Bearer ", "") || req.query?.idToken;

  if (!idToken) {
    throw new HttpError(401, "Login required");
  }

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(idToken);
  } catch (err) {
    throw new HttpError(401, "Session expired, please log in again");
  }

  const userSnap = await db.collection("users").doc(decoded.uid).get();
  const user = userSnap.exists ? userSnap.data() : null;

  if (!user || user.role !== "admin") {
    throw new HttpError(403, "Admin only");
  }

  return { decoded, user, idToken };
}