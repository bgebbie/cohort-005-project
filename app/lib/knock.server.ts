import Knock, { NotFoundError } from "@knocklabs/node";
import type { PreferenceSet } from "@knocklabs/node/resources/recipients/preferences";
import type {
  NotificationChannel,
  NotificationName,
  NotificationPreferences,
  NotificationUser,
  PreferenceCategory,
  ServerNotificationPort,
  StoredNotificationPreferences,
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

/** Knock channel types, one per Cadence channel. */
const KNOCK_CHANNEL_TYPES = {
  feed: "in_app_feed",
} as const satisfies Record<NotificationChannel, string>;

/** Cadence keeps each user's preferences in their Knock "default" set. */
const PREFERENCE_SET = "default";

type KnockCategorySetting = NonNullable<PreferenceSet["categories"]>[string];

/** Maps a Knock category setting (a boolean, or per channel type) to Cadence's. */
function cadenceChannels(
  setting: KnockCategorySetting
): StoredNotificationPreferences[PreferenceCategory] {
  const channels: { [Ch in NotificationChannel]?: boolean } = {};
  for (const channel of Object.keys(
    KNOCK_CHANNEL_TYPES
  ) as NotificationChannel[]) {
    const value =
      typeof setting === "boolean"
        ? setting
        : setting.channel_types?.[KNOCK_CHANNEL_TYPES[channel]];
    if (typeof value === "boolean") channels[channel] = value;
  }
  return channels;
}

/**
 * Knock's preference set in Cadence's language. Knock categories Cadence
 * doesn't know are ignored; a set with none of Cadence's counts as no set.
 */
function cadencePreferences(
  set: PreferenceSet
): StoredNotificationPreferences | null {
  const preferences: StoredNotificationPreferences = {};
  let found = false;
  for (const category of Object.keys(
    KNOCK_CATEGORIES
  ) as PreferenceCategory[]) {
    const setting = set.categories?.[KNOCK_CATEGORIES[category]];
    if (setting === undefined) continue;
    preferences[category] = cadenceChannels(setting);
    found = true;
  }
  return found ? preferences : null;
}

function knockCategories(preferences: NotificationPreferences) {
  const categories: Record<
    string,
    { channel_types: Record<string, boolean> }
  > = {};
  for (const category of Object.keys(
    KNOCK_CATEGORIES
  ) as PreferenceCategory[]) {
    const channelTypes: Record<string, boolean> = {};
    for (const channel of Object.keys(
      KNOCK_CHANNEL_TYPES
    ) as NotificationChannel[]) {
      channelTypes[KNOCK_CHANNEL_TYPES[channel]] =
        preferences[category][channel];
    }
    categories[KNOCK_CATEGORIES[category]] = { channel_types: channelTypes };
  }
  return categories;
}

export function knockNotificationPort(
  secretApiKey: string
): ServerNotificationPort {
  const knock = new Knock({ apiKey: secretApiKey });
  return {
    async identify(user) {
      const { id, ...properties } = knockUser(user);
      await knock.users.update(id, properties);
    },
    async readPreferences(userId) {
      try {
        const set = await knock.users.getPreferences(
          knockUserId(userId),
          PREFERENCE_SET
        );
        return cadencePreferences(set);
      } catch (error) {
        // Knock doesn't know the user yet, so they have no preferences.
        if (error instanceof NotFoundError) return null;
        throw error;
      }
    },
    async writePreferences(userId, preferences) {
      // Replaces the whole set: callers merge first.
      await knock.users.setPreferences(knockUserId(userId), PREFERENCE_SET, {
        categories: knockCategories(preferences),
      });
    },
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
