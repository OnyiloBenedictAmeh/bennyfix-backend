import admin, { db } from "./_shared/firebaseAdmin.js";
import { requireAdmin, HttpError } from "./_shared/requireAdmin.js";
import { applyCors } from "./_shared/cors.js";
import { getSocialSettings } from "./_shared/socialStore.js";
import { getPlatformModule } from "./platforms/registry.js";

export default async function handler(req, res) {
  applyCors(res, "POST");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    await requireAdmin(req);

    const { postId } = req.body || {};
    if (!postId) return res.status(400).json({ error: "Missing postId" });

    const postRef = db.collection("posts").doc(postId);
    const postSnap = await postRef.get();
    if (!postSnap.exists) return res.status(404).json({ error: "Post not found" });

    const post = postSnap.data();
    const caption = post.caption || "";
    const images = post.images || [];
    const platforms = post.platforms || [];

    if (!platforms.length) {
      return res.status(400).json({ error: "No platforms selected on this post" });
    }

    const social = await getSocialSettings();
    const results = {};

    // Each platform publishes independently — Promise.all + individual
    // .catch() per platform means one failure (e.g. an expired LinkedIn
    // token) never blocks the others from publishing.
    await Promise.all(
      platforms.map(async (platformName) => {
        const platformModule = getPlatformModule(platformName);

        if (!platformModule) {
          results[platformName] = { success: false, error: "Unknown platform" };
          return;
        }

        try {
          results[platformName] = await platformModule.publish({
            data: social[platformName] || {},
            caption,
            images,
            options: { pageIds: post.facebookPageIds || [] },
          });
        } catch (err) {
          results[platformName] = { success: false, error: err.message };
        }
      })
    );

    const anySucceeded = Object.values(results).some((r) => r.success);

    await postRef.update({
      status: anySucceeded ? "published" : post.status,
      publishedAt: anySucceeded ? admin.firestore.FieldValue.serverTimestamp() : post.publishedAt || null,
      publishResults: results,
    });

    return res.status(200).json({ success: anySucceeded, results });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    return res.status(500).json({ error: err.message || "Could not publish post" });
  }
}