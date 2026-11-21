import { useEffect } from "react";
import { Bell, Settings } from "lucide-react";
import { Link } from "react-router";
import type {
  NotificationFeed,
  NotificationFeedSnapshot,
} from "~/lib/notification-feed";
import { NotificationList } from "~/components/notifications/notification-list";

/**
 * The popover beside the sidebar that the bell opens. While it's open every
 * Notification is seen, so the badge clears. Nothing becomes read.
 */
export function NotificationPopover({
  feed,
  snapshot,
  close,
}: {
  feed: NotificationFeed;
  snapshot: NotificationFeedSnapshot;
  close: () => void;
}) {
  const { loading, unseenCount, unreadCount } = snapshot;
  useEffect(() => {
    if (!loading && unseenCount > 0) feed.markAllAsSeen();
  }, [feed, loading, unseenCount]);

  return (
    <div
      role="dialog"
      aria-label="Notifications"
      className="fixed left-56 top-2 z-50 ml-2 flex max-h-[calc(100vh-1rem)] w-[26rem] flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl"
    >
      <div className="flex items-center gap-2 bg-muted/60 px-4 py-3">
        <Bell className="size-4" />
        <span className="font-semibold">Notifications</span>
        <button
          type="button"
          onClick={() => feed.markAllAsRead()}
          disabled={unreadCount === 0}
          className="ml-auto text-xs text-primary hover:underline disabled:pointer-events-none disabled:opacity-50"
        >
          Mark all as read
        </button>
        <Link
          to="/settings#notifications"
          onClick={close}
          aria-label="Notification preferences"
          title="Notification preferences"
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Settings className="size-4" />
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto">
        <NotificationList feed={feed} snapshot={snapshot} close={close} />
      </div>
    </div>
  );
}
