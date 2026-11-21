import { knockEnv } from "~/lib/env.server";
import { knockNotificationPort } from "~/lib/knock.server";

// ─── Notifications (server port) ───
// Cadence tells a person that something concerning them has happened. See
// GLOSSARY.md. Services take a NotificationPort as a parameter, the way they
// take `db` and `now`, and call `notify` after their write has committed.
//
// Adapters:
// - knockNotificationPort (knock.server.ts): the only code that touches Knock.
// - fakeNotificationPort: records every trigger and archive, for vitest.
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

/** Every Notification Cadence sends, and the data its trigger carries. */
export type NotificationCatalogue = {
  DiscussionReply: DiscussionReplyData;
  DiscussionQuestion: DiscussionQuestionData;
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

export type FakeNotificationPort = NotificationPort & {
  triggers: NotificationTrigger[];
  /** The comment ids whose Notifications were archived. */
  archives: number[];
};

export function fakeNotificationPort(): FakeNotificationPort {
  const triggers: NotificationTrigger[] = [];
  const archives: number[] = [];
  return {
    triggers,
    archives,
    async trigger(trigger) {
      triggers.push(trigger);
    },
    async archiveCommentNotifications(commentId) {
      archives.push(commentId);
    },
  };
}

export function noopNotificationPort(): NotificationPort {
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
  };
}

let defaultPort: NotificationPort | undefined;

/** Knock when KNOCK_SECRET_API_KEY is set, otherwise the no-op adapter. */
export function defaultNotificationPort(): NotificationPort {
  if (!defaultPort) {
    const { secretApiKey } = knockEnv();
    defaultPort = secretApiKey
      ? knockNotificationPort(secretApiKey)
      : noopNotificationPort();
  }
  return defaultPort;
}
