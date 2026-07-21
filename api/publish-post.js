import admin from "firebase-admin";

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
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v23.0";

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

    const { postId } = req.body || {};

    if (!postId) {
      return res.status(400).json({ error: "Missing postId" });
    }

    const postRef = db.collection("posts").doc(postId);
    const postSnap = await postRef.get();

    if (!postSnap.exists) {
      return res.status(404).json({ error: "Post not found" });
    }

    const post = postSnap.data();
    const caption = post.caption || "";
    const images = post.images || [];
    const requestedPlatforms = post.platforms || [];

    if (!requestedPlatforms.length) {
      return res.status(400).json({ error: "No platforms selected on this post" });
    }

    let metaSnap = await db.collection("integrations").doc(decoded.uid).get();
    if (!metaSnap.exists) {
      metaSnap = await db.collection("integrations").doc("meta").get();
    }
    const meta = metaSnap.exists ? metaSnap.data() : {};

    const results = {};

    if (requestedPlatforms.includes("facebook")) {
      results.facebook = await publishToFacebook({
        meta,
        caption,
        images,
        pageIds: post.facebookPageIds || [],
      }).catch((err) => ({
        success: false,
        error: err.message,
      }));
    }

    if (requestedPlatforms.includes("instagram")) {
      results.instagram = await publishToInstagram({ meta, caption, images }).catch((err) => ({
        success: false,
        error: err.message,
      }));
    }

    const anySucceeded = Object.values(results).some((r) => r.success);

    await postRef.update({
      status: anySucceeded ? "published" : post.status,
      publishedAt: anySucceeded ? admin.firestore.FieldValue.serverTimestamp() : post.publishedAt || null,
      publishResults: results,
    });

    return res.status(200).json({ success: anySucceeded, results });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Could not publish post" });
  }
}

async function publishToFacebook({ meta, caption, images, pageIds = [] }) {
  const pages = normalizeFacebookPagesForPublish(meta.facebook);

  if (!pages.length) {
    throw new Error("No Facebook Pages connected");
  }

  const selectedPageIds = pageIds.length ? new Set(pageIds) : null;
  const targetPages = selectedPageIds
    ? pages.filter((page) => selectedPageIds.has(page.pageId))
    : pages;

  if (!targetPages.length) {
    throw new Error("No selected Facebook Pages are connected");
  }

  const base = `https://graph.facebook.com/${GRAPH_VERSION}`;
  const results = {};

  for (const page of targetPages) {
    const pageId = page.pageId;
    const token = page.pageAccessToken;

    if (!pageId || !token) {
      results[pageId || page.pageName || "unknown"] = {
        success: false,
        error: "Missing Facebook Page token",
      };
      continue;
    }

    results[pageId] = await publishToFacebookPage({
      base,
      pageId,
      token,
      caption,
      images,
      pageName: page.pageName,
    }).catch((err) => ({
      success: false,
      pageId,
      pageName: page.pageName,
      error: err.message,
    }));
  }

  const anySucceeded = Object.values(results).some((result) => result.success);

  return {
    success: anySucceeded,
    pages: results,
  };
}

function normalizeFacebookPagesForPublish(facebook = {}) {
  if (Array.isArray(facebook.pages) && facebook.pages.length) {
    return facebook.pages;
  }

  if (facebook.pageId && facebook.pageAccessToken) {
    return [{
      pageId: facebook.pageId,
      pageName: facebook.pageName || "Facebook Page",
      pageAccessToken: facebook.pageAccessToken,
    }];
  }

  return [];
}

async function publishToFacebookPage({ base, pageId, token, caption, images, pageName }) {
  if (!images.length) {
    const res = await fetch(`${base}/${pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ message: caption, access_token: token }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "Facebook post failed");
    return { success: true, pageId, pageName, id: data.id };
  }

  if (images.length === 1) {
    const res = await fetch(`${base}/${pageId}/photos`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        url: images[0].url,
        caption,
        access_token: token,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "Facebook photo post failed");
    return { success: true, pageId, pageName, id: data.id || data.post_id };
  }

  // Multiple images: upload each unpublished, then attach all to one feed post.
  const uploadedIds = [];

  for (const image of images) {
    const res = await fetch(`${base}/${pageId}/photos`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        url: image.url,
        published: "false",
        access_token: token,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "Facebook image upload failed");
    uploadedIds.push(data.id);
  }

  const attachedMedia = uploadedIds.map((id) => JSON.stringify({ media_fbid: id }));

  const feedForm = new URLSearchParams({ message: caption, access_token: token });
  attachedMedia.forEach((item, i) => feedForm.set(`attached_media[${i}]`, item));

  const feedRes = await fetch(`${base}/${pageId}/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: feedForm,
  });

  const feedData = await feedRes.json();
  if (!feedRes.ok) throw new Error(feedData.error?.message || "Facebook multi-photo post failed");

  return {
    success: true,
    pageId,
    pageName,
    id: feedData.id,
  };
}

async function publishToInstagram({ meta, caption, images }) {
  const igUserId = meta.instagram?.userId;
  const token = meta.instagram?.accessToken;

  if (!igUserId || !token) {
    throw new Error("Instagram isn't connected yet");
  }

  if (!images.length) {
    throw new Error("Instagram posts need at least one image");
  }

  const base = `https://graph.facebook.com/${GRAPH_VERSION}`;

  if (images.length === 1) {
    const creationId = await createContainer({
      base,
      igUserId,
      token,
      params: { image_url: images[0].url, caption },
    });

    await waitUntilReady({ base, creationId, token });

    const publishId = await publishContainer({ base, igUserId, token, creationId });
    return { success: true, id: publishId };
  }

  // Carousel: create each item, then a parent container referencing them.
  const childIds = [];

  for (const image of images.slice(0, 10)) {
    const childId = await createContainer({
      base,
      igUserId,
      token,
      params: { image_url: image.url, is_carousel_item: "true" },
    });
    childIds.push(childId);
  }

  const carouselId = await createContainer({
    base,
    igUserId,
    token,
    params: { media_type: "CAROUSEL", caption, children: childIds.join(",") },
  });

  await waitUntilReady({ base, creationId: carouselId, token });

  const publishId = await publishContainer({ base, igUserId, token, creationId: carouselId });
  return { success: true, id: publishId };
}

async function createContainer({ base, igUserId, token, params }) {
  const res = await fetch(`${base}/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, access_token: token }),
  });

  const data = await res.json();
  if (!res.ok || !data.id) throw new Error(data.error?.message || "Instagram container creation failed");
  return data.id;
}

async function publishContainer({ base, igUserId, token, creationId }) {
  const res = await fetch(`${base}/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ creation_id: creationId, access_token: token }),
  });

  const data = await res.json();
  if (!res.ok || !data.id) throw new Error(data.error?.message || "Instagram publish failed");
  return data.id;
}

// Image containers are usually ready instantly, but poll briefly just in case.
async function waitUntilReady({ base, creationId, token, attempts = 5 }) {
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(
      `${base}/${creationId}?fields=status_code&access_token=${encodeURIComponent(token)}`
    );
    const data = await res.json();

    if (data.status_code === "FINISHED") return;
    if (data.status_code === "ERROR") throw new Error("Instagram media processing failed");

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}
