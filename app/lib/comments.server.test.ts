import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import { eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import {
  createComment,
  deleteComment,
  editComment,
  getComment,
} from "./comments.server";
import {
  fakeNotificationPort,
  type FakeNotificationPort,
} from "./notifications.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;
let otherLessonId: number;
let notifications: FakeNotificationPort;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  notifications = fakeNotificationPort();

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  lessonId = db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Closures", position: 1 })
    .returning()
    .get().id;

  otherLessonId = db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Lesson 2", position: 2 })
    .returning()
    .get().id;
});

/** Posts a top-level comment; any Notification it causes is kept out of `notifications`. */
async function postQuestion(authorId: number, onLessonId = lessonId) {
  const result = await createComment(
    db,
    fakeNotificationPort(),
    authorId,
    onLessonId,
    null,
    "A question",
    NOW
  );
  if (!result.ok) throw new Error(result.error);
  return result.comment;
}

function addStudent(name: string) {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase()}@example.com`,
      role: schema.UserRole.Student,
    })
    .returning()
    .get();
}

describe("createComment", () => {
  it("posts a Discussion Question on a lesson, trimmed and stamped with now", async () => {
    const result = await createComment(
      db,
      notifications,
      base.user.id,
      lessonId,
      null,
      "  How do closures work?  ",
      NOW
    );

    expect(result).toMatchObject({
      ok: true,
      comment: {
        userId: base.user.id,
        lessonId,
        parentId: null,
        body: "How do closures work?",
        createdAt: NOW.toISOString(),
        deletedAt: null,
      },
    });
  });

  it("posts a Discussion Reply under a Discussion Question", async () => {
    const question = await postQuestion(base.user.id);

    const result = await createComment(
      db,
      notifications,
      base.instructor.id,
      lessonId,
      question.id,
      "They capture variables from the enclosing scope.",
      NOW
    );

    expect(result).toMatchObject({
      ok: true,
      comment: {
        userId: base.instructor.id,
        lessonId,
        parentId: question.id,
        body: "They capture variables from the enclosing scope.",
      },
    });
  });

  it.each(["", "   \n\t  "])("rejects an empty body (%j)", async (body) => {
    expect(
      await createComment(
        db,
        notifications,
        base.user.id,
        lessonId,
        null,
        body,
        NOW
      )
    ).toEqual({
      ok: false,
      status: 400,
      error: "Comment cannot be empty",
    });
  });

  it("accepts a body of exactly 5000 characters and rejects 5001", async () => {
    expect(
      (
        await createComment(
          db,
          notifications,
          base.user.id,
          lessonId,
          null,
          "a".repeat(5000),
          NOW
        )
      ).ok
    ).toBe(true);

    expect(
      await createComment(
        db,
        notifications,
        base.user.id,
        lessonId,
        null,
        "a".repeat(5001),
        NOW
      )
    ).toEqual({
      ok: false,
      status: 400,
      error: "Comment must be 5000 characters or fewer",
    });
  });

  it("rejects a comment on a lesson that does not exist", async () => {
    expect(
      await createComment(
        db,
        notifications,
        base.user.id,
        lessonId + 999,
        null,
        "Hello",
        NOW
      )
    ).toEqual({ ok: false, status: 404, error: "Lesson not found" });
  });

  it("rejects a Discussion Reply to a comment that does not exist", async () => {
    expect(
      await createComment(
        db,
        notifications,
        base.user.id,
        lessonId,
        999,
        "Replying",
        NOW
      )
    ).toEqual({ ok: false, status: 404, error: "Parent comment not found" });
  });

  it("rejects a Discussion Reply whose question is on a different lesson", async () => {
    const questionElsewhere = await postQuestion(base.user.id, otherLessonId);

    expect(
      await createComment(
        db,
        notifications,
        base.instructor.id,
        lessonId,
        questionElsewhere.id,
        "Replying",
        NOW
      )
    ).toEqual({
      ok: false,
      status: 400,
      error: "Parent comment belongs to a different lesson",
    });
  });

  it("rejects a reply to a Discussion Reply, keeping replies one level deep", async () => {
    const question = await postQuestion(base.user.id);
    const reply = await createComment(
      db,
      notifications,
      base.instructor.id,
      lessonId,
      question.id,
      "First reply",
      NOW
    );
    if (!reply.ok) throw new Error(reply.error);

    expect(
      await createComment(
        db,
        notifications,
        base.user.id,
        lessonId,
        reply.comment.id,
        "Nested",
        NOW
      )
    ).toEqual({
      ok: false,
      status: 400,
      error: "Replies can only be one level deep",
    });
  });
});

describe("createComment: Discussion Question Notification", () => {
  async function ask(authorId: number, body = "How do closures work?") {
    const result = await createComment(
      db,
      notifications,
      authorId,
      lessonId,
      null,
      body,
      NOW
    );
    if (!result.ok) throw new Error(result.error);
    return result.comment;
  }

  it("notifies the course's Instructor when a Student asks a Discussion Question", async () => {
    const asker = db
      .update(schema.users)
      .set({ avatarUrl: "https://example.com/asker.png" })
      .where(eq(schema.users.id, base.user.id))
      .returning()
      .get();

    const question = await ask(asker.id, "  How do closures work?  ");

    expect(notifications.triggers).toEqual([
      {
        notification: "DiscussionQuestion",
        recipients: [
          {
            id: base.instructor.id,
            name: "Test Instructor",
            email: "instructor@example.com",
            avatarUrl: null,
          },
        ],
        actor: {
          id: asker.id,
          name: "Test User",
          email: "test@example.com",
          avatarUrl: "https://example.com/asker.png",
        },
        data: {
          askerName: "Test User",
          lessonTitle: "Closures",
          courseTitle: "Test Course",
          snippet: "How do closures work?",
          link: `/courses/test-course/lessons/${lessonId}#comment-${question.id}`,
          commentId: question.id,
        },
        idempotencyKey: `discussion-question:${question.id}`,
      },
    ]);
  });

  it("notifies the course's Instructor when a Platform Admin asks a Discussion Question", async () => {
    const admin = db
      .insert(schema.users)
      .values({
        name: "Ada Admin",
        email: "ada@example.com",
        role: schema.UserRole.Admin,
      })
      .returning()
      .get();

    const question = await ask(admin.id);

    expect(notifications.triggers).toMatchObject([
      {
        notification: "DiscussionQuestion",
        recipients: [{ id: base.instructor.id }],
        actor: { id: admin.id },
        data: { askerName: "Ada Admin", commentId: question.id },
        idempotencyKey: `discussion-question:${question.id}`,
      },
    ]);
  });

  it("notifies the course's Instructor when an Instructor of another course asks", async () => {
    const otherInstructor = db
      .insert(schema.users)
      .values({
        name: "Olu Other",
        email: "olu@example.com",
        role: schema.UserRole.Instructor,
      })
      .returning()
      .get();

    await ask(otherInstructor.id);

    expect(notifications.triggers).toMatchObject([
      {
        notification: "DiscussionQuestion",
        recipients: [{ id: base.instructor.id }],
        actor: { id: otherInstructor.id },
      },
    ]);
  });

  it("still saves the question when the Notification fails, and logs the failure", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = {
      trigger: async () => {
        throw new Error("Knock is down");
      },
    };

    const result = await createComment(
      db,
      failing,
      base.user.id,
      lessonId,
      null,
      "How do closures work?",
      NOW
    );

    if (!result.ok) throw new Error(result.error);
    expect(getComment(db, result.comment.id)?.body).toBe(
      "How do closures work?"
    );
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it("sends nothing when the course's Instructor posts a top-level comment, which isn't a Discussion Question", async () => {
    await ask(base.instructor.id, "Welcome to the lesson!");

    expect(notifications.triggers).toEqual([]);
  });
});

