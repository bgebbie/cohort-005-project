import Knock from "@knocklabs/node";
import type {
  NotificationName,
  NotificationPort,
  NotificationUser,
  PreferenceCategory,
} from "~/lib/notifications.server";

// ─── Knock adapter ───
// The only server code that imports the Knock SDK. It maps Cadence's names to
// Knock's keys. Every key here must match the Knock dashboard exactly; the
// workflows are created and committed with scripts/knock-workflows-wizard.sh.

/** Knock categories, one per Notification Preference group. */
export const KNOCK_CATEGORIES = {
  RefundRequestUpdates: "refund-request-updates",
  OpenRefundRequests: "open-refund-requests",
  SeatClaims: "seat-claims",
  Enrollments: "enrollments",
  DiscussionQuestions: "discussion-questions",
  DiscussionReplies: "discussion-replies",
} as const satisfies Record<PreferenceCategory, string>;

/** One Knock workflow per Notification, with the category it carries. */
export const KNOCK_WORKFLOWS: Record<
  NotificationName,
  {
    workflow: string;
    category: (typeof KNOCK_CATEGORIES)[PreferenceCategory];
  }
> = {
  DiscussionReply: {
    workflow: "discussion-reply",
    category: KNOCK_CATEGORIES.DiscussionReplies,
  },
  DiscussionQuestion: {
    workflow: "discussion-question",
    category: KNOCK_CATEGORIES.DiscussionQuestions,
  },
  SeatClaimed: {
    workflow: "seat-claimed",
    category: KNOCK_CATEGORIES.SeatClaims,
  },
};

/** A Cadence user's id in Knock. The signed user token's `sub` uses it too. */
export function knockUserId(cadenceUserId: number): string {
  return String(cadenceUserId);
}

function knockUser(user: NotificationUser) {
  return {
    id: knockUserId(user.id),
    name: user.name,
    email: user.email,
    avatar: user.avatarUrl,
  };
}

export function knockNotificationPort(secretApiKey: string): NotificationPort {
  const knock = new Knock({ apiKey: secretApiKey });
  return {
    async trigger(trigger) {
      await knock.workflows.trigger(
        KNOCK_WORKFLOWS[trigger.notification].workflow,
        {
          recipients: trigger.recipients.map(knockUser),
          actor: trigger.actor ? knockUser(trigger.actor) : null,
          data: trigger.data,
        },
        { idempotencyKey: trigger.idempotencyKey }
      );
    },
  };
}
