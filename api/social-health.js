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

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v23.0";

export default async function handler(req, res) {

    try {

        const social = await getSocialSettings();

        const status = {
            facebook: await checkFacebook(social.facebook),
            instagram: await checkInstagram(social.instagram),
            linkedin: await checkLinkedIn(social.linkedin),
            twitter: await checkTwitter(social.twitter)
        };

        res.status(200).json(status);

    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: err.message
        });
    }

}
async function checkFacebook(facebook = {}) {

    if (!facebook.userAccessToken) {
        return {
            connected: false
        };
    }

    const url =
        `https://graph.facebook.com/${GRAPH_VERSION}/me?access_token=${facebook.userAccessToken}`;

    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok) {

        return {
            connected: false,
            reason: data.error?.message
        };

    }

    return {
        connected: true,
        pages: facebook.pages || []
    };

}
async function checkInstagram(instagram = {}) {

    if (!instagram.accessToken) {

        return {
            connected: false
        };

    }

    const url = new URL("https://graph.instagram.com/me");

    url.searchParams.set("fields", "id,username");

    url.searchParams.set(
        "access_token",
        instagram.accessToken
    );

    const res = await fetch(url);

    const data = await res.json();

    if (!res.ok) {

        return {
            connected: false,
            reason: data.error?.message
        };

    }

    return {
        connected: true,
        username: data.username,
        id: data.id
    };

}
async function checkLinkedIn(linkedin = {}) {

    if (!linkedin.accessToken) {

        return {
            connected: false
        };

    }

    const res = await fetch(
        "https://api.linkedin.com/v2/userinfo",
        {
            headers: {
                Authorization:
                    `Bearer ${linkedin.accessToken}`
            }
        }
    );

    const data = await res.json();

    if (!res.ok) {

        return {
            connected: false,
            reason: data.message
        };

    }

    return {
        connected: true,
        name: data.name,
        email: data.email
    };

}
async function checkTwitter(twitter = {}) {

    if (!twitter.accessToken) {

        return {
            connected: false
        };

    }

    const res = await fetch(
        "https://api.x.com/2/users/me",
        {
            headers: {
                Authorization:
                    `Bearer ${twitter.accessToken}`
            }
        }
    );

    const data = await res.json();

    if (!res.ok) {

        return {
            connected: false,
            reason: data.detail
        };

    }

    return {
        connected: true,
        username: data.data.username,
        name: data.data.name
    };

}