describe("createComment: Discussion Reply Notification", () => {
  it("notifies the question's author when someone else replies", async () => {
    const asker = db
      .update(schema.users)
      .set({ avatarUrl: "https://example.com/asker.png" })
      .where(eq(schema.users.id, base.user.id))
      .returning()
      .get();
    const replier = addStudent("Priya");
    const question = await postQuestion(asker.id);

    const result = await createComment(
      db,
      notifications,
      replier.id,
      lessonId,
      question.id,
      "  You can capture the variable in a closure, like this example shows.  ",
      NOW
    );
    if (!result.ok) throw new Error(result.error);

    expect(notifications.triggers).toEqual([
      {
        notification: "DiscussionReply",
        recipients: [
          {
            id: asker.id,
            name: "Test User",
            email: "test@example.com",
            avatarUrl: "https://example.com/asker.png",
          },
        ],
        actor: {
          id: replier.id,
          name: "Priya",
          email: "priya@example.com",
          avatarUrl: null,
        },
        data: {
          replierName: "Priya",
          lessonTitle: "Closures",
          courseTitle: "Test Course",
          snippet:
            "You can capture the variable in a closure, like this example shows.",
          link: `/courses/test-course/lessons/${lessonId}#comment-${result.comment.id}`,
          commentId: result.comment.id,
        },
        idempotencyKey: `discussion-reply:${result.comment.id}`,
      },
    ]);
  });

  it("sends nothing when the question's author replies to their own question", async () => {
    const question = await postQuestion(base.user.id);

    const result = await createComment(
      db,
      notifications,
      base.user.id,
      lessonId,
      question.id,
      "Never mind, I worked it out.",
      NOW
    );

    expect(result.ok).toBe(true);
    expect(notifications.triggers).toEqual([]);
  });

  it("sends nothing for a reply under the course Instructor's top-level comment, which isn't a Discussion Question", async () => {
    const announcement = await postQuestion(base.instructor.id);

    const result = await createComment(
      db,
      notifications,
      base.user.id,
      lessonId,
      announcement.id,
      "Thanks!",
      NOW
    );

    expect(result.ok).toBe(true);
    expect(notifications.triggers).toEqual([]);
  });

  it("sends nothing for a refused reply", async () => {
    const question = await postQuestion(base.user.id);
    const replier = addStudent("Priya");

    await createComment(
      db,
      notifications,
      replier.id,
      lessonId,
      question.id,
      "   ",
      NOW
    );
    await createComment(
      db,
      notifications,
      replier.id,
      otherLessonId,
      question.id,
      "Hi",
      NOW
    );

    expect(notifications.triggers).toEqual([]);
  });

  it("puts a one-line snippet of a long reply in the Notification", async () => {
    const question = await postQuestion(base.user.id);
    const replier = addStudent("Priya");

    await createComment(
      db,
      notifications,
      replier.id,
      lessonId,
      question.id,
      `First line.\n\nSecond line ${"long ".repeat(100)}`,
      NOW
    );

    const [trigger] = notifications.triggers;
    if (trigger?.notification !== "DiscussionReply") {
      throw new Error("Expected a Discussion Reply Notification");
    }
    expect(trigger.data.snippet).toMatch(/^First line\. Second line long long/);
    expect(trigger.data.snippet).toMatch(/…$/);
    expect(trigger.data.snippet.length).toBeLessThanOrEqual(140);
  });

  it("still saves the reply when the Notification fails, and logs the failure", async () => {
    const question = await postQuestion(base.user.id);
    const replier = addStudent("Priya");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = {
      trigger: async () => {
        throw new Error("Knock is down");
      },
    };

    const result = await createComment(
      db,
      failing,
      replier.id,
      lessonId,
      question.id,
      "Here's an answer.",
      NOW
    );

    if (!result.ok) throw new Error(result.error);
    expect(getComment(db, result.comment.id)?.body).toBe("Here's an answer.");
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe("deleteComment", () => {
  const LATER = new Date(2026, 9, 7, 9, 30, 0);

  it("lets an author soft-delete their own comment, stamped with now", async () => {
    const question = await postQuestion(base.user.id);

    const result = deleteComment(db, question.id, base.user.id, false, LATER);

    expect(result).toMatchObject({
      ok: true,
      comment: {
        id: question.id,
        body: "A question",
        deletedAt: LATER.toISOString(),
      },
    });
  });

  it("lets staff soft-delete someone else's comment", async () => {
    const question = await postQuestion(base.user.id);

    const result = deleteComment(
      db,
      question.id,
      base.instructor.id,
      true,
      LATER
    );

    expect(result).toMatchObject({
      ok: true,
      comment: { id: question.id, deletedAt: LATER.toISOString() },
    });
  });

  it("refuses to let a non-staff user delete someone else's comment", async () => {
    const question = await postQuestion(base.user.id);
    const classmate = addStudent("Casey");

    expect(deleteComment(db, question.id, classmate.id, false, LATER)).toEqual({
      ok: false,
      status: 403,
      error: "You can only delete your own comments",
    });
    expect(getComment(db, question.id)?.deletedAt).toBeNull();
  });

  it("reports a comment that does not exist", async () => {
    expect(deleteComment(db, 999, base.user.id, true, LATER)).toEqual({
      ok: false,
      status: 404,
      error: "Comment not found",
    });
  });

  it("leaves an already-deleted comment as it was", async () => {
    const question = await postQuestion(base.user.id);
    deleteComment(db, question.id, base.user.id, false, NOW);

    const result = deleteComment(db, question.id, base.user.id, false, LATER);

    expect(result).toMatchObject({
      ok: true,
      comment: { id: question.id, deletedAt: NOW.toISOString() },
    });
  });
});

describe("editComment", () => {
  const LATER = new Date(2026, 9, 7, 9, 30, 0);

  it("lets an author edit their own comment, trimmed and stamped with now", async () => {
    const question = await postQuestion(base.user.id);

    const result = editComment(
      db,
      question.id,
      base.user.id,
      "  A better question  ",
      LATER
    );

    expect(result).toMatchObject({
      ok: true,
      comment: {
        id: question.id,
        body: "A better question",
        editedAt: LATER.toISOString(),
      },
    });
  });

  it("holds an edit to the same body length limits as posting", async () => {
    const question = await postQuestion(base.user.id);

    expect(editComment(db, question.id, base.user.id, "  ", LATER)).toEqual({
      ok: false,
      status: 400,
      error: "Comment cannot be empty",
    });
  });

  it("refuses an edit to someone else's comment, even by staff", async () => {
    const question = await postQuestion(base.user.id);

    expect(
      editComment(db, question.id, base.instructor.id, "Rewritten", LATER)
    ).toEqual({
      ok: false,
      status: 403,
      error: "You can only edit your own comments",
    });
  });

  it("refuses an edit to a deleted comment", async () => {
    const question = await postQuestion(base.user.id);
    deleteComment(db, question.id, base.user.id, false, NOW);

    expect(
      editComment(db, question.id, base.user.id, "Rewritten", LATER)
    ).toEqual({ ok: false, status: 400, error: "Comment has been deleted" });
  });
});
