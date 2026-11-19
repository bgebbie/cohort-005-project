// PROTOTYPE — throwaway. Triggers both spike workflows for a throwaway Knock
// user, using the secret key in .env. Exit 0 only if both are found.
import Knock from "@knocklabs/node";
const knock = new Knock();
let ok = true;
for (const wf of ["discussion-reply", "new-enrollment"]) {
  try {
    await knock.workflows.trigger(wf, {
      recipients: [{ id: "spike-workflow-check", name: "Workflow check" }],
      data: {},
    });
    console.log(`  ✓ ${wf}: found and triggered`);
  } catch (e: any) {
    ok = false;
    console.log(`  ✗ ${wf}: ${e.status} ${e.status === 404 ? "not found in this key's environment" : e.message}`);
  }
}
await knock.users.delete("spike-workflow-check").catch(() => {});
process.exit(ok ? 0 : 1);
