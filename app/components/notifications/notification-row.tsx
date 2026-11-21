import { useNavigate } from "react-router";
import {
  Check,
  GraduationCap,
  MessageSquare,
  Receipt,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type {
  FeedNotification,
  NotificationFeed,
} from "~/lib/notification-feed";
import {
  notificationIcon,
  notificationLink,
  notificationRowText,
  type FeedIcon,
} from "~/lib/notification-rows";
import { UserAvatar } from "~/components/user-avatar";
import { cn, formatRelativeTime } from "~/lib/utils";

const ICONS: Record<FeedIcon, LucideIcon> = {
  Discussion: MessageSquare,
  Refund: Receipt,
  Team: UsersRound,
  Enrollment: GraduationCap,
};

/**
 * One Notification: who sent it, a title, a one-line snippet and how long ago
 * it arrived. Unread rows have a bold title and a ✓ that marks them read;
 * read rows have a faded avatar. Clicking a row marks it read and goes to its
 * link; with no link it only marks it read and the popover stays open.
 */
export function NotificationRow({
  feed,
  notification,
  close,
}: {
  /** For acting on the row (marking it read). */
  feed: NotificationFeed;
  notification: FeedNotification;
  /** Closes the popover, e.g. before going to the Notification's link. */
  close: () => void;
}) {
  const navigate = useNavigate();
  const { title, snippet } = notificationRowText(notification);
  const arrived = formatRelativeTime(notification.insertedAt);
  const unread = notification.readAt === null;

  function open() {
    if (unread) feed.markRead(notification.id);
    const link = notificationLink(notification);
    if (link === null) return;
    close();
    navigate(link);
  }

  return (
    <li className="flex items-center gap-1 pr-2 hover:bg-accent">
      <button
        type="button"
        onClick={open}
        className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 text-left"
      >
        <NotificationAvatar notification={notification} faded={!unread} />
        <span className="min-w-0 flex-1">
          <span
            className={cn("block truncate text-sm", unread && "font-semibold")}
          >
            {title}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {snippet ? `${snippet} · ${arrived}` : arrived}
          </span>
        </span>
      </button>
      {unread && (
        <button
          type="button"
          onClick={() => feed.markRead(notification.id)}
          title="Mark as read"
          aria-label="Mark as read"
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-background hover:text-foreground"
        >
          <Check className="size-4" />
        </button>
      )}
    </li>
  );
}

/**
 * The sender's avatar, or Cadence's "C" when Cadence itself sent it, with the
 * Notification's feed icon at its bottom-right corner.
 */
function NotificationAvatar({
  notification,
  faded,
}: {
  notification: FeedNotification;
  faded: boolean;
}) {
  const icon = notificationIcon(notification.notification);
  const Icon = icon ? ICONS[icon] : null;

  return (
    <span className={cn("relative shrink-0", faded && "opacity-60")}>
      {notification.actor ? (
        <UserAvatar
          name={notification.actor.name}
          avatarUrl={notification.actor.avatarUrl}
          className="size-9"
        />
      ) : (
        <span
          aria-label="Cadence"
          className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground"
        >
          C
        </span>
      )}
      {Icon && (
        <span className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-popover ring-1 ring-border">
          <Icon className="size-2.5" />
        </span>
      )}
    </span>
  );
}
