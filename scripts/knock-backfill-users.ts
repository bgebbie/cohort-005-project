// One-off backfill: syncs every existing user to Knock (name, email, avatar)
// and gives anyone without Notification Preferences the defaults (Enrollments
// off, everything else on). Users who already have preferences keep them, so
// it's safe to run more than once.
//
//   npm run knock:backfill-users
//
// Reads the Knock keys from .env (see app/lib/env.server.ts) and the users
// from data.db. Run it once per Knock environment, after the workflows are
// committed (scripts/knock-workflows-wizard.sh).

import { db } from "../app/db";
import { knockEnv } from "../app/lib/env.server";
import { defaultNotificationPort } from "../app/lib/notifications.server";
import { syncAllUsers } from "../app/lib/users.server";

async function main() {
  if (!knockEnv().secretApiKey) {
    console.error(
      "KNOCK_SECRET_API_KEY isn't set (in .env or the environment), so there's nothing to sync to."
    );
    process.exitCode = 1;
    return;
  }

  const { synced, failed } = await syncAllUsers(db, defaultNotificationPort());
  console.log(`Synced ${synced} users to Knock.`);
  if (failed > 0) {
    console.error(`${failed} users failed; see the errors above. Re-run to retry.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
