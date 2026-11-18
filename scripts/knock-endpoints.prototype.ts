// PROTOTYPE — throwaway probe of Knock endpoints for the "Does Knock hold up" spike.
import "dotenv/config";
import Knock, { signUserToken } from "@knocklabs/node";
const knock = new Knock();
const pk = process.env.KNOCK_PUBLIC_API_KEY!;
const ch = process.env.KNOCK_FEED_CHANNEL_ID!;
const api = "https://api.knock.app/v1";
async function client(path: string, token: string, init: RequestInit = {}) {
  const r = await fetch(api + path, { ...init, headers: { Authorization: `Bearer ${pk}`, "X-Knock-User-Token": token, "Content-Type": "application/json" } });
  const text = await r.text();
  return { status: r.status, body: text.slice(0, 400) };
}
const a = "probe-a", b = "probe-b";
await knock.users.update(a, { name: "Probe A" });
await knock.users.update(b, { name: "Probe B" });
const ta = await signUserToken(a);
console.log("feed A with A token", await client(`/users/${a}/feeds/${ch}`, ta));
console.log("feed B with A token", await client(`/users/${b}/feeds/${ch}`, ta));
console.log("prefs A get", await client(`/users/${a}/preferences/default`, ta));
console.log("prefs A put cat", await client(`/users/${a}/preferences/default`, ta, { method: "PUT", body: JSON.stringify({ categories: { "new-enrollment": { channel_types: { in_app_feed: true } } } }) }));
console.log("prefs A put other cat", await client(`/users/${a}/preferences/default`, ta, { method: "PUT", body: JSON.stringify({ categories: { "other": false } }) }));
console.log("prefs A get after", await client(`/users/${a}/preferences/default`, ta));
console.log("prefs B put with A token", await client(`/users/${b}/preferences/default`, ta, { method: "PUT", body: JSON.stringify({ categories: { x: false } }) }));
console.log("batch read (empty)", await client(`/messages/batch/read`, ta, { method: "POST", body: JSON.stringify({ message_ids: [] }) }));
try { console.log("workflows trigger discussion-reply", await knock.workflows.trigger("discussion-reply", { recipients: [a], data: {} })); } catch (e: any) { console.log("trigger err", e.status, e.message?.slice(0, 200)); }
await knock.users.delete(a); await knock.users.delete(b);
