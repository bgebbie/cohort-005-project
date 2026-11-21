import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import {
  createComment,
  deleteComment,
  editComment,
  getComment,
} from "./comments.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;
let otherLessonId: number;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  lessonId = db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Lesson 1", position: 1 })
    .returning()
    .get().id;

  otherLessonId = db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Lesson 2", position: 2 })
    .returning()
    .get().id;
});

function postQuestion(authorId: number, onLessonId = lessonId) {
  const result = createComment(
    db,
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
  it("posts a Discussion Question on a lesson, trimmed and stamped with now", () => {
    const result = createComment(
      db,
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

  it("posts a Discussion Reply under a Discussion Question", () => {
    const question = postQuestion(base.user.id);

    const result = createComment(
      db,
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

  it.each(["", "   \n\t  "])("rejects an empty body (%j)", (body) => {
    expect(createComment(db, base.user.id, lessonId, null, body, NOW)).toEqual({
      ok: false,
      status: 400,
      error: "Comment cannot be empty",
    });
  });

  it("accepts a body of exactly 5000 characters and rejects 5001", () => {
    expect(
      createComment(db, base.user.id, lessonId, null, "a".repeat(5000), NOW).ok
    ).toBe(true);

    expect(
      createComment(db, base.user.id, lessonId, null, "a".repeat(5001), NOW)
    ).toEqual({
      ok: false,
      status: 400,
      error: "Comment must be 5000 characters or fewer",
    });
  });

  it("rejects a comment on a lesson that does not exist", () => {
    expect(
      createComment(db, base.user.id, lessonId + 999, null, "Hello", NOW)
    ).toEqual({ ok: false, status: 404, error: "Lesson not found" });
  });

  it("rejects a Discussion Reply to a comment that does not exist", () => {
    expect(
      createComment(db, base.user.id, lessonId, 999, "Replying", NOW)
    ).toEqual({ ok: false, status: 404, error: "Parent comment not found" });
  });

  it("rejects a Discussion Reply whose question is on a different lesson", () => {
    const questionElsewhere = postQuestion(base.user.id, otherLessonId);

    expect(
      createComment(
        db,
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

  it("rejects a reply to a Discussion Reply, keeping replies one level deep", () => {
    const question = postQuestion(base.user.id);
    const reply = createComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "First reply",
      NOW
    );
    if (!reply.ok) throw new Error(reply.error);

    expect(
      createComment(db, base.user.id, lessonId, reply.comment.id, "Nested", NOW)
    ).toEqual({
      ok: false,
      status: 400,
      error: "Replies can only be one level deep",
    });
  });
});

describe("deleteComment", () => {
  const LATER = new Date(2026, 9, 7, 9, 30, 0);

  it("lets an author soft-delete their own comment, stamped with now", () => {
    const question = postQuestion(base.user.id);

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

  it("lets staff soft-delete someone else's comment", () => {
    const question = postQuestion(base.user.id);

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

  it("refuses to let a non-staff user delete someone else's comment", () => {
    const question = postQuestion(base.user.id);
    const classmate = addStudent("Casey");

    expect(deleteComment(db, question.id, classmate.id, false, LATER)).toEqual({
      ok: false,
      status: 403,
      error: "You can only delete your own comments",
    });
    expect(getComment(db, question.id)?.deletedAt).toBeNull();
  });

  it("reports a comment that does not exist", () => {
    expect(deleteComment(db, 999, base.user.id, true, LATER)).toEqual({
      ok: false,
      status: 404,
      error: "Comment not found",
    });
  });

  it("leaves an already-deleted comment as it was", () => {
    const question = postQuestion(base.user.id);
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

  it("lets an author edit their own comment, trimmed and stamped with now", () => {
    const question = postQuestion(base.user.id);

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

  it("holds an edit to the same body length limits as posting", () => {
    const question = postQuestion(base.user.id);

    expect(editComment(db, question.id, base.user.id, "  ", LATER)).toEqual({
      ok: false,
      status: 400,
      error: "Comment cannot be empty",
    });
  });

  it("refuses an edit to someone else's comment, even by staff", () => {
    const question = postQuestion(base.user.id);

    expect(
      editComment(db, question.id, base.instructor.id, "Rewritten", LATER)
    ).toEqual({
      ok: false,
      status: 403,
      error: "You can only edit your own comments",
    });
  });

  it("refuses an edit to a deleted comment", () => {
    const question = postQuestion(base.user.id);
    deleteComment(db, question.id, base.user.id, false, NOW);

    expect(
      editComment(db, question.id, base.user.id, "Rewritten", LATER)
    ).toEqual({ ok: false, status: 400, error: "Comment has been deleted" });
  });
});
