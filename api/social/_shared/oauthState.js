export function encodeState(data) {
  return Buffer.from(JSON.stringify(data)).toString("base64url");
}

export function decodeState(state) {
  try {
    return JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
  } catch (err) {
    // Legacy fallback for the old "platform:idToken" format
    if (state?.includes(":")) {
      const [platform, idToken] = state.split(":");
      return { platform, idToken };
    }
    return {};
  }
}