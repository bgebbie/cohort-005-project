import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  emptyNotificationFeed,
  type KnockFeedConfig,
  type NotificationFeed,
  type NotificationFeedSnapshot,
} from "~/lib/notification-feed";

const EMPTY_FEED = emptyNotificationFeed();
const LOADING_FEED = emptyNotificationFeed({ loading: true });

const NotificationFeedContext = createContext<NotificationFeed | null>(null);

/**
 * Holds the signed-in person's Notification Feed for everything below it.
 *
 * The DevUI switches user without a page reload, so the feed is keyed on who
 * it belongs to: a new person disposes the old feed and connects a new one,
 * and the old person's Notifications are never shown in between. A fresh
 * token for the same person (the layout re-signs on every navigation) doesn't
 * reconnect; Knock picks it up when the current one nears expiry.
 */
export function NotificationFeedProvider({
  signedIn,
  config,
  children,
}: {
  signedIn: boolean;
  /** Null when Knock isn't configured: the feed is shown empty. */
  config: KnockFeedConfig | null;
  children: React.ReactNode;
}) {
  const feedKey = config
    ? `${config.knockUserId}|${config.publicApiKey}|${config.feedChannelId}`
    : null;

  const latestConfig = useRef(config);
  useEffect(() => {
    latestConfig.current = config;
  });

  const [connected, setConnected] = useState<{
    key: string;
    feed: NotificationFeed;
  } | null>(null);

  useEffect(() => {
    const initial = latestConfig.current;
    if (!feedKey || !initial) return;

    let cancelled = false;
    let feed: NotificationFeed | undefined;
    import("~/lib/knock-feed")
      .then(({ knockNotificationFeed }) => {
        if (cancelled) return;
        feed = knockNotificationFeed(
          initial,
          () => latestConfig.current?.userToken ?? initial.userToken
        );
        setConnected({ key: feedKey, feed });
      })
      .catch((error: unknown) => {
        console.error("[notifications] could not start the feed:", error);
      });

    return () => {
      cancelled = true;
      feed?.dispose();
    };
  }, [feedKey]);

  let feed: NotificationFeed | null = null;
  if (signedIn) {
    if (!feedKey) feed = EMPTY_FEED;
    else if (connected?.key === feedKey) feed = connected.feed;
    else feed = LOADING_FEED;
  }

  return (
    <NotificationFeedContext.Provider value={feed}>
      {children}
    </NotificationFeedContext.Provider>
  );
}

/** The signed-in person's feed and its current state; null when signed out. */
export function useNotificationFeed(): {
  feed: NotificationFeed;
  snapshot: NotificationFeedSnapshot;
} | null {
  const feed = useContext(NotificationFeedContext);
  const source = feed ?? EMPTY_FEED;
  const snapshot = useSyncExternalStore(
    source.subscribe,
    source.getSnapshot,
    source.getSnapshot
  );
  return feed ? { feed, snapshot } : null;
}
