import { describe, expect, it } from "vitest";
import type {
  FeedNotification,
  NotificationFeedSnapshot,
} from "./notification-feed";
import { withBulkMarks } from "./notification-feed";

function notification(
  id: string,
  insertedAt: string,
  overrides: Partial<FeedNotification> = {}
): FeedNotification {
  return {
    id,
    notification: "DiscussionReply",
    actor: null,
    data: {},
    insertedAt,
    seenAt: null,
    readAt: null,
    ...overrides,
  };
}

function snapshot(
  notifications: FeedNotification[],
  counts: { unseenCount: number; unreadCount: number }
): NotificationFeedSnapshot {
  return {
    notifications,
    ...counts,
    loading: false,
    hasMore: false,
    loadingMore: false,
  };
}

const MARKED_AT = "2026-11-20T12:05:00.000Z";

// Knock applies a bulk status update asynchronously, so a page fetched just
// after "mark all" can still come back with the old statuses and counts.
describe("a page loaded before Knock has applied mark all seen", () => {
  const firstPage = [
    notification("msg-3", "2026-11-20T12:00:00.000Z"),
    notification("msg-2", "2026-11-19T12:00:00.000Z"),
  ];
  const secondPage = [
    notification("msg-1", "2026-11-01T12:00:00.000Z"),
    notification("msg-0", "2026-10-01T12:00:00.000Z"),
  ];
  const stale = snapshot([...firstPage, ...secondPage], {
    unseenCount: 4,
    unreadCount: 4,
  });
  const marks = {
    seen: { through: "2026-11-20T12:00:00.000Z", at: MARKED_AT },
    read: null,
  };

  it("shows the older Notifications as seen", () => {
    const shown = withBulkMarks(stale, marks);
    expect(shown.notifications.map((n) => n.seenAt)).toEqual([
      MARKED_AT,
      MARKED_AT,
      MARKED_AT,
      MARKED_AT,
    ]);
  });

  it("keeps the badge clear", () => {
    expect(withBulkMarks(stale, marks).unseenCount).toBe(0);
  });

  it("doesn't make anything read", () => {
    const shown = withBulkMarks(stale, marks);
    expect(shown.notifications.map((n) => n.readAt)).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(shown.unreadCount).toBe(4);
  });
});

describe("a Notification that arrives after mark all seen", () => {
  const marks = {
    seen: { through: "2026-11-20T12:00:00.000Z", at: MARKED_AT },
    read: null,
  };
  const arrived = notification("msg-4", "2026-11-20T12:10:00.000Z");
  const marked = notification("msg-3", "2026-11-20T12:00:00.000Z", {
    seenAt: MARKED_AT,
  });

  it("is unseen and counts in the badge", () => {
    const shown = withBulkMarks(
      snapshot([arrived, marked], { unseenCount: 1, unreadCount: 2 }),
      marks
    );
    expect(shown.notifications[0].seenAt).toBeNull();
    expect(shown.unseenCount).toBe(1);
  });

  it("still counts while the older ones come back stale", () => {
    const staleOlder = notification("msg-2", "2026-11-19T12:00:00.000Z");
    const shown = withBulkMarks(
      snapshot([arrived, marked, staleOlder], {
        unseenCount: 2,
        unreadCount: 3,
      }),
      marks
    );
    expect(shown.unseenCount).toBe(1);
  });
});

describe("mark all read", () => {
  const marks = {
    seen: null,
    read: { through: "2026-11-20T12:00:00.000Z", at: MARKED_AT },
  };

  it("covers a stale page loaded afterwards, and read rows stay listed", () => {
    const shown = withBulkMarks(
      snapshot(
        [
          notification("msg-2", "2026-11-20T12:00:00.000Z", {
            readAt: MARKED_AT,
          }),
          notification("msg-1", "2026-11-01T12:00:00.000Z"),
        ],
        { unseenCount: 0, unreadCount: 1 }
      ),
      marks
    );
    expect(shown.notifications.map((n) => [n.id, n.readAt])).toEqual([
      ["msg-2", MARKED_AT],
      ["msg-1", MARKED_AT],
    ]);
    expect(shown.unreadCount).toBe(0);
  });

  it("doesn't make anything seen", () => {
    const shown = withBulkMarks(
      snapshot([notification("msg-1", "2026-11-01T12:00:00.000Z")], {
        unseenCount: 1,
        unreadCount: 1,
      }),
      marks
    );
    expect(shown.notifications[0].seenAt).toBeNull();
    expect(shown.unseenCount).toBe(1);
  });
});

describe("with no mark made", () => {
  it("shows what the vendor returned", () => {
    const vendor = snapshot(
      [notification("msg-1", "2026-11-01T12:00:00.000Z")],
      { unseenCount: 1, unreadCount: 1 }
    );
    expect(withBulkMarks(vendor, { seen: null, read: null })).toBe(vendor);
  });
});
