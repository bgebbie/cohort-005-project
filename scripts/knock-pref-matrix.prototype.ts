// PROTOTYPE — throwaway. Which preference shapes actually suppress new-enrollment?
import Knock from "@knocklabs/node";
const knock = new Knock();
const cases: Record<string, any> = {
  "category obj in_app_feed:false": { categories: { "new-enrollment": { channel_types: { in_app_feed: false } } } },
  "category false": { categories: { "new-enrollment": false } },
  "workflow false": { workflows: { "new-enrollment": false } },
  "channel_type in_app_feed:false": { channel_types: { in_app_feed: false } },
};
const run = Date.now();
const ids: string[] = [];
for (const [label, prefs] of Object.entries(cases)) {
  const id = `spike-matrix-${run}-${ids.length}`; ids.push(id);
  await knock.users.update(id, { name: label });
  await knock.users.setPreferences(id, "default", prefs);
  await knock.workflows.trigger("new-enrollment", { recipients: [id], data: { course_title: "x" } });
}
await new Promise((r) => setTimeout(r, 8000));
let i = 0;
for (const label of Object.keys(cases)) {
  const p: any = await knock.users.listMessages(ids[i++], { page_size: 10 } as any);
  console.log(label.padEnd(34), "→", (p.items ?? []).map((m: any) => m.status).join(",") || "NO MESSAGE (suppressed)");
}
for (const id of ids) await knock.users.delete(id);
