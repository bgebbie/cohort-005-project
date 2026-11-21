import type {
  FeedNotification,
  FeedNotificationData,
} from "~/lib/notification-feed";
import type { NotificationName } from "~/lib/notifications.server";

// ─── Notification rows ───
// Cadence writes each row's text from the data its Notification was triggered
// with, not from Knock's templates. Older messages in a feed may predate a
// field, so every field is read defensively.
//
// Adding a Notification: add a `case` to `notificationRowText` and its icon to
// FEED_ICONS. Anything without a case gets a generic row, so the feed never
// breaks on one.

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
    case "RefundRequestConfirmation": {
      const paid = amountForCourse(data);
      return {
        title: "We've received your Refund Request",
        snippet: paid
          ? `${paid} is under review`
          : "A Platform Admin will review it",
      };
    }
    case "OpenRefundRequest": {
      const buyer = text(data, "buyerName") ?? actor?.name ?? "Someone";
      const amount = text(data, "amount");
      return {
        title: amount
          ? `${buyer} requested a ${amount} refund`
          : `${buyer} requested a refund`,
        snippet: joined(text(data, "courseTitle"), quoted(text(data, "reason"))),
      };
    }
    case "RefundRequestApproved":
      return {
        title: "Your Refund Request was approved",
        snippet: joined(
          amountForCourse(data),
          quoted(text(data, "decisionNote"))
        ),
      };
    case "RefundRequestDeclined": {
      const note = quoted(text(data, "decisionNote"));
      return {
        title: "Your Refund Request was declined",
        snippet: note ? `${note} You can ask again.` : "You can ask again.",
      };
    }
    // NewEnrollment (#102) goes here once its catalogue entry lands. Its data
    // is { studentName, courseTitle, link, enrollmentId }; the row reads
    // "{studentName} enrolled in {courseTitle}", with no snippet, and links to
    // the course's Students page. Its feed icon is already in FEED_ICONS.
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
 * The small icon at the bottom-right of a row's avatar. Purely presentational:
 * these four are not the six preference categories.
 */
export type FeedIcon = "Discussion" | "Refund" | "Team" | "Enrollment";

// Every Notification needs an icon (typecheck fails until it has one).
// NewEnrollment (#102) is listed ahead of its catalogue entry landing.
const FEED_ICONS: Record<NotificationName | "NewEnrollment", FeedIcon> = {
  DiscussionReply: "Discussion",
  DiscussionQuestion: "Discussion",
  RefundRequestConfirmation: "Refund",
  OpenRefundRequest: "Refund",
  RefundRequestApproved: "Refund",
  RefundRequestDeclined: "Refund",
  SeatClaimed: "Team",
  NewEnrollment: "Enrollment",
};

/** The feed icon for a Notification, or null for one this build doesn't know. */
export function notificationIcon(
  notification: NotificationName | null
): FeedIcon | null {
  return notification === null ? null : FEED_ICONS[notification];
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

/** "Context: detail", or whichever of the two is there, or "". */
function joined(context: string | null, detail: string | null): string {
  if (context && detail) return `${context}: ${detail}`;
  return context ?? detail ?? "";
}

/** "$79.00 for JavaScript Deep Dive", or whichever half is there. */
function amountForCourse(data: FeedNotificationData): string | null {
  const amount = text(data, "amount");
  const course = text(data, "courseTitle");
  if (amount && course) return `${amount} for ${course}`;
  return amount ?? course;
}

function seatsLeftText(seatsLeft: FeedNotificationData[string]): string | null {
  if (typeof seatsLeft !== "number") return null;
  if (seatsLeft === 0) return "No Seats left";
  return `${seatsLeft} ${seatsLeft === 1 ? "Seat" : "Seats"} left`;
}
