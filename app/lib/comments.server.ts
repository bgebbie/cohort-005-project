import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import { comments, lessons } from "~/db/schema";
import { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from "~/lib/comments";

// ─── Comments ───
// Discussion Questions and Discussion Replies on a lesson: posting, editing and
// soft-deleting them. See GLOSSARY.md for the language.
//
// Every function takes the database first and `now` last, so tests can hand in
// an in-memory one. Uses positional parameters (project convention).

export type Db = BetterSQLite3Database<typeof schema>;

type Comment = typeof comments.$inferSelect;

export type Failure = { ok: false; status: 400 | 403 | 404; error: string };

export function getComment(db: Db, commentId: number): Comment | undefined {
  return db.select().from(comments).where(eq(comments.id, commentId)).get();
}

export type CommentResult = { ok: true; comment: Comment } | Failure;

type BodyCheck = { ok: true; body: string } | Failure;

/** A comment body is stored trimmed, and must be 1–5000 characters once it is. */
function checkBody(body: string): BodyCheck {
  const trimmed = body.trim();
  if (trimmed.length < MIN_COMMENT_LENGTH) {
    return { ok: false, status: 400, error: "Comment cannot be empty" };
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`,
    };
  }
  return { ok: true, body: trimmed };
}

/**
 * Posts a comment on a lesson. With no parent it is a top-level comment (a
 * Discussion Question, unless the course's Instructor wrote it); with one it is
 * a Discussion Reply, and the parent must be a top-level comment on the same
 * lesson.
 */
export function createComment(
  db: Db,
  authorId: number,
  lessonId: number,
  parentId: number | null,
  body: string,
  now: Date
): CommentResult {
  const checked = checkBody(body);
  if (!checked.ok) return checked;

  const lesson = db
    .select()
    .from(lessons)
    .where(eq(lessons.id, lessonId))
    .get();
  if (!lesson) {
    return { ok: false, status: 404, error: "Lesson not found" };
  }

  if (parentId !== null) {
    const parent = getComment(db, parentId);
    if (!parent) {
      return { ok: false, status: 404, error: "Parent comment not found" };
    }
    if (parent.lessonId !== lessonId) {
      return {
        ok: false,
        status: 400,
        error: "Parent comment belongs to a different lesson",
      };
    }
    if (parent.parentId !== null) {
      return {
        ok: false,
        status: 400,
        error: "Replies can only be one level deep",
      };
    }
  }

  const comment = db
    .insert(comments)
    .values({
      userId: authorId,
      lessonId,
      parentId,
      body: checked.body,
      createdAt: now.toISOString(),
    })
    .returning()
    .get();

  return { ok: true, comment };
}

/** Edits the body of a live comment. Only its author may; staff cannot edit anyone else's. */
export function editComment(
  db: Db,
  commentId: number,
  userId: number,
  body: string,
  now: Date
): CommentResult {
  const checked = checkBody(body);
  if (!checked.ok) return checked;

  const existing = getComment(db, commentId);
  if (!existing) {
    return { ok: false, status: 404, error: "Comment not found" };
  }
  if (existing.deletedAt !== null) {
    return { ok: false, status: 400, error: "Comment has been deleted" };
  }
  if (existing.userId !== userId) {
    return {
      ok: false,
      status: 403,
      error: "You can only edit your own comments",
    };
  }

  const comment = db
    .update(comments)
    .set({ body: checked.body, editedAt: now.toISOString() })
    .where(eq(comments.id, commentId))
    .returning()
    .get();

  return { ok: true, comment };
}

/**
 * Soft-deletes a comment: its row stays, with `deletedAt` set. Anyone may
 * delete their own comment; staff (the course's Instructor or a Platform
 * Admin) may delete anyone's.
 */
export function deleteComment(
  db: Db,
  commentId: number,
  userId: number,
  isStaff: boolean,
  now: Date
): CommentResult {
  const existing = getComment(db, commentId);
  if (!existing) {
    return { ok: false, status: 404, error: "Comment not found" };
  }
  if (existing.userId !== userId && !isStaff) {
    return {
      ok: false,
      status: 403,
      error: "You can only delete your own comments",
    };
  }
  if (existing.deletedAt !== null) {
    return { ok: true, comment: existing };
  }

  const comment = db
    .update(comments)
    .set({ deletedAt: now.toISOString() })
    .where(eq(comments.id, commentId))
    .returning()
    .get();

  return { ok: true, comment };
}
