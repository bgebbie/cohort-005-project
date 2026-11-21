import { describe, expect, it, vi } from "vitest";
import { noopNotificationPort, notify } from "./notifications.server";

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
