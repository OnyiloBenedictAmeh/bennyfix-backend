import { requireAdmin, HttpError } from "./_shared/requireAdmin.js";
import { applyCors } from "./_shared/cors.js";
import { disconnectPlatform } from "./_shared/socialStore.js";
import { getPlatformModule } from "./platforms/registry.js";

export default async function handler(req, res) {
  applyCors(res, "POST");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    await requireAdmin(req);

    const platform = String(req.body?.platform || req.query.platform || "").toLowerCase();
    const platformModule = getPlatformModule(platform);
    if (!platformModule) return res.status(400).json({ error: "Unknown platform" });

    await disconnectPlatform(platform);
    return res.status(200).json({ success: true });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    return res.status(500).json({ error: err.message || "Could not disconnect" });
  }
}