import admin from "firebase-admin";
import { Resend } from "resend";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

const resend = new Resend(process.env.RESEND_API_KEY);

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
    const user = await admin.auth().getUser(decoded.uid);

    if (user.emailVerified) {
      return res.status(200).json({ success: true, alreadyVerified: true });
    }

    const link = await admin.auth().generateEmailVerificationLink(user.email, {
      url: `${process.env.APP_URL}/index.html`,
      handleCodeInApp: false,
    });

    const name = user.displayName || user.email.split("@")[0] || "there";

    await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: user.email,
      subject: "Verify your BennyFix Hub account",
      html: `
        <div style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;color:#111827;">
          <div style="max-width:520px;margin:0 auto;padding:32px 18px;">
            <div style="background:#ffffff;border:1px solid #e5e7eb;border-top:4px solid #f97316;border-radius:12px;padding:32px;box-shadow:0 18px 45px rgba(15,23,42,.08);">
              <div style="font-size:13px;font-weight:700;color:#f97316;text-transform:uppercase;letter-spacing:.08em;margin-bottom:18px;">
                BennyFix Hub
              </div>

              <h1 style="font-size:24px;line-height:1.25;margin:0 0 12px;color:#111827;">
                Verify your email address
              </h1>

              <p style="font-size:15px;line-height:1.6;color:#475569;margin:0 0 18px;">
                Hi ${name}, welcome to BennyFix Hub. Please confirm your email address so your repair requests and account updates stay secure.
              </p>

              <a href="${link}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-weight:700;border-radius:8px;padding:13px 18px;margin:10px 0 22px;">
                Verify email
              </a>

              <p style="font-size:13px;line-height:1.6;color:#64748b;margin:0 0 12px;">
                If the button does not work, copy and paste this link into your browser:
              </p>

              <p style="font-size:12px;line-height:1.5;word-break:break-all;color:#2563eb;margin:0 0 22px;">
                ${link}
              </p>

              <div style="border-top:1px solid #e5e7eb;padding-top:18px;font-size:12px;line-height:1.6;color:#94a3b8;">
                If you did not create a BennyFix Hub account, you can ignore this email.
              </div>
            </div>
          </div>
        </div>
      `,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Verification email failed:", err);
    return res.status(500).json({
      error: err.message || "Could not send verification email",
    });
  }
}