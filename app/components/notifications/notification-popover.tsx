import { Bell } from "lucide-react";
import type {
  NotificationFeed,
  NotificationFeedSnapshot,
} from "~/lib/notification-feed";
import { NotificationList } from "~/components/notifications/notification-list";

/** The popover beside the sidebar that the bell opens. */
export function NotificationPopover({
  feed,
  snapshot,
  close,
}: {
  feed: NotificationFeed;
  snapshot: NotificationFeedSnapshot;
  close: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-label="Notifications"
      className="fixed left-56 top-2 z-50 ml-2 flex max-h-[calc(100vh-1rem)] w-[26rem] flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl"
    >
      <div className="flex items-center gap-2 bg-muted/60 px-4 py-3">
        <Bell className="size-4" />
        <span className="font-semibold">Notifications</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        <NotificationList feed={feed} snapshot={snapshot} close={close} />
      </div>
    </div>
  );
}
