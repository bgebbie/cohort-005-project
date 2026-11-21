import type { NotificationName } from "~/lib/notifications.server";

// ─── Notification Feed (client port) ───
// The browser reads a person's Notification Feed straight from the vendor,
// using a token the server signed for them. The feed components only see this
// Cadence-shaped port. Adapters:
// - knockNotificationFeed (knock-feed.ts): the only code that imports the
//   Knock client. The provider (components/notifications/
//   notification-feed-provider.tsx) loads it with a dynamic
//   `import("~/lib/knock-feed")` inside an effect, never statically, so it
//   stays out of the server render and the main bundle.
// - emptyNotificationFeed (below): a signed-in person with no Knock keys
//   configured sees an empty feed and nothing errors.
//
// Row text and click targets live in notification-rows.ts.
//
// Adding a method: add it to NotificationFeed, to knockNotificationFeed, and
// as a no-op to emptyNotificationFeed.

/** Who caused a Notification, as the vendor last saw them. */
export type FeedActor = { name: string; avatarUrl: string | null };

/** Trigger data is flat scalars only (see notifications.server.ts). */
export type FeedNotificationData = Record<
  string,
  string | number | boolean | null
>;

/** One Notification in a person's feed. */
export type FeedNotification = {
  id: string;
  /** Which Notification this is; null for one this Cadence build doesn't know. */
  notification: NotificationName | null;
  /** Null when Cadence itself sent it. */
  actor: FeedActor | null;
  /** The data it was triggered with: a snapshot of when it was sent. */
  data: FeedNotificationData;
  /** ISO timestamps. */
  insertedAt: string;
  seenAt: string | null;
  readAt: string | null;
};

export type NotificationFeedSnapshot = {
  /** Newest first. */
  notifications: FeedNotification[];
  unseenCount: number;
  unreadCount: number;
  /** True until the first page has loaded (or failed to). */
  loading: boolean;
};

export interface NotificationFeed {
  /** The same object until something changes (for useSyncExternalStore). */
  getSnapshot(): NotificationFeedSnapshot;
  /** Calls `listener` after every change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Disconnects for good. The feed never changes or calls a listener again. */
  dispose(): void;
  /**
   * Marks one Notification read, best-effort. Does nothing if it's already
   * read or isn't in the feed. Seen isn't read: opening the popover never
   * marks a row read.
   */
  markRead(notificationId: string): void;
}

/** What the browser needs to read the signed-in person's feed from Knock. */
export type KnockFeedConfig = {
  knockUserId: string;
  /** RS256, signed by the server; its `sub` is `knockUserId`. */
  userToken: string;
  publicApiKey: string;
  feedChannelId: string;
  /** Knock workflow key → the Notification it delivers. */
  workflows: Record<string, NotificationName>;
};

const EMPTY_SNAPSHOT: NotificationFeedSnapshot = {
  notifications: [],
  unseenCount: 0,
  unreadCount: 0,
  loading: false,
};

const LOADING_SNAPSHOT: NotificationFeedSnapshot = {
  ...EMPTY_SNAPSHOT,
  loading: true,
};

/** A feed with nothing in it and no connection. */
export function emptyNotificationFeed(
  { loading }: { loading: boolean } = { loading: false }
): NotificationFeed {
  const snapshot = loading ? LOADING_SNAPSHOT : EMPTY_SNAPSHOT;
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    dispose: () => {},
    markRead: () => {},
  };
}

/** The bell's badge text: hidden at zero, capped at "9+". */
export function unseenBadge(unseenCount: number): string | null {
  if (unseenCount <= 0) return null;
  return unseenCount > 9 ? "9+" : String(unseenCount);
}
