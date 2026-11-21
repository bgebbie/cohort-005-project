import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import { coupons, courses, purchases, UserRole, users } from "~/db/schema";
import {
  getNotificationPreferences,
  setNotificationPreference,
  type NotificationUserPort,
  type PreferenceCategory,
} from "~/lib/notifications.server";

// ─── Notification Preferences on Settings ───
// Which switches a person sees on the Notifications card, and saving one.
// Visibility depends on what the person is or has, not on their role alone:
// any role can make a Purchase or buy a Team Licence. A switch that isn't
// shown keeps its default, so it can appear later with nothing written.
//
// Takes the database first and the NotificationUserPort second (project
// convention).

export type Db = BetterSQLite3Database<typeof schema>;

export type NotificationSwitch = {
  category: PreferenceCategory;
  enabled: boolean;
};

function hasPurchase(db: Db, userId: number): boolean {
  return (
    db
      .select({ id: purchases.id })
      .from(purchases)
      .where(eq(purchases.userId, userId))
      .get() !== undefined
  );
}

/** Bought at least one Team Licence (a Purchase that has Seats). */
function isTeamAdmin(db: Db, userId: number): boolean {
  return (
    db
      .select({ id: coupons.id })
      .from(coupons)
      .innerJoin(purchases, eq(coupons.purchaseId, purchases.id))
      .where(eq(purchases.userId, userId))
      .get() !== undefined
  );
}

/**
 * An Instructor by role, or anyone who owns a course (a Platform Admin can),
 * since Enrollment and Discussion Question Notifications go to the owner.
 */
function isInstructor(db: Db, userId: number, role: UserRole): boolean {
  if (role === UserRole.Instructor) return true;
  return (
    db
      .select({ id: courses.id })
      .from(courses)
      .where(eq(courses.instructorId, userId))
      .get() !== undefined
  );
}

/** The categories whose switches this person sees, in the card's order. */
function visibleCategories(db: Db, userId: number): PreferenceCategory[] {
  const user = db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!user) return [];

  const categories: PreferenceCategory[] = [];
  if (hasPurchase(db, userId)) categories.push("RefundRequestUpdates");
  if (user.role === UserRole.Admin) categories.push("OpenRefundRequests");
  if (isTeamAdmin(db, userId)) categories.push("SeatClaims");
  if (isInstructor(db, userId, user.role)) {
    categories.push("Enrollments", "DiscussionQuestions");
  }
  categories.push("DiscussionReplies");
  return categories;
}

/**
 * The switches this person sees, each showing their current choice or the
 * default. Throws if the preferences can't be read.
 */
export async function listNotificationSwitches(
  db: Db,
  notifications: NotificationUserPort,
  userId: number
): Promise<NotificationSwitch[]> {
  const preferences = await getNotificationPreferences(notifications, userId);
  return visibleCategories(db, userId).map((category) => ({
    category,
    enabled: preferences[category].feed,
  }));
}

export type SaveNotificationPreferenceResult =
  | { ok: true; enabled: boolean }
  | { ok: false; status: 403; error: string };

/**
 * Turns one category's feed on or off from its switch. The saved set is read,
 * changed in one place and written back whole, so every other choice stays.
 * Refuses a category whose switch the person doesn't see, so a hidden switch
 * keeps its default. Throws if the port fails.
 *
 * Two saves for the same person can race (each reads, then writes the whole
 * set). The Settings page sends one save at a time to avoid that.
 */
export async function saveNotificationPreference(
  db: Db,
  notifications: NotificationUserPort,
  userId: number,
  category: PreferenceCategory,
  enabled: boolean
): Promise<SaveNotificationPreferenceResult> {
  if (!visibleCategories(db, userId).includes(category)) {
    return {
      ok: false,
      status: 403,
      error: "You can't change that Notification Preference.",
    };
  }
  const saved = await setNotificationPreference(
    notifications,
    userId,
    category,
    "feed",
    enabled
  );
  return { ok: true, enabled: saved[category].feed };
}
