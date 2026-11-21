import { describe, expect, it } from "vitest";
import type { FeedNotification } from "./notification-feed";
import { unseenBadge } from "./notification-feed";
import {
  notificationIcon,
  notificationLink,
  notificationRowText,
} from "./notification-rows";

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
      title: "Ada Lovelace replied to your Discussion Question",
      snippet: "Closures: “You can capture the loop variable with let.”",
    });
  });

  it("keeps the replier's name as it was when sent", () => {
    const renamed = {
      ...discussionReply,
      actor: { name: "Ada King", avatarUrl: null },
    };
    expect(notificationRowText(renamed).title).toBe(
      "Ada Lovelace replied to your Discussion Question"
    );
  });

  it("falls back to the lesson when there is no snippet", () => {
    const noSnippet = {
      ...discussionReply,
      data: { ...discussionReply.data, snippet: null },
    };
    expect(notificationRowText(noSnippet).snippet).toBe("Closures");
  });

  it("still quotes the reply when there is no lesson", () => {
    const noLesson = {
      ...discussionReply,
      data: { ...discussionReply.data, lessonTitle: null },
    };
    expect(notificationRowText(noLesson).snippet).toBe(
      "“You can capture the loop variable with let.”"
    );
  });

  it("goes to the reply on its lesson", () => {
    expect(notificationLink(discussionReply)).toBe(
      "/courses/js-deep-dive/lessons/7#comment-42"
    );
  });
});

describe("a Discussion Question row", () => {
  const question = feedNotification({
    notification: "DiscussionQuestion",
    actor: { name: "Grace Hopper", avatarUrl: null },
    data: {
      askerName: "Grace Hopper",
      lessonTitle: "Closures",
      courseTitle: "JavaScript Deep Dive",
      snippet: "Why does the loop print 3 three times?",
      link: "/courses/js-deep-dive/lessons/7#comment-41",
      commentId: 41,
    },
  });

  it("says who asked and quotes the question", () => {
    expect(notificationRowText(question)).toEqual({
      title: "Grace Hopper asked a Discussion Question",
      snippet: "Closures: “Why does the loop print 3 three times?”",
    });
  });

  it("goes to the question on its lesson", () => {
    expect(notificationLink(question)).toBe(
      "/courses/js-deep-dive/lessons/7#comment-41"
    );
  });
});

describe("a Seat claimed row", () => {
  const claimed = (seatsLeft: number) =>
    feedNotification({
      notification: "SeatClaimed",
      actor: { name: "Linus Pauling", avatarUrl: null },
      data: {
        claimerName: "Linus Pauling",
        courseTitle: "JavaScript Deep Dive",
        seatsLeft,
        link: "/team",
        seatId: 5,
      },
    });

  it("says who claimed a Seat and how many are left", () => {
    expect(notificationRowText(claimed(3))).toEqual({
      title: "Linus Pauling claimed a Seat",
      snippet: "3 Seats left on JavaScript Deep Dive",
    });
  });

  it("counts the last Seats in plain words", () => {
    expect(notificationRowText(claimed(1)).snippet).toBe(
      "1 Seat left on JavaScript Deep Dive"
    );
    expect(notificationRowText(claimed(0)).snippet).toBe(
      "No Seats left on JavaScript Deep Dive"
    );
  });

  it("goes to the team page", () => {
    expect(notificationLink(claimed(3))).toBe("/team");
  });
});

describe("a Refund Request confirmation row", () => {
  const confirmation = feedNotification({
    notification: "RefundRequestConfirmation",
    actor: null,
    data: {
      refundRequestId: 9,
      courseTitle: "JavaScript Deep Dive",
      amount: "$79.00",
      link: null,
    },
  });

  it("says Cadence has it, naming the amount and course", () => {
    expect(notificationRowText(confirmation)).toEqual({
      title: "We've received your Refund Request",
      snippet: "$79.00 for JavaScript Deep Dive is under review",
    });
  });

  it("goes nowhere", () => {
    expect(notificationLink(confirmation)).toBeNull();
  });
});

