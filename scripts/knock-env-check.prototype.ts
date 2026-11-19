// PROTOTYPE — throwaway. Are the secret key, public key + signing key, and feed
// channel all in the same Knock environment? Writes a marker preference with the
// browser-side credentials, then reads it back with the secret key.
import Knock, { signUserToken } from "@knocklabs/node";
const knock = new Knock();
const id = "spike-env-check";
const marker = `marker-${Date.now()}`;
const token = await signUserToken(id);
const r = await fetch(`https://api.knock.app/v1/users/${id}/preferences/default`, {
  method: "PUT",
  headers: {
    Authorization: `Bearer ${process.env.KNOCK_PUBLIC_API_KEY}`,
    "X-Knock-User-Token": token,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ categories: { [marker]: false } }),
});
console.log("public key + signed token write:", r.status);
try {
  const p = await knock.users.getPreferences(id, "default");
  const seen = Object.keys(p.categories ?? {}).includes(marker);
  console.log("secret key reads it back:", seen ? "YES (same environment)" : "NO (different environment)");
} catch (e: any) {
  console.log("secret key read:", e.status, "→ user not found: DIFFERENT environment");
}
const f = await fetch(`https://api.knock.app/v1/users/${id}/feeds/${process.env.KNOCK_FEED_CHANNEL_ID}`, {
  headers: { Authorization: `Bearer ${process.env.KNOCK_PUBLIC_API_KEY}`, "X-Knock-User-Token": token },
});
console.log("feed channel in public key's environment:", f.status);
await knock.users.delete(id).catch(() => {});
