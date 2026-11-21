import { eq } from "drizzle-orm";
import { comments, courses, lessons, modules } from "~/db/schema";
import {
  commentAnchor,
  MAX_COMMENT_LENGTH,
  MIN_COMMENT_LENGTH,
} from "~/lib/comments";
import {
  archiveCommentNotifications,
  notify,
  recipientsOtherThan,
  type NotificationPort,
} from "~/lib/notifications.server";
import type { Db } from "~/lib/refunds.server";
import { getNotificationUser } from "~/lib/users.server";

// ─── Comments ───
// Discussion Questions and Discussion Replies on a lesson: posting, editing and
// soft-deleting them. See GLOSSARY.md for the language.
//
// Every function takes the database first and `now` last, so tests can hand in
// an in-memory one; a function that sends Notifications takes the
// NotificationPort second. Uses positional parameters (project convention).

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
 *
 * A Discussion Question notifies the course's Instructor. A Discussion Reply
 * notifies the question's author, unless they wrote it. A reply under the
 * Instructor's own top-level comment isn't a Discussion Reply and notifies
 * nobody.
 */
export async function createComment(
  db: Db,
  notifications: NotificationPort,
  authorId: number,
  lessonId: number,
  parentId: number | null,
  body: string,
  now: Date
): Promise<CommentResult> {
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

  let parent: Comment | undefined;
  if (parentId !== null) {
    parent = getComment(db, parentId);
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

  const place = getPlace(db, lessonId);
  // No place means a lesson outside any course, which has nobody to notify.
  if (!place) return { ok: true, comment };

  if (!parent) {
    if (isDiscussionQuestion(comment, place)) {
      await notifyDiscussionQuestion(db, notifications, comment, place);
    }
  } else if (isDiscussionQuestion(parent, place)) {
    await notifyDiscussionReply(
      db,
      notifications,
      comment,
      parent.userId,
      place
    );
  }

  return { ok: true, comment };
}

/** A top-level comment by anyone other than the course's Instructor. */
function isDiscussionQuestion(comment: Comment, place: Place): boolean {
  return comment.parentId === null && comment.userId !== place.instructorId;
}

/**
 * Whether posting this comment sent a Notification. A reply is a Discussion
 * Reply only under a Discussion Question, and `notify` drops the actor, so a
 * reply to your own question sent nothing.
 */
function causedNotification(db: Db, comment: Comment, place: Place): boolean {
  if (comment.parentId === null) return isDiscussionQuestion(comment, place);
  const parent = getComment(db, comment.parentId);
  if (!parent || !isDiscussionQuestion(parent, place)) return false;
  const recipients = [{ id: parent.userId }];
  return recipientsOtherThan(recipients, { id: comment.userId }).length > 0;
}

/** Where a comment sits: its lesson and course, and the course's Instructor. */
type Place = {
  lessonTitle: string;
  courseTitle: string;
  courseSlug: string;
  instructorId: number;
};

function getPlace(db: Db, lessonId: number): Place | undefined {
  return db
    .select({
      lessonTitle: lessons.title,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      instructorId: courses.instructorId,
    })
    .from(lessons)
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .innerJoin(courses, eq(courses.id, modules.courseId))
    .where(eq(lessons.id, lessonId))
    .get();
}

function commentLink(place: Place, comment: Comment): string {
  return `/courses/${place.courseSlug}/lessons/${comment.lessonId}#${commentAnchor(comment.id)}`;
}

/** Sends the Discussion Question Notification to the course's Instructor. */
async function notifyDiscussionQuestion(
  db: Db,
  notifications: NotificationPort,
  question: Comment,
  place: Place
) {
  const asker = getNotificationUser(db, question.userId);
  const instructor = getNotificationUser(db, place.instructorId);
  if (!asker || !instructor) return;

  await notify(notifications, {
    notification: "DiscussionQuestion",
    recipients: [instructor],
    actor: asker,
    data: {
      askerName: asker.name,
      lessonTitle: place.lessonTitle,
      courseTitle: place.courseTitle,
      snippet: snippet(question.body),
      link: commentLink(place, question),
      commentId: question.id,
    },
    idempotencyKey: `discussion-question:${question.id}`,
  });
}

/** Sends the Discussion Reply Notification to the question's author. */
async function notifyDiscussionReply(
  db: Db,
  notifications: NotificationPort,
  reply: Comment,
  questionAuthorId: number,
  place: Place
) {
  const replier = getNotificationUser(db, reply.userId);
  const questionAuthor = getNotificationUser(db, questionAuthorId);
  if (!replier || !questionAuthor) return;

  await notify(notifications, {
    notification: "DiscussionReply",
    recipients: [questionAuthor],
    actor: replier,
    data: {
      replierName: replier.name,
      lessonTitle: place.lessonTitle,
      courseTitle: place.courseTitle,
      snippet: snippet(reply.body),
      link: commentLink(place, reply),
      commentId: reply.id,
    },
    idempotencyKey: `discussion-reply:${reply.id}`,
  });
}

const SNIPPET_LENGTH = 140;

/** A comment body on one line, cut to fit a Notification. */
function snippet(body: string): string {
  const oneLine = body.replace(/\s+/g, " ").trim();
  return oneLine.length <= SNIPPET_LENGTH
    ? oneLine
    : `${oneLine.slice(0, SNIPPET_LENGTH - 1).trimEnd()}…`;
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
 *
 * The Notification the comment caused is archived, so it leaves its
 * recipient's feed. Deleting a Discussion Question leaves the Notifications
 * for its replies alone, because those replies stay visible.
 */
export async function deleteComment(
  db: Db,
  notifications: NotificationPort,
  commentId: number,
  userId: number,
  isStaff: boolean,
  now: Date
): Promise<CommentResult> {
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

  const place = getPlace(db, comment.lessonId);
  if (place && causedNotification(db, comment, place)) {
    await archiveCommentNotifications(notifications, comment.id);
  }

  return { ok: true, comment };
}
