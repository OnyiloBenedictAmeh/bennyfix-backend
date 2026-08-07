import { requireAdmin, HttpError } from "./_shared/requireAdmin.js";
import { applyCors } from "./_shared/cors.js";
import { getSocialSettings } from "./_shared/socialStore.js";
import { PLATFORMS } from "./platforms/registry.js";

export default async function handler(req, res) {
  applyCors(res, "GET");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    await requireAdmin(req);

    const social = await getSocialSettings();
    const status = {};

    await Promise.all(
      Object.entries(PLATFORMS).map(async ([name, platformModule]) => {
        try {
          status[name] = await platformModule.checkStatus(social[name] || {});
        } catch (err) {
          status[name] = {
            connected: false,
            configured: !!social[name]?.connected,
            reason: err.message,
          };
        }
      })
    );

    return res.status(200).json(status);
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    return res.status(500).json({ error: err.message || "Could not load status" });
  }
}