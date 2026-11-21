import type {
  FeedNotification,
  FeedNotificationData,
} from "~/lib/notification-feed";

// ─── Notification rows ───
// Cadence writes each row's text from the data its Notification was triggered
// with, not from Knock's templates. Older messages in a feed may predate a
// field, so every field is read defensively.
//
// Adding a Notification: add a `case` to `notificationRowText`. Anything
// without a case gets a generic row, so the feed never breaks on one.

export type NotificationRowText = {
  title: string;
  /** One line of snippet or context. */
  snippet: string;
};

export function notificationRowText(
  notification: FeedNotification
): NotificationRowText {
  const { data, actor } = notification;
  switch (notification.notification) {
    case "DiscussionReply": {
      const replier = text(data, "replierName") ?? actor?.name ?? "Someone";
      return {
        title: `${replier} replied to your question`,
        snippet:
          quoted(text(data, "snippet")) ?? text(data, "lessonTitle") ?? "",
      };
    }
    case "DiscussionQuestion": {
      const asker = text(data, "askerName") ?? actor?.name ?? "Someone";
      return {
        title: `${asker} asked a question`,
        snippet:
          quoted(text(data, "snippet")) ?? text(data, "lessonTitle") ?? "",
      };
    }
    case "SeatClaimed": {
      const claimer = text(data, "claimerName") ?? actor?.name ?? "Someone";
      const course = text(data, "courseTitle");
      const left = seatsLeftText(data.seatsLeft);
      return {
        title: `${claimer} claimed a Seat`,
        snippet: left
          ? `${left}${course ? ` on ${course}` : ""}`
          : (course ?? ""),
      };
    }
    default:
      return {
        title: actor
          ? `New notification from ${actor.name}`
          : "New notification",
        snippet: "",
      };
  }
}

/**
 * Where clicking a Notification goes: the path in its `link`, or null when it
 * has nowhere to go. Only paths inside Cadence count.
 */
export function notificationLink(
  notification: FeedNotification
): string | null {
  const link = text(notification.data, "link");
  if (!link || !link.startsWith("/") || link.startsWith("//")) return null;
  return link;
}

function text(data: FeedNotificationData, key: string): string | null {
  const value = data[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function quoted(value: string | null): string | null {
  return value === null ? null : `“${value}”`;
}

function seatsLeftText(seatsLeft: FeedNotificationData[string]): string | null {
  if (typeof seatsLeft !== "number") return null;
  if (seatsLeft === 0) return "No Seats left";
  return `${seatsLeft} ${seatsLeft === 1 ? "Seat" : "Seats"} left`;
}
