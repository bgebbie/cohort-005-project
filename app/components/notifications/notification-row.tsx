import type {
  FeedNotification,
  NotificationFeed,
} from "~/lib/notification-feed";
import { notificationRowText } from "~/lib/notification-rows";
import { formatRelativeTime } from "~/lib/utils";

/** One Notification: a title, a one-line snippet and how long ago it arrived. */
export function NotificationRow({
  notification,
}: {
  /** For acting on the row (marking it read). */
  feed: NotificationFeed;
  notification: FeedNotification;
  /** Closes the popover, e.g. before going to the Notification's link. */
  close: () => void;
}) {
  const { title, snippet } = notificationRowText(notification);
  const arrived = formatRelativeTime(notification.insertedAt);

  return (
    <li className="px-4 py-2.5 hover:bg-accent">
      <span className="block truncate text-sm">{title}</span>
      <span className="block truncate text-xs text-muted-foreground">
        {snippet ? `${snippet} · ${arrived}` : arrived}
      </span>
    </li>
  );
}
