import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import { bookmarks, courses, lessons, modules, notes } from "~/db/schema";
import { MAX_NOTE_LENGTH, NOTE_TOO_LONG_ERROR } from "~/lib/notes";

// ─── Bookmarks and Notes ───
// What a Student attaches to a Lesson for themselves and nobody else. See
// GLOSSARY.md: a Note is private to the Student who wrote it, so nothing here
// reads another Student's rows, and nothing outside the owning Student's Lesson
// page and Saved page should call these functions.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Uses positional parameters (project convention). Content access is the
// caller's job: the Lesson page action checks it before calling in.

export type Db = BetterSQLite3Database<typeof schema>;

export function isBookmarked(db: Db, userId: number, lessonId: number) {
  return !!db
    .select({ id: bookmarks.id })
    .from(bookmarks)
    .where(and(eq(bookmarks.userId, userId), eq(bookmarks.lessonId, lessonId)))
    .get();
}

/**
 * Adds the Bookmark if the Lesson has none, removes it if it has one. Returns
 * whether the Lesson is now bookmarked.
 */
export function toggleBookmark(
  db: Db,
  userId: number,
  lessonId: number,
  now: Date
): boolean {
  const removed = db
    .delete(bookmarks)
    .where(and(eq(bookmarks.userId, userId), eq(bookmarks.lessonId, lessonId)))
    .returning({ id: bookmarks.id })
    .all();
  if (removed.length > 0) return false;

  // The unique index on (user, lesson) settles a race between two requests.
  db.insert(bookmarks)
    .values({ userId, lessonId, createdAt: now.toISOString() })
    .onConflictDoNothing()
    .run();
  return true;
}

export function getNote(db: Db, userId: number, lessonId: number) {
  return db
    .select({ body: notes.body, updatedAt: notes.updatedAt })
    .from(notes)
    .where(and(eq(notes.userId, userId), eq(notes.lessonId, lessonId)))
    .get();
}

export type SaveNoteResult =
  | { ok: true; note: { body: string; updatedAt: string } | null }
  | { ok: false; error: string };

/**
 * Creates the Student's Note on the Lesson, or replaces its body and moves its
 * "last edited" time on. The body is plain text and trimmed. Saving an empty
 * box deletes the Note (`note: null`); a body over MAX_NOTE_LENGTH is refused,
 * never truncated.
 */
export function saveNote(
  db: Db,
  userId: number,
  lessonId: number,
  body: string,
  now: Date
): SaveNoteResult {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    db.delete(notes)
      .where(and(eq(notes.userId, userId), eq(notes.lessonId, lessonId)))
      .run();
    return { ok: true, note: null };
  }
  if (trimmed.length > MAX_NOTE_LENGTH) {
    return { ok: false, error: NOTE_TOO_LONG_ERROR };
  }

  const timestamp = now.toISOString();
  const note = db
    .insert(notes)
    .values({
      userId,
      lessonId,
      body: trimmed,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      target: [notes.userId, notes.lessonId],
      set: { body: trimmed, updatedAt: timestamp },
    })
    .returning({ body: notes.body, updatedAt: notes.updatedAt })
    .get();

  return { ok: true, note };
}

// Every Saved row links to its Lesson and names the Course it belongs to.
export type LessonRef = {
  lessonId: number;
  lessonTitle: string;
  moduleTitle: string;
  courseTitle: string;
  courseSlug: string;
};

const lessonRef = {
  lessonId: lessons.id,
  lessonTitle: lessons.title,
  moduleTitle: modules.title,
  courseTitle: courses.title,
  courseSlug: courses.slug,
};

/** The Student's Bookmarks, newest first. */
export function listBookmarks(db: Db, userId: number) {
  return db
    .select({ id: bookmarks.id, createdAt: bookmarks.createdAt, ...lessonRef })
    .from(bookmarks)
    .innerJoin(lessons, eq(bookmarks.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(bookmarks.userId, userId))
    .orderBy(desc(bookmarks.createdAt), desc(bookmarks.id))
    .all();
}

/** The Student's Notes, most recently edited first. */
export function listNotes(db: Db, userId: number) {
  return db
    .select({
      id: notes.id,
      body: notes.body,
      updatedAt: notes.updatedAt,
      ...lessonRef,
    })
    .from(notes)
    .innerJoin(lessons, eq(notes.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(notes.userId, userId))
    .orderBy(desc(notes.updatedAt), desc(notes.id))
    .all();
}
