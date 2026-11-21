import { eq } from "drizzle-orm";
import { UserRole, users } from "~/db/schema";
import type { Db } from "~/lib/refunds.server";
import {
  syncUser,
  type NotificationUser,
  type NotificationUserPort,
} from "~/lib/notifications.server";

// ─── Users ───
// Signing up, editing a profile, and keeping users in sync with the
// Notification vendor. Each function that changes what other people see of a
// user (name, email, avatar) syncs them after the write. Role isn't synced.
//
// Every function takes the database first and the NotificationUserPort second.
// Uses positional parameters (project convention).

type User = typeof users.$inferSelect;

/**
 * A user as a Notification carries them (recipient or actor), or undefined
 * when there's no such user. The one place Cadence builds a NotificationUser.
 */
export function getNotificationUser(
  db: Db,
  userId: number
): NotificationUser | undefined {
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get();
}

/** Syncs a user by id, best-effort. False when there's no such user. */
async function syncUserById(
  db: Db,
  notifications: NotificationUserPort,
  userId: number
): Promise<boolean> {
  const user = getNotificationUser(db, userId);
  if (!user) return false;
  return syncUser(notifications, user);
}

export type SignUpResult = { user: User; created: boolean };

/**
 * Creates a Student and syncs them. An email that already has an account
 * just returns that user, so the caller can log them in; nothing is synced.
 */
export async function signUp(
  db: Db,
  notifications: NotificationUserPort,
  name: string,
  email: string
): Promise<SignUpResult> {
  const existing = db.select().from(users).where(eq(users.email, email)).get();
  if (existing) return { user: existing, created: false };

  const user = db
    .insert(users)
    .values({ name, email, role: UserRole.Student, avatarUrl: null })
    .returning()
    .get();
  await syncUserById(db, notifications, user.id);
  return { user, created: true };
}

/**
 * Saves a person's own name and bio from Settings. Syncs them only when the
 * name changed, since the bio isn't shown in anyone's feed. An empty bio is
 * stored as null. Returns undefined when there's no such user.
 */
export async function updateProfile(
  db: Db,
  notifications: NotificationUserPort,
  userId: number,
  name: string,
  bio: string | undefined
): Promise<User | undefined> {
  const before = db.select().from(users).where(eq(users.id, userId)).get();
  if (!before) return undefined;

  const user = db
    .update(users)
    .set({ name, bio: bio || null })
    .where(eq(users.id, userId))
    .returning()
    .get();
  if (user.name !== before.name) {
    await syncUserById(db, notifications, user.id);
  }
  return user;
}

/**
 * A Platform Admin edits a user's name and email, keeping their bio, and the
 * user is synced. Returns undefined when there's no such user.
 */
export async function editUser(
  db: Db,
  notifications: NotificationUserPort,
  userId: number,
  name: string,
  email: string
): Promise<User | undefined> {
  const user = db
    .update(users)
    .set({ name, email })
    .where(eq(users.id, userId))
    .returning()
    .get();
  if (!user) return undefined;
  await syncUserById(db, notifications, user.id);
  return user;
}

/**
 * Syncs every user, one at a time so the vendor's rate limits hold. Used by
 * the seed and the backfill. Safe to run again: anyone who already has
 * preferences keeps them. A failed user is logged and skipped.
 */
export async function syncAllUsers(
  db: Db,
  notifications: NotificationUserPort
): Promise<{ synced: number; failed: number }> {
  let synced = 0;
  let failed = 0;
  for (const { id } of db
    .select({ id: users.id })
    .from(users)
    .orderBy(users.id)
    .all()) {
    if (await syncUserById(db, notifications, id)) synced++;
    else failed++;
  }
  return { synced, failed };
}
