import { requireAdmin, HttpError } from "./_shared/requireAdmin.js";
import { applyCors } from "./_shared/cors.js";
import { encodeState } from "./_shared/oauthState.js";
import { getPlatformModule } from "./platforms/registry.js";

export default async function handler(req, res) {
  applyCors(res, "GET");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const platform = String(req.query.platform || "").toLowerCase();
    const { idToken } = await requireAdmin(req);

    const platformModule = getPlatformModule(platform);
    if (!platformModule) return res.status(400).json({ error: "Unknown platform" });

    let authorizeUrl;

    if (platform === "twitter") {
      authorizeUrl = platformModule.buildAuthorizeUrlWithPkce(encodeState, { platform, idToken });
    } else {
      const state = encodeState({ platform, idToken });
      authorizeUrl = platformModule.buildAuthorizeUrl(state);
    }

    res.writeHead(302, { Location: authorizeUrl });
    res.end();
  } catch (err) {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: err.message || "Could not start connection" });
  }
}