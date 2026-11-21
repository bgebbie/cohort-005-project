import { knockEnv } from "~/lib/env.server";
import { knockNotificationPort } from "~/lib/knock.server";

// ─── Notifications (server port) ───
// Cadence tells a person that something concerning them has happened. See
// GLOSSARY.md. Services take a NotificationPort as a parameter, the way they
// take `db` and `now`, and call `notify` after their write has committed.
//
// Adapters:
// - knockNotificationPort (knock.server.ts): the only code that touches Knock.
// - fakeNotificationPort: records every trigger, archive, sync and preference
//   write, for vitest.
// - noopNotificationPort: logs instead, when KNOCK_SECRET_API_KEY is absent.
//
// Adding a Notification:
// 1. Add its data type and an entry to NotificationCatalogue below.
// 2. Add its Knock workflow to KNOCK_WORKFLOWS in knock.server.ts (typecheck
//    fails until you do).
// 3. Add a block for its workflow to scripts/knock-workflows-wizard.sh.
// 4. Call `notify` from the service that owns the event.

/** A person, passed inline so Knock needs no earlier user sync. */
export type NotificationUser = {
  id: number;
  name: string;
  email: string;
  avatarUrl: string | null;
};

/** The six groups a person can turn off as Notification Preferences. */
export type PreferenceCategory =
  | "RefundRequestUpdates"
  | "OpenRefundRequests"
  | "SeatClaims"
  | "Enrollments"
  | "DiscussionQuestions"
  | "DiscussionReplies";

// Trigger data is flat scalars only, so Knock can filter messages by it (used
// to archive the Notifications a deleted comment caused).

/** A Discussion Reply from someone other than the question's author. */
export type DiscussionReplyData = {
  replierName: string;
  lessonTitle: string;
  courseTitle: string;
  snippet: string;
  /** The lesson URL with the reply's anchor. */
  link: string;
  commentId: number;
};

/**
 * Cadence telling a buyer their Refund Request was raised and is under review.
 * It has no actor and nowhere to go, so `link` is null.
 */
export type RefundRequestConfirmationData = {
  refundRequestId: number;
  courseTitle: string;
  /** The amount paid, formatted, e.g. "$79.00". */
  amount: string;
  link: null;
};

/** A new Open Refund Request, for every Platform Admin to decide. */
export type OpenRefundRequestData = {
  refundRequestId: number;
  buyerName: string;
  courseTitle: string;
  amount: string;
  reason: string;
  /** The Refund Request review page. */
  link: string;
};

/** A Platform Admin approved the buyer's Refund Request. */
export type RefundRequestApprovedData = {
  refundRequestId: number;
  courseTitle: string;
  amount: string;
  purchaseKind: "individual_purchase" | "team_licence";
  decisionNote: string | null;
  /** Settings for an Individual Purchase, the team page for a Team Licence. */
  link: string;
};

/**
 * A Platform Admin declined the buyer's Refund Request. The note is required,
 * and the buyer may raise a new Refund Request.
 */
export type RefundRequestDeclinedData = {
  refundRequestId: number;
  courseTitle: string;
  amount: string;
  purchaseKind: "individual_purchase" | "team_licence";
  decisionNote: string;
  /** Settings for an Individual Purchase, the team page for a Team Licence. */
  link: string;
};

/** A Discussion Question on a course → the course's Instructor. */
export type DiscussionQuestionData = {
  askerName: string;
  lessonTitle: string;
  courseTitle: string;
  snippet: string;
  /** The lesson URL with the question's anchor. */
  link: string;
  commentId: number;
};

/** A Seat on a Team Licence was claimed → the Team Licence's buyer. */
export type SeatClaimedData = {
  claimerName: string;
  courseTitle: string;
  /** Unclaimed Seats still available on the Team Licence after this claim. */
  seatsLeft: number;
  /** The team page. */
  link: string;
  seatId: number;
};

/** Every Notification Cadence sends, and the data its trigger carries. */
export type NotificationCatalogue = {
  DiscussionReply: DiscussionReplyData;
  RefundRequestConfirmation: RefundRequestConfirmationData;
  OpenRefundRequest: OpenRefundRequestData;
  RefundRequestApproved: RefundRequestApprovedData;
  RefundRequestDeclined: RefundRequestDeclinedData;
  DiscussionQuestion: DiscussionQuestionData;
  SeatClaimed: SeatClaimedData;
};

