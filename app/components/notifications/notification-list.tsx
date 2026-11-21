import type {
  NotificationFeed,
  NotificationFeedSnapshot,
} from "~/lib/notification-feed";
import { NotificationRow } from "~/components/notifications/notification-row";

/** One chronological list, newest first. */
export function NotificationList({
  feed,
  snapshot,
  close,
}: {
  feed: NotificationFeed;
  snapshot: NotificationFeedSnapshot;
  close: () => void;
}) {
  if (snapshot.notifications.length === 0) {
    return (
      <p className="p-8 text-center text-sm text-muted-foreground">
        {snapshot.loading ? "Loading…" : "You're all caught up."}
      </p>
    );
  }

  return (
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
  );
}
