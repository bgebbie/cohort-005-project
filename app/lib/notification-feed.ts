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
  /** Older Notifications exist beyond the loaded ones. */
  hasMore: boolean;
  /** An older page is on its way. */
  loadingMore: boolean;
};

export interface NotificationFeed {
  /** The same object until something changes (for useSyncExternalStore). */
  getSnapshot(): NotificationFeedSnapshot;
  /** Calls `listener` after every change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Disconnects for good. The feed never changes or calls a listener again. */
  dispose(): void;
  /** Loads the next older page, if there is one and none is on its way. */
  loadMore(): void;
  /** Marks every Notification seen, loaded or not. Doesn't touch read. */
  markAllAsSeen(): void;
  /** Marks every Notification read, loaded or not. */
  markAllAsRead(): void;
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
  hasMore: false,
  loadingMore: false,
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
    loadMore: () => {},
    markAllAsSeen: () => {},
    markAllAsRead: () => {},
  };
}

/** The bell's badge text: hidden at zero, capped at "9+". */
export function unseenBadge(unseenCount: number): string | null {
  if (unseenCount <= 0) return null;
  return unseenCount > 9 ? "9+" : String(unseenCount);
}

/**
 * A "mark all" made at `at`, covering every Notification up to `through`:
 * the newest one loaded at the time.
 */
export type BulkMark = { through: string; at: string };

export type BulkMarks = { seen: BulkMark | null; read: BulkMark | null };

/**
 * Applies the person's last "mark all seen" and "mark all read" over what the
 * vendor returned. Knock applies a bulk status update asynchronously, so a
 * page fetched straight after one (scrolling down, say) can still carry the
 * old statuses and counts. Everything newer than a mark is always loaded (the
 * list is newest first), so the loaded rows bound the counts.
 */
export function withBulkMarks(
  snapshot: NotificationFeedSnapshot,
  marks: BulkMarks
): NotificationFeedSnapshot {
  const { seen, read } = marks;
  if (!seen && !read) return snapshot;

  const notifications = snapshot.notifications.map((notification) => {
    const seenAt =
      notification.seenAt ?? (covers(seen, notification) ? seen.at : null);
    const readAt =
      notification.readAt ?? (covers(read, notification) ? read.at : null);
    return seenAt === notification.seenAt && readAt === notification.readAt
      ? notification
      : { ...notification, seenAt, readAt };
  });

  return {
    ...snapshot,
    notifications,
    unseenCount: seen
      ? Math.min(
          snapshot.unseenCount,
          notifications.filter((n) => n.seenAt === null).length
        )
      : snapshot.unseenCount,
    unreadCount: read
      ? Math.min(
          snapshot.unreadCount,
          notifications.filter((n) => n.readAt === null).length
        )
      : snapshot.unreadCount,
  };
}

function covers(
  mark: BulkMark | null,
  notification: FeedNotification
): mark is BulkMark {
  return (
    mark !== null &&
    Date.parse(notification.insertedAt) <= Date.parse(mark.through)
  );
}
