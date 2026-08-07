// This file is kept only so the existing frontend (which calls
// /api/meta-connect?platform=...) keeps working unchanged. All real logic
// now lives in /api/social/connect.js and /api/social/platforms/*.
export { default } from "./social/connect.js";