// PROTOTYPE — throwaway. Does new-enrollment reach a fresh user with NO stored prefs?
import Knock from "@knocklabs/node";
const knock = new Knock();
const id = `spike-fresh-${Date.now()}`;
await knock.users.update(id, { name: "Fresh instructor" });
console.log("stored prefs:", JSON.stringify((await knock.users.getPreferences(id, "default")).categories));
await knock.workflows.trigger("new-enrollment", { recipients: [id], data: { course_title: "x" } });
await new Promise((r) => setTimeout(r, 6000));
const page: any = await knock.users.listMessages(id, { page_size: 10 } as any);
const items = page.items ?? page.entries ?? [];
console.log("messages for fresh user:", items.length, items.map((m: any) => m.status));
// Workaround probe: write the user's own default set at identify time.
const id2 = `${id}-b`;
await knock.users.update(id2, { name: "Fresh instructor (seeded prefs)" });
await knock.users.setPreferences(id2, "default", { categories: { "new-enrollment": { channel_types: { in_app_feed: false } } } } as any);
await knock.workflows.trigger("new-enrollment", { recipients: [id2], data: { course_title: "x" } });
await new Promise((r) => setTimeout(r, 6000));
const p2: any = await knock.users.listMessages(id2, { page_size: 10 } as any);
console.log("seeded prefs read back:", JSON.stringify((await knock.users.getPreferences(id2, "default")).categories));
console.log("messages for seeded-off user:", (p2.items ?? p2.entries ?? []).map((m: any) => `${m.source?.key}:${m.status}`));
await knock.users.delete(id); await knock.users.delete(id2);
