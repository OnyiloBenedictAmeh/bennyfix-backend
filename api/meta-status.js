import admin from "firebase-admin";
import { getSocialSettings } from "./social-store.js";

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
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");

    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    if (req.method !== "GET") {
        return res.status(405).json({
            error: "Method not allowed",
        });
    }

    try {
        const authHeader = req.headers.authorization || "";
        const idToken = authHeader.replace("Bearer ", "");

        if (!idToken) {
            return res.status(401).json({
                error: "Login required",
            });
        }

        const decoded = await admin.auth().verifyIdToken(idToken);

        const userSnap = await db.collection("users").doc(decoded.uid).get();
        const user = userSnap.exists ? userSnap.data() : null;

        if (!user || user.role !== "admin") {
            return res.status(403).json({
                error: "Admin only",
            });
        }

        const social = await getSocialSettings();

        const health = {
            facebook: await checkFacebook(social.facebook),
            instagram: await checkInstagram(social.instagram),
            linkedin: await checkLinkedIn(social.linkedin),
            twitter: await checkTwitter(social.twitter),
        };

        return res.status(200).json(health);

    } catch (err) {
        console.error(err);

        return res.status(500).json({
            error: err.message || "Could not load status",
        });
    }
}

/* ==========================================================
   FACEBOOK
========================================================== */

async function checkFacebook(facebook = {}) {

    if (!facebook.userAccessToken) {
        return {
            connected: false,
            configured: false,
        };
    }

    const url = `https://graph.facebook.com/${GRAPH_VERSION}/me?access_token=${facebook.userAccessToken}`;

    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok) {
        return {
            connected: false,
            configured: true,
            reason: data.error?.message,
        };
    }

    return {
        connected: true,
        configured: true,
        pages: facebook.pages || [],
    };
}

/* ==========================================================
   INSTAGRAM
========================================================== */

async function checkInstagram(instagram = {}) {

    if (!instagram.accessToken) {
        return {
            connected: false,
            configured: false,
        };
    }

    const url = new URL("https://graph.instagram.com/me");

    url.searchParams.set("fields", "id,username");
    url.searchParams.set("access_token", instagram.accessToken);

    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok) {
        return {
            connected: false,
            configured: true,
            reason: data.error?.message,
        };
    }

    return {
        connected: true,
        configured: true,
        id: data.id,
        username: data.username,
        accountType: instagram.accountType || null,
    };
}

/* ==========================================================
   LINKEDIN
========================================================== */

async function checkLinkedIn(linkedin = {}) {

    if (!linkedin.accessToken) {
        return {
            connected: false,
            configured: false,
        };
    }

    const res = await fetch(
        "https://api.linkedin.com/v2/userinfo",
        {
            headers: {
                Authorization: `Bearer ${linkedin.accessToken}`,
            },
        }
    );

    const data = await res.json();

    if (!res.ok) {
        return {
            connected: false,
            configured: true,
            reason: data.message,
        };
    }

    return {
        connected: true,
        configured: true,
        personId: linkedin.personId,
        name: data.name,
        email: data.email,
    };
}

/* ==========================================================
   X / TWITTER
========================================================== */

async function checkTwitter(twitter = {}) {

    if (!twitter.accessToken) {
        return {
            connected: false,
            configured: false,
        };
    }

    const res = await fetch(
        "https://api.x.com/2/users/me",
        {
            headers: {
                Authorization: `Bearer ${twitter.accessToken}`,
            },
        }
    );

    const data = await res.json();

    if (!res.ok) {
        return {
            connected: false,
            configured: true,
            reason: data.detail || data.title,
        };
    }

    return {
        connected: true,
        configured: true,
        userId: data.data.id,
        username: data.data.username,
        name: data.data.name,
    };
}