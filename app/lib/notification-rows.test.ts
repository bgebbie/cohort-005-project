import { describe, expect, it } from "vitest";
import type { FeedNotification } from "./notification-feed";
import { unseenBadge } from "./notification-feed";
import { notificationLink, notificationRowText } from "./notification-rows";

function feedNotification(
  overrides: Partial<FeedNotification> = {}
): FeedNotification {
  return {
    id: "msg-1",
    notification: null,
    actor: null,
    data: {},
    insertedAt: "2026-11-20T12:00:00Z",
    seenAt: null,
    readAt: null,
    ...overrides,
  };
}

const discussionReply = feedNotification({
  notification: "DiscussionReply",
  actor: { name: "Ada Lovelace", avatarUrl: null },
  data: {
    replierName: "Ada Lovelace",
    lessonTitle: "Closures",
    courseTitle: "JavaScript Deep Dive",
    snippet: "You can capture the loop variable with let.",
    link: "/courses/js-deep-dive/lessons/7#comment-42",
    commentId: 42,
  },
});

describe("a Discussion Reply row", () => {
  it("says who replied and quotes the reply", () => {
    expect(notificationRowText(discussionReply)).toEqual({
      title: "Ada Lovelace replied to your question",
      snippet: "“You can capture the loop variable with let.”",
    });
  });

  it("keeps the replier's name as it was when sent", () => {
    const renamed = {
      ...discussionReply,
      actor: { name: "Ada King", avatarUrl: null },
    };
    expect(notificationRowText(renamed).title).toBe(
      "Ada Lovelace replied to your question"
    );
  });

  it("falls back to the lesson when there is no snippet", () => {
    const noSnippet = {
      ...discussionReply,
      data: { ...discussionReply.data, snippet: null },
    };
    expect(notificationRowText(noSnippet).snippet).toBe("Closures");
  });

  it("goes to the reply on its lesson", () => {
    expect(notificationLink(discussionReply)).toBe(
      "/courses/js-deep-dive/lessons/7#comment-42"
    );
  });
});

describe("a Notification this build doesn't know", () => {
  it("still gets a row", () => {
    expect(notificationRowText(feedNotification())).toEqual({
      title: "New notification",
      snippet: "",
    });
  });

  it("names the sender when there is one", () => {
    const fromAda = feedNotification({
      actor: { name: "Ada Lovelace", avatarUrl: null },
    });
    expect(notificationRowText(fromAda).title).toBe(
      "New notification from Ada Lovelace"
    );
  });
});

describe("a Notification's click target", () => {
  it("is nowhere when there is no link", () => {
    expect(notificationLink(feedNotification())).toBeNull();
  });

  it("only ever stays inside Cadence", () => {
    const external = (link: string) =>
      notificationLink(feedNotification({ data: { link } }));
    expect(external("https://example.com/phish")).toBeNull();
    expect(external("//example.com/phish")).toBeNull();
    expect(external("/team")).toBe("/team");
  });
});

describe("the bell's badge", () => {
  it("is hidden with nothing unseen", () => {
    expect(unseenBadge(0)).toBeNull();
  });

  it("counts unseen Notifications up to nine", () => {
    expect(unseenBadge(1)).toBe("1");
    expect(unseenBadge(9)).toBe("9");
  });

  it("caps at 9+", () => {
    expect(unseenBadge(10)).toBe("9+");
    expect(unseenBadge(250)).toBe("9+");
  });
});
