import Knock, {
  NetworkStatus,
  type FeedItem,
  type FeedStoreState,
  type Recipient,
} from "@knocklabs/client";
import {
  withBulkMarks,
  type BulkMarks,
  type FeedActor,
  type FeedNotification,
  type FeedNotificationData,
  type KnockFeedConfig,
  type NotificationFeed,
  type NotificationFeedSnapshot,
} from "~/lib/notification-feed";

// ─── Knock client adapter (Notification Feed) ───
// The only code that imports the Knock browser client. Import it dynamically,
// from an effect, so the server render never loads it.
//
// One instance serves one person: when the DevUI switches user, dispose this
// one and create another, so nothing of the previous person's feed survives.

// Knock documents a default of 50 and no maximum. The spec asks for about
// 100; 50 is the value Knock is known to accept, so it's the safe choice
// until 100 is checked against Knock Development.
const PAGE_SIZE = 50;

/**
 * Connects to `config`'s person's feed and loads the first page.
 * `latestUserToken` returns the newest token the server has signed for them;
 * Knock asks for it as the current one nears expiry.
 */
export function knockNotificationFeed(
  config: KnockFeedConfig,
  latestUserToken: () => string
): NotificationFeed {
  const knock = new Knock(config.publicApiKey);
  knock.authenticate({ id: config.knockUserId }, config.userToken, {
    // The server owns user sync; the browser never identifies.
    identificationStrategy: "skip",
    onUserTokenExpiring: async () => latestUserToken(),
  });
  const feed = knock.feeds.initialize(config.feedChannelId, {
    page_size: PAGE_SIZE,
    archived: "exclude",
  });

  let disposed = false;
  let loaded = false;
  let lastState: FeedStoreState | undefined;
  let snapshot: NotificationFeedSnapshot | undefined;
  const marks: BulkMarks = { seen: null, read: null };
  const listeners = new Set<() => void>();

  function getSnapshot(): NotificationFeedSnapshot {
    const state = feed.getState();
    if (!snapshot || state !== lastState) {
      lastState = state;
      snapshot = withBulkMarks(toSnapshot(state, config, loaded), marks);
    }
    return snapshot;
  }

  function changed() {
    if (disposed) return;
    snapshot = undefined;
    for (const listener of listeners) listener();
  }

  const unsubscribeStore = feed.store.subscribe(changed);

  /** Records a "mark all" over everything up to the newest loaded row. */
  function markAll(status: "seen" | "read"): void {
    const newest = feed.getState().items[0];
    if (newest) {
      marks[status] = {
        through: newest.inserted_at,
        at: new Date().toISOString(),
      };
    }
    // One bulk-by-channel update on the user token: it covers Notifications
    // that haven't loaded yet, and sends no `message_ids` (an empty list is a
    // 422).
    const update =
      status === "seen" ? feed.markAllAsSeen() : feed.markAllAsRead();
    update.catch((error: unknown) => {
      console.error(`[notifications] could not mark all ${status}:`, error);
    });
    changed();
  }

  feed
    .fetch()
    .then((result) => {
      if (result?.status === "error") {
        console.error("[notifications] could not load the feed:", result.data);
      }
    })
    .catch((error: unknown) => {
      console.error("[notifications] could not load the feed:", error);
    })
    .finally(() => {
      loaded = true;
      changed();
    });

  return {
    getSnapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      unsubscribeStore();
      feed.dispose();
      knock.logout();
    },
    loadMore() {
      if (disposed) return;
      const state = feed.getState();
      if (!state.pageInfo.after || state.networkStatus !== NetworkStatus.ready)
        return;
      feed.fetchNextPage().catch((error: unknown) => {
        console.error("[notifications] could not load more:", error);
      });
    },
    markAllAsSeen() {
      if (!disposed) markAll("seen");
    },
    markAllAsRead() {
      if (!disposed) markAll("read");
    },
  };
}

function toSnapshot(
  state: FeedStoreState,
  config: KnockFeedConfig,
  loaded: boolean
): NotificationFeedSnapshot {
  return {
    notifications: state.items.map((item) => toNotification(item, config)),
    unseenCount: state.metadata.unseen_count,
    unreadCount: state.metadata.unread_count,
    loading: !loaded,
    hasMore: Boolean(state.pageInfo.after),
    loadingMore: state.networkStatus === NetworkStatus.fetchMore,
  };
}

function toNotification(
  item: FeedItem,
  config: KnockFeedConfig
): FeedNotification {
  return {
    id: item.id,
    notification: config.workflows[item.source.key] ?? null,
    actor: toActor(item.actors[0]),
    data: flatScalars(item.data),
    insertedAt: item.inserted_at,
    seenAt: item.seen_at,
    readAt: item.read_at,
  };
}

function toActor(recipient: Recipient | undefined): FeedActor | null {
  if (!recipient || "collection" in recipient) return null;
  return {
    name: recipient.name ?? "Someone",
    avatarUrl: recipient.avatar ?? null,
  };
}

function flatScalars(data: FeedItem["data"]): FeedNotificationData {
  const flat: FeedNotificationData = {};
  for (const [key, value] of Object.entries(data ?? {})) {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      flat[key] = value;
    }
  }
  return flat;
}