export type NotificationName = keyof NotificationCatalogue;

export type NotificationTrigger = {
  [N in NotificationName]: {
    notification: N;
    recipients: NotificationUser[];
    /** Who caused it; null when Cadence itself is the sender. */
    actor: NotificationUser | null;
    data: NotificationCatalogue[N];
    /** One per domain event, e.g. `discussion-reply:<commentId>`. */
    idempotencyKey: string;
  };
}[NotificationName];

export interface NotificationPort {
  trigger(trigger: NotificationTrigger): Promise<void>;
  /**
   * Archives the Notifications a comment caused, found by the `commentId` in
   * their trigger data, so they leave the recipient's Notification Feed.
   */
  archiveCommentNotifications(commentId: number): Promise<void>;
}

/**
 * Sends a Notification best-effort: a failure is logged and never thrown, so
 * it can't fail the domain action that caused it.
 */
export async function notify(
  port: NotificationPort,
  trigger: NotificationTrigger
): Promise<void> {
  try {
    await port.trigger(trigger);
  } catch (error) {
    console.error(
      `[notifications] ${trigger.notification} (${trigger.idempotencyKey}) failed:`,
      error
    );
  }
}

/**
 * Archives the Notifications a deleted comment caused, best-effort: a failure
 * is logged and never thrown, so it can't fail the delete.
 */
export async function archiveCommentNotifications(
  port: NotificationPort,
  commentId: number
): Promise<void> {
  try {
    await port.archiveCommentNotifications(commentId);
  } catch (error) {
    console.error(
      `[notifications] archiving comment ${commentId}'s Notifications failed:`,
      error
    );
  }
}

// ─── User sync and Notification Preferences ───
// Cadence keeps its users in sync with the vendor (name, email, avatar, so a
// sender shows correctly in other people's feeds) and owns everyone's
// Notification Preferences. Role is never synced.
//
// Preferences are stored per category × channel. v1 has only the `feed`
// channel; a later email channel is one more key, with no migration.

/** Where a Notification is delivered. */
export type NotificationChannel = "feed";

/** A person's full preference set: is each category on, per channel? */
export type NotificationPreferences = Record<
  PreferenceCategory,
  Record<NotificationChannel, boolean>
>;

/** A preference set as stored, which may lack categories or channels. */
export type StoredNotificationPreferences = {
  [C in PreferenceCategory]?: { [Ch in NotificationChannel]?: boolean };
};

/** Enrollments start off (an Instructor opts in); everything else starts on. */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  RefundRequestUpdates: { feed: true },
  OpenRefundRequests: { feed: true },
  SeatClaims: { feed: true },
  Enrollments: { feed: false },
  DiscussionQuestions: { feed: true },
  DiscussionReplies: { feed: true },
};

/**
 * The user side of the server notification port. Kept apart from
 * NotificationPort so a service that only triggers needs only `trigger`.
 */
export interface NotificationUserPort {
  /** Creates or updates the user (name, email, avatar). */
  identify(user: NotificationUser): Promise<void>;
  /** The user's stored preferences, or null when they have none yet. */
  readPreferences(userId: number): Promise<StoredNotificationPreferences | null>;
  /** Replaces the user's whole preference set. Merge before calling. */
  writePreferences(
    userId: number,
    preferences: NotificationPreferences
  ): Promise<void>;
}

/** Every adapter implements both halves of the server port. */
export type ServerNotificationPort = NotificationPort & NotificationUserPort;

/**
 * Syncs a user best-effort: identifies them, then writes the default
 * preferences only if they have none yet, so a sync never undoes a choice
 * they made. A failure is logged and never thrown, so it can't fail signup or
 * a profile edit. Returns whether the sync succeeded.
 */
export async function syncUser(
  port: NotificationUserPort,
  user: NotificationUser
): Promise<boolean> {
  try {
    await port.identify(user);
    const existing = await port.readPreferences(user.id);
    if (existing === null) {
      await port.writePreferences(user.id, DEFAULT_NOTIFICATION_PREFERENCES);
    }
    return true;
  } catch (error) {
    console.error(`[notifications] syncing user ${user.id} failed:`, error);
    return false;
  }
}

