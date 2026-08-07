import admin, { db } from "./_shared/firebaseAdmin.js";
import { decodeState } from "./_shared/oauthState.js";
import { savePlatform } from "./_shared/socialStore.js";
import { getPlatformModule } from "./platforms/registry.js";

const APP_URL = process.env.APP_URL;

function redirectToAdmin(res, status, message) {
  const url = new URL("admin.html", APP_URL);
  url.searchParams.set("metaConnect", status);
  if (message) url.searchParams.set("metaMessage", message);
  res.writeHead(302, { Location: url.toString() });
  res.end();
}

export default async function handler(req, res) {
  const { code, state, error, error_description } = req.query;

  if (error) {
    return redirectToAdmin(res, "error", error_description || error);
  }

  if (!code || !state) {
    return redirectToAdmin(res, "error", "Missing or malformed callback parameters");
  }

  const { platform, idToken, codeVerifier } = decodeState(state);
  if (!platform || !idToken) {
    return redirectToAdmin(res, "error", "Missing or malformed callback parameters");
  }

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(idToken);
  } catch (err) {
    return redirectToAdmin(res, "error", "Session expired, please reconnect");
  }

  try {
    const userSnap = await db.collection("users").doc(decoded.uid).get();
    const user = userSnap.exists ? userSnap.data() : null;

    if (!user || user.role !== "admin") {
      return redirectToAdmin(res, "error", "Admin only");
    }

    const platformModule = getPlatformModule(platform);
    if (!platformModule) {
      return redirectToAdmin(res, "error", "Unknown platform");
    }

    const platformData = await platformModule.handleCallback(code, { codeVerifier });
    await savePlatform(platform, platformData);

    return redirectToAdmin(res, "success", `${platformModule.meta?.displayName || platform} connected`);
  } catch (err) {
    console.error(err);
    return redirectToAdmin(res, "error", err.message || "Connection failed");
  }
}