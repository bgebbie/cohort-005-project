import { useEffect, useRef } from "react";
import type {
  NotificationFeed,
  NotificationFeedSnapshot,
} from "~/lib/notification-feed";
import { NotificationRow } from "~/components/notifications/notification-row";

/**
 * One chronological list, newest first. Scrolling to the bottom loads the next
 * older page, until the oldest Notification is reached.
 */
export function NotificationList({
  feed,
  snapshot,
  close,
}: {
  feed: NotificationFeed;
  snapshot: NotificationFeedSnapshot;
  close: () => void;
}) {
  const bottom = useRef<HTMLDivElement>(null);
  const loadedCount = snapshot.notifications.length;
  const { hasMore, loadingMore } = snapshot;

  // Observed afresh after each page: if the bottom is still in view once a
  // page lands, the new observer's first callback asks for the next one.
  useEffect(() => {
    const target = bottom.current;
    if (!target || !hasMore || loadingMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) feed.loadMore();
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [feed, hasMore, loadingMore, loadedCount]);

  if (snapshot.notifications.length === 0) {
    return (
      <p className="p-8 text-center text-sm text-muted-foreground">
        {snapshot.loading ? "Loading…" : "You're all caught up."}
      </p>
    );
  }

  return (
    <>
      <ul>
        {snapshot.notifications.map((notification) => (
          <NotificationRow
            key={notification.id}
            feed={feed}
            notification={notification}
            close={close}
          />
        ))}
      </ul>
      <div
        ref={bottom}
        className="min-h-10 px-4 py-3 text-center text-xs text-muted-foreground"
      >
        {loadingMore ? "Loading…" : hasMore ? null : "That's everything."}
      </div>
    </>
  );
}
