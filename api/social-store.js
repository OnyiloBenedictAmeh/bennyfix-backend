import admin from "firebase-admin";

const db = admin.firestore();

const COLLECTION = "settings";
const DOCUMENT = "social";

function ref() {
    return db.collection(COLLECTION).doc(DOCUMENT);
}

/* ==========================================================
   INTERNAL HELPERS
========================================================== */

async function savePlatform(platform, data) {
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

/* ==========================================================
   FACEBOOK
========================================================== */

export async function saveFacebook(pages, tokenData) {
    return savePlatform("facebook", {
        pages,
        userAccessToken: tokenData.access_token,
        expiresInSeconds: tokenData.expires_in || null,
        authType: "facebook_login",
        obtainedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
}

export async function getFacebook() {
    const social = await getSocialSettings();
    return social.facebook || {};
}

/* ==========================================================
   INSTAGRAM
========================================================== */

export async function saveInstagram(profileData, tokenData) {
    return savePlatform("instagram", {
        userId: String(profileData.id),
        username: profileData.username || null,
        accountType: profileData.account_type || null,
        accessToken: tokenData.access_token,
        authType: "instagram_login",
        obtainedAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresInSeconds: tokenData.expires_in || null,
    });
}

export async function getInstagram() {
    const social = await getSocialSettings();
    return social.instagram || {};
}

/* ==========================================================
   LINKEDIN
========================================================== */

export async function saveLinkedIn(profileData, tokenData) {
    return savePlatform("linkedin", {
        accessToken: tokenData.access_token,
        personId: profileData.sub,
        name: profileData.name || null,
        email: profileData.email || null,
        authType: "oauth2",
        obtainedAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresInSeconds: tokenData.expires_in || null,
    });
}

export async function getLinkedIn() {
    const social = await getSocialSettings();
    return social.linkedin || {};
}

/* ==========================================================
   TWITTER / X
========================================================== */

export async function saveTwitter(userData, tokenData) {
    return savePlatform("twitter", {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || null,
        userId: userData.data.id,
        username: userData.data.username || null,
        name: userData.data.name || null,
        authType: "oauth2_pkce",
        obtainedAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresInSeconds: tokenData.expires_in || null,
    });
}

export async function getTwitter() {
    const social = await getSocialSettings();
    return social.twitter || {};
}

/* ==========================================================
   GENERIC
========================================================== */

export async function getSocialSettings() {
    const snap = await ref().get();

    if (!snap.exists) {
        return {};
    }

    return snap.data();
}

export async function getPlatform(platform) {
    const social = await getSocialSettings();
    return social[platform] || {};
}

export async function getConnectedPlatforms() {
    const social = await getSocialSettings();

    return Object.entries(social)
        .filter(([_, value]) => value?.connected)
        .map(([name]) => name);
}

export async function disconnectPlatform(platform) {
    await ref().set(
        {
            [platform]: {
                connected: false,
                disconnectedAt:
                    admin.firestore.FieldValue.serverTimestamp(),
            },
        },
        { merge: true }
    );
}