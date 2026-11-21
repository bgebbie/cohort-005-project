import { describe, expect, it, vi } from "vitest";
import {
  fakeNotificationPort,
  getNotificationPreferences,
  noopNotificationPort,
  notify,
  setNotificationPreference,
  syncUser,
} from "./notifications.server";

describe("noopNotificationPort", () => {
  it("logs the Notification it would have sent instead of sending it", async () => {
    const logged = vi.spyOn(console, "info").mockImplementation(() => {});

    await notify(noopNotificationPort(), {
      notification: "DiscussionReply",
      recipients: [
        { id: 7, name: "Ada", email: "ada@example.com", avatarUrl: null },
      ],
      actor: null,
      data: {
        replierName: "Priya",
        lessonTitle: "Closures",
        courseTitle: "Test Course",
        snippet: "Here's an answer.",
        link: "/courses/test-course/lessons/1#comment-2",
        commentId: 2,
      },
      idempotencyKey: "discussion-reply:2",
    });

    expect(logged).toHaveBeenCalledOnce();
    expect(String(logged.mock.calls[0][0])).toContain("DiscussionReply");
    logged.mockRestore();
  });
});

const ADA = { id: 7, name: "Ada", email: "ada@example.com", avatarUrl: null };

describe("syncUser", () => {
  it("identifies the user and gives someone with no preferences Enrollments off and everything else on, on the feed", async () => {
    const port = fakeNotificationPort();

    await syncUser(port, ADA);

    expect(port.identified).toEqual([ADA]);
    expect(port.preferences.get(ADA.id)).toEqual({
      RefundRequestUpdates: { feed: true },
      OpenRefundRequests: { feed: true },
      SeatClaims: { feed: true },
      Enrollments: { feed: false },
      DiscussionQuestions: { feed: true },
      DiscussionReplies: { feed: true },
    });
  });

  it("leaves the preferences of someone who already has some unchanged", async () => {
    const port = fakeNotificationPort();
    const chosen = {
      Enrollments: { feed: true },
      DiscussionReplies: { feed: false },
    };
    port.preferences.set(ADA.id, chosen);

    await syncUser(port, ADA);
    await syncUser(port, ADA);

    expect(port.identified).toEqual([ADA, ADA]);
    expect(port.preferenceWrites).toEqual([]);
    expect(port.preferences.get(ADA.id)).toEqual({
      Enrollments: { feed: true },
      DiscussionReplies: { feed: false },
    });
  });

  it("writes no defaults when the preferences can't be read, so an opt-in is never overwritten", async () => {
    const port = fakeNotificationPort();
    port.readPreferences = async () => {
      throw new Error("Knock is down");
    };
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const synced = await syncUser(port, ADA);

    expect(synced).toBe(false);
    expect(port.preferenceWrites).toEqual([]);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it("logs a failing port instead of throwing", async () => {
    const port = fakeNotificationPort();
    port.identify = async () => {
      throw new Error("Knock is down");
    };
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(syncUser(port, ADA)).resolves.toBe(false);

    expect(String(logged.mock.calls[0][0])).toContain("user 7");
    logged.mockRestore();
  });
});

describe("getNotificationPreferences", () => {
  it("gives the defaults to someone with no preferences", async () => {
    const port = fakeNotificationPort();

    expect(await getNotificationPreferences(port, ADA.id)).toEqual({
      RefundRequestUpdates: { feed: true },
      OpenRefundRequests: { feed: true },
      SeatClaims: { feed: true },
      Enrollments: { feed: false },
      DiscussionQuestions: { feed: true },
      DiscussionReplies: { feed: true },
    });
  });

  it("shows stored choices, falling back to the default for anything missing", async () => {
    const port = fakeNotificationPort();
    port.preferences.set(ADA.id, {
      Enrollments: { feed: true },
      SeatClaims: { feed: false },
    });

    expect(await getNotificationPreferences(port, ADA.id)).toEqual({
      RefundRequestUpdates: { feed: true },
      OpenRefundRequests: { feed: true },
      SeatClaims: { feed: false },
      Enrollments: { feed: true },
      DiscussionQuestions: { feed: true },
      DiscussionReplies: { feed: true },
    });
  });
});

describe("setNotificationPreference", () => {
  it("changes one category and leaves every other choice alone", async () => {
    const port = fakeNotificationPort();
    port.preferences.set(ADA.id, {
      RefundRequestUpdates: { feed: false },
      OpenRefundRequests: { feed: true },
      SeatClaims: { feed: false },
      Enrollments: { feed: false },
      DiscussionQuestions: { feed: true },
      DiscussionReplies: { feed: false },
    });

    await setNotificationPreference(port, ADA.id, "Enrollments", "feed", true);

    expect(port.preferences.get(ADA.id)).toEqual({
      RefundRequestUpdates: { feed: false },
      OpenRefundRequests: { feed: true },
      SeatClaims: { feed: false },
      Enrollments: { feed: true },
      DiscussionQuestions: { feed: true },
      DiscussionReplies: { feed: false },
    });
  });

  it("writes the defaults alongside the change for someone with no preferences", async () => {
    const port = fakeNotificationPort();

    await setNotificationPreference(
      port,
      ADA.id,
      "DiscussionReplies",
      "feed",
      false
    );

    expect(port.preferences.get(ADA.id)).toEqual({
      RefundRequestUpdates: { feed: true },
      OpenRefundRequests: { feed: true },
      SeatClaims: { feed: true },
      Enrollments: { feed: false },
      DiscussionQuestions: { feed: true },
      DiscussionReplies: { feed: false },
    });
  });

  it("throws when the save fails, so the caller can tell the person", async () => {
    const port = fakeNotificationPort();
    port.writePreferences = async () => {
      throw new Error("Knock is down");
    };

    await expect(
      setNotificationPreference(port, ADA.id, "Enrollments", "feed", true)
    ).rejects.toThrow("Knock is down");
  });
});