/** Fills anything a stored set lacks with the default. */
function withDefaults(
  stored: StoredNotificationPreferences | null
): NotificationPreferences {
  const preferences = structuredClone(DEFAULT_NOTIFICATION_PREFERENCES);
  for (const category of Object.keys(preferences) as PreferenceCategory[]) {
    const channels = preferences[category];
    for (const channel of Object.keys(channels) as NotificationChannel[]) {
      channels[channel] = stored?.[category]?.[channel] ?? channels[channel];
    }
  }
  return preferences;
}

/**
 * A user's Notification Preferences, with the default for any category they
 * haven't chosen. Throws if the port fails.
 */
export async function getNotificationPreferences(
  port: NotificationUserPort,
  userId: number
): Promise<NotificationPreferences> {
  return withDefaults(await port.readPreferences(userId));
}

/**
 * Turns one category on or off for one channel. The port replaces the whole
 * set, so this reads the current set, changes one value and writes it all
 * back, leaving every other choice alone. Throws if the port fails, so the
 * caller can tell the person their choice didn't stick. Returns the saved set.
 */
export async function setNotificationPreference(
  port: NotificationUserPort,
  userId: number,
  category: PreferenceCategory,
  channel: NotificationChannel,
  enabled: boolean
): Promise<NotificationPreferences> {
  const preferences = await getNotificationPreferences(port, userId);
  preferences[category][channel] = enabled;
  await port.writePreferences(userId, preferences);
  return preferences;
}

export type FakeNotificationPort = ServerNotificationPort & {
  triggers: NotificationTrigger[];
  /** Every identify, in order. */
  identified: NotificationUser[];
  /** Every preference write, in order. */
  preferenceWrites: { userId: number; preferences: NotificationPreferences }[];
  /** The stored preference sets. Seed it to give a user existing choices. */
  preferences: Map<number, StoredNotificationPreferences>;
  /** The comment ids whose Notifications were archived. */
  archives: number[];
};

export function fakeNotificationPort(): FakeNotificationPort {
  const triggers: NotificationTrigger[] = [];
  const archives: number[] = [];
  const identified: NotificationUser[] = [];
  const preferenceWrites: FakeNotificationPort["preferenceWrites"] = [];
  const preferences = new Map<number, StoredNotificationPreferences>();
  return {
    triggers,
    identified,
    preferenceWrites,
    preferences,
    archives,
    async trigger(trigger) {
      triggers.push(trigger);
    },
    async archiveCommentNotifications(commentId) {
      archives.push(commentId);
    },
    async identify(user) {
      identified.push(user);
    },
    async readPreferences(userId) {
      const stored = preferences.get(userId);
      return stored ? structuredClone(stored) : null;
    },
    async writePreferences(userId, set) {
      preferenceWrites.push({ userId, preferences: structuredClone(set) });
      preferences.set(userId, structuredClone(set));
    },
  };
}

/** Stateless: reads always find no preferences, so callers see the defaults. */
export function noopNotificationPort(): ServerNotificationPort {
  return {
    async trigger(trigger) {
      console.info(
        `[notifications] no KNOCK_SECRET_API_KEY; would send ${trigger.notification} to`,
        trigger.recipients.map((r) => r.id),
        trigger.data
      );
    },
    async archiveCommentNotifications(commentId) {
      console.info(
        `[notifications] no KNOCK_SECRET_API_KEY; would archive comment ${commentId}'s Notifications`
      );
    },
    async identify(user) {
      console.info(
        `[notifications] no KNOCK_SECRET_API_KEY; would sync user ${user.id}`
      );
    },
    async readPreferences() {
      return null;
    },
    async writePreferences(userId, preferences) {
      console.info(
        `[notifications] no KNOCK_SECRET_API_KEY; would write preferences for user ${userId}:`,
        JSON.stringify(preferences)
      );
    },
  };
}

let defaultPort: ServerNotificationPort | undefined;

/** Knock when KNOCK_SECRET_API_KEY is set, otherwise the no-op adapter. */
export function defaultNotificationPort(): ServerNotificationPort {
  if (!defaultPort) {
    const { secretApiKey } = knockEnv();
    defaultPort = secretApiKey
      ? knockNotificationPort(secretApiKey)
      : noopNotificationPort();
  }
  return defaultPort;
}
