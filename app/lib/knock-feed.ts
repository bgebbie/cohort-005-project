import Knock, {
  type FeedItem,
  type FeedStoreState,
  type Recipient,
} from "@knocklabs/client";
import type {
  FeedActor,
  FeedNotification,
  FeedNotificationData,
  KnockFeedConfig,
  NotificationFeed,
  NotificationFeedSnapshot,
} from "~/lib/notification-feed";

// ─── Knock client adapter (Notification Feed) ───
// The only code that imports the Knock browser client. Import it dynamically,
// from an effect, so the server render never loads it.
//
// One instance serves one person: when the DevUI switches user, dispose this
// one and create another, so nothing of the previous person's feed survives.

const PAGE_SIZE = 100;

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
  const listeners = new Set<() => void>();

  function getSnapshot(): NotificationFeedSnapshot {
    const state = feed.getState();
    if (!snapshot || state !== lastState) {
      lastState = state;
      snapshot = toSnapshot(state, config, loaded);
    }
    return snapshot;
  }

  function changed() {
    if (disposed) return;
    snapshot = undefined;
    for (const listener of listeners) listener();
  }

  const unsubscribeStore = feed.store.subscribe(changed);

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
    markRead(notificationId) {
      if (disposed) return;
      // One item that exists and is unread, never an empty list: Knock's
      // batch status update returns 422 on an empty `message_ids`. Knock
      // updates the store (and so the row and counts) before the request.
      const item = feed
        .getState()
        .items.find((candidate) => candidate.id === notificationId);
      if (!item || item.read_at) return;
      feed.markAsRead(item).catch((error: unknown) => {
        console.error("[notifications] could not mark read:", error);
      });
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