describe("an Open Refund Request row", () => {
  const open = feedNotification({
    notification: "OpenRefundRequest",
    actor: { name: "Alan Turing", avatarUrl: null },
    data: {
      refundRequestId: 9,
      buyerName: "Alan Turing",
      courseTitle: "JavaScript Deep Dive",
      amount: "$79.00",
      reason: "The course wasn't what I expected.",
      link: "/admin/refunds",
    },
  });

  it("says who wants how much back, and why", () => {
    expect(notificationRowText(open)).toEqual({
      title: "Alan Turing requested a $79.00 refund",
      snippet: "JavaScript Deep Dive: “The course wasn't what I expected.”",
    });
  });

  it("names just the course when there is no reason", () => {
    const noReason = { ...open, data: { ...open.data, reason: "" } };
    expect(notificationRowText(noReason).snippet).toBe("JavaScript Deep Dive");
  });

  it("goes to the Refund Request review page", () => {
    expect(notificationLink(open)).toBe("/admin/refunds");
  });
});

describe("a Refund Request approved row", () => {
  const approved = (decisionNote: string | null) =>
    feedNotification({
      notification: "RefundRequestApproved",
      actor: { name: "Platform Admin", avatarUrl: null },
      data: {
        refundRequestId: 9,
        courseTitle: "JavaScript Deep Dive",
        amount: "$79.00",
        purchaseKind: "individual_purchase",
        decisionNote,
        link: "/settings",
      },
    });

  it("says it was approved, for how much and which course", () => {
    expect(notificationRowText(approved(null))).toEqual({
      title: "Your Refund Request was approved",
      snippet: "$79.00 for JavaScript Deep Dive",
    });
  });

  it("quotes the decision note when there is one", () => {
    expect(
      notificationRowText(approved("Sorry it wasn't a fit.")).snippet
    ).toBe("$79.00 for JavaScript Deep Dive: “Sorry it wasn't a fit.”");
  });

  it("goes to the buyer's destination", () => {
    expect(notificationLink(approved(null))).toBe("/settings");
  });
});

describe("a Refund Request declined row", () => {
  const declined = feedNotification({
    notification: "RefundRequestDeclined",
    actor: { name: "Platform Admin", avatarUrl: null },
    data: {
      refundRequestId: 9,
      courseTitle: "JavaScript Deep Dive",
      amount: "$79.00",
      purchaseKind: "team_licence",
      decisionNote: "You've completed most of the course.",
      link: "/team",
    },
  });

  it("says it was declined, quotes why, and that they can ask again", () => {
    expect(notificationRowText(declined)).toEqual({
      title: "Your Refund Request was declined",
      snippet: "“You've completed most of the course.” You can ask again.",
    });
  });

  it("goes to the buyer's destination", () => {
    expect(notificationLink(declined)).toBe("/team");
  });
});

describe("a new Enrollment row", () => {
  const enrolled = feedNotification({
    notification: "NewEnrollment",
    actor: { name: "Grace Hopper", avatarUrl: null },
    data: {
      studentName: "Grace Hopper",
      courseTitle: "JavaScript Deep Dive",
      link: "/instructor/3/students",
      enrollmentId: 12,
    },
  });

  it("says which Student enrolled on which course", () => {
    expect(notificationRowText(enrolled)).toEqual({
      title: "Grace Hopper enrolled",
      snippet: "JavaScript Deep Dive",
    });
  });

  it("goes to the course's Students page", () => {
    expect(notificationLink(enrolled)).toBe("/instructor/3/students");
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

describe("a row's feed icon", () => {
  it("groups each Notification under one of the four icons", () => {
    expect(notificationIcon("DiscussionReply")).toBe("Discussion");
    expect(notificationIcon("DiscussionQuestion")).toBe("Discussion");
    expect(notificationIcon("RefundRequestConfirmation")).toBe("Refund");
    expect(notificationIcon("OpenRefundRequest")).toBe("Refund");
    expect(notificationIcon("RefundRequestApproved")).toBe("Refund");
    expect(notificationIcon("RefundRequestDeclined")).toBe("Refund");
    expect(notificationIcon("SeatClaimed")).toBe("Team");
    expect(notificationIcon("NewEnrollment")).toBe("Enrollment");
  });

  it("is absent for a Notification this build doesn't know", () => {
    expect(notificationIcon(null)).toBeNull();
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
