import { useState } from "react";
import { Bell } from "lucide-react";
import { unseenBadge } from "~/lib/notification-feed";
import { useNotificationFeed } from "~/components/notifications/notification-feed-provider";
import { NotificationPopover } from "~/components/notifications/notification-popover";

/** The bell in the sidebar header, badged with unseen Notifications. */
export function NotificationBell() {
  const notificationFeed = useNotificationFeed();
  const [open, setOpen] = useState(false);
  if (!notificationFeed) return null;

  const badge = unseenBadge(notificationFeed.snapshot.unseenCount);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        title="Notifications"
        aria-label={badge ? `Notifications (${badge} unseen)` : "Notifications"}
        aria-expanded={open}
        className="relative rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <Bell className="size-4" />
        {badge && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {badge}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <NotificationPopover
            feed={notificationFeed.feed}
            snapshot={notificationFeed.snapshot}
            close={() => setOpen(false)}
          />
        </>
      )}
    </>
  );
}
