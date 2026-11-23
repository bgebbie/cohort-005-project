import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import {
  getNote,
  isBookmarked,
  listBookmarks,
  listNotes,
  saveNote,
  toggleBookmark,
} from "./bookmarks-and-notes.server";

type TestDb = ReturnType<typeof createTestDb>;

const MONDAY = new Date("2026-10-05T12:00:00.000Z");
const TUESDAY = new Date("2026-10-06T12:00:00.000Z");
const WEDNESDAY = new Date("2026-10-07T12:00:00.000Z");

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonA: number;
let lessonB: number;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  [lessonA, lessonB] = [1, 2].map(
    (position) =>
      db
        .insert(schema.lessons)
        .values({ moduleId: module.id, title: `Lesson ${position}`, position })
        .returning()
        .get().id
  );
});

function addStudent(name: string) {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase()}@example.com`,
      role: UserRole.Student,
    })
    .returning()
    .get();
}

describe("toggling a Bookmark", () => {
  it("bookmarks a Lesson with no Bookmark, and un-bookmarks it the second time", () => {
    expect(isBookmarked(db, base.user.id, lessonA)).toBe(false);

    expect(toggleBookmark(db, base.user.id, lessonA, MONDAY)).toBe(true);
    expect(isBookmarked(db, base.user.id, lessonA)).toBe(true);

    expect(toggleBookmark(db, base.user.id, lessonA, TUESDAY)).toBe(false);
    expect(isBookmarked(db, base.user.id, lessonA)).toBe(false);
  });

  it("never leaves a Student with two Bookmarks on one Lesson", () => {
    for (const now of [MONDAY, TUESDAY, WEDNESDAY]) {
      toggleBookmark(db, base.user.id, lessonA, now);
    }

    expect(listBookmarks(db, base.user.id)).toHaveLength(1);
  });

  it("is refused by the database when a second row is forced in", () => {
    toggleBookmark(db, base.user.id, lessonA, MONDAY);

    expect(() =>
      db
        .insert(schema.bookmarks)
        .values({ userId: base.user.id, lessonId: lessonA })
        .run()
    ).toThrow(/UNIQUE/);
  });
});

describe("saving a Note", () => {
  it("creates the Note on a Lesson that has none", () => {
    expect(getNote(db, base.user.id, lessonA)).toBeUndefined();

    const result = saveNote(
      db,
      base.user.id,
      lessonA,
      "  Re-watch 4:10  ",
      MONDAY
    );

    expect(result.ok).toBe(true);
    expect(getNote(db, base.user.id, lessonA)).toEqual({
      body: "Re-watch 4:10",
      updatedAt: MONDAY.toISOString(),
    });
  });

  it("replaces the body and moves the last-edited time on when saved again", () => {
    saveNote(db, base.user.id, lessonA, "First thought", MONDAY);
    saveNote(db, base.user.id, lessonA, "Second thought", TUESDAY);

    expect(getNote(db, base.user.id, lessonA)).toEqual({
      body: "Second thought",
      updatedAt: TUESDAY.toISOString(),
    });
    expect(listNotes(db, base.user.id)).toHaveLength(1);
  });

  it("keeps the body exactly as typed, Markdown characters included", () => {
    saveNote(db, base.user.id, lessonA, "# not a heading\n*not bold*", MONDAY);

    expect(getNote(db, base.user.id, lessonA)?.body).toBe(
      "# not a heading\n*not bold*"
    );
  });

  it("accepts a Note of exactly 2,000 characters", () => {
    const result = saveNote(
      db,
      base.user.id,
      lessonA,
      "a".repeat(2000),
      MONDAY
    );

    expect(result.ok).toBe(true);
    expect(getNote(db, base.user.id, lessonA)?.body).toHaveLength(2000);
  });

  it("refuses a Note over 2,000 characters with a message, and stores nothing", () => {
    const result = saveNote(
      db,
      base.user.id,
      lessonA,
      "a".repeat(2001),
      MONDAY
    );

    expect(result).toEqual({
      ok: false,
      error: "Notes must be 2,000 characters or fewer.",
    });
    expect(getNote(db, base.user.id, lessonA)).toBeUndefined();
  });

  it("refuses an over-long re-save and keeps the Note as it was", () => {
    saveNote(db, base.user.id, lessonA, "Keep me", MONDAY);

    const result = saveNote(
      db,
      base.user.id,
      lessonA,
      "a".repeat(2001),
      TUESDAY
    );

    expect(result.ok).toBe(false);
    expect(getNote(db, base.user.id, lessonA)).toEqual({
      body: "Keep me",
      updatedAt: MONDAY.toISOString(),
    });
  });

  it("deletes the Note when the box is saved empty", () => {
    saveNote(db, base.user.id, lessonA, "Delete me", MONDAY);

    const result = saveNote(db, base.user.id, lessonA, "  \n ", TUESDAY);

    expect(result).toEqual({ ok: true, note: null });
    expect(getNote(db, base.user.id, lessonA)).toBeUndefined();
    expect(listNotes(db, base.user.id)).toEqual([]);
  });

  it("stores nothing when an empty box is saved on a Lesson with no Note", () => {
    const result = saveNote(db, base.user.id, lessonA, "", MONDAY);

    expect(result).toEqual({ ok: true, note: null });
    expect(getNote(db, base.user.id, lessonA)).toBeUndefined();
  });
});

describe("the Saved lists", () => {
  it("hold only the Student's own Bookmarks, newest first, each naming its Lesson and Course", () => {
    const other = addStudent("Priya");
    toggleBookmark(db, base.user.id, lessonA, MONDAY);
    toggleBookmark(db, base.user.id, lessonB, TUESDAY);
    toggleBookmark(db, other.id, lessonA, WEDNESDAY);

    const rows = listBookmarks(db, base.user.id);

    expect(rows.map((row) => row.lessonTitle)).toEqual([
      "Lesson 2",
      "Lesson 1",
    ]);
    expect(rows[0]).toMatchObject({
      lessonId: lessonB,
      courseTitle: "Test Course",
      courseSlug: "test-course",
    });
  });

  it("hold only the Student's own Notes, most recently edited first", () => {
    const other = addStudent("Priya");
    saveNote(db, base.user.id, lessonA, "On A", MONDAY);
    saveNote(db, base.user.id, lessonB, "On B", TUESDAY);
    saveNote(db, other.id, lessonA, "Priya's private note", WEDNESDAY);
    // Editing the older Note moves it to the top.
    saveNote(db, base.user.id, lessonA, "On A, edited", WEDNESDAY);

    const rows = listNotes(db, base.user.id);

    expect(rows.map((row) => row.body)).toEqual(["On A, edited", "On B"]);
    expect(rows[0]).toMatchObject({
      lessonId: lessonA,
      lessonTitle: "Lesson 1",
      courseTitle: "Test Course",
      courseSlug: "test-course",
    });
  });
});
