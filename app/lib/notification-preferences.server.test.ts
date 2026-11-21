import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import { eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import {
  fakeNotificationPort,
  type FakeNotificationPort,
} from "./notifications.server";
import {
  listNotificationSwitches,
  saveNotificationPreference,
} from "./notification-preferences.server";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let notifications: FakeNotificationPort;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  notifications = fakeNotificationPort();
});

describe("the Notifications card's switches", () => {
  it("shows a Student with no Purchases only Discussion Replies, on by default", async () => {
    const switches = await listNotificationSwitches(
      db,
      notifications,
      base.user.id
    );

    expect(switches).toEqual([{ category: "DiscussionReplies", enabled: true }]);
  });

  it("adds Refund Request updates once someone has a Purchase", async () => {
    buyForSelf(base.user.id);

    expect(await categoriesFor(base.user.id)).toEqual([
      "RefundRequestUpdates",
      "DiscussionReplies",
    ]);
  });

  it("shows a Platform Admin Open Refund Requests", async () => {
    const admin = addUser("Pat", schema.UserRole.Admin);

    expect(await categoriesFor(admin.id)).toEqual([
      "OpenRefundRequests",
      "DiscussionReplies",
    ]);
  });

  it("shows Seat claims to whoever bought a Team Licence, whatever their role", async () => {
    buySeats(base.instructor.id, 3);

    expect(await categoriesFor(base.instructor.id)).toContain("SeatClaims");
  });

  it("shows a Team Licence buyer Refund Request updates too, since a Team Licence is a Purchase", async () => {
    buySeats(base.user.id, 3);

    expect(await categoriesFor(base.user.id)).toEqual([
      "RefundRequestUpdates",
      "SeatClaims",
      "DiscussionReplies",
    ]);
  });

  it("doesn't show Seat claims for an Individual Purchase", async () => {
    buyForSelf(base.user.id);

    expect(await categoriesFor(base.user.id)).not.toContain("SeatClaims");
  });

  it("doesn't show Seat claims to someone who only claimed a Seat on another person's Team Licence", async () => {
    const buyer = addUser("Bossy", schema.UserRole.Student);
    const { seats } = buySeats(buyer.id, 2);
    claimSeat(seats[0].id, base.user.id);

    expect(await categoriesFor(base.user.id)).toEqual(["DiscussionReplies"]);
  });

  it("shows an Instructor Enrollments, off by default, and Discussion Questions, on", async () => {
    const switches = await listNotificationSwitches(
      db,
      notifications,
      base.instructor.id
    );

    expect(switches).toEqual([
      { category: "Enrollments", enabled: false },
      { category: "DiscussionQuestions", enabled: true },
      { category: "DiscussionReplies", enabled: true },
    ]);
  });

  it("shows an Instructor who owns no course yet the Instructor switches", async () => {
    const instructor = addUser("New Instructor", schema.UserRole.Instructor);

    expect(await categoriesFor(instructor.id)).toEqual([
      "Enrollments",
      "DiscussionQuestions",
      "DiscussionReplies",
    ]);
  });

  it("shows the Instructor switches to a Platform Admin who owns a course", async () => {
    const admin = addUser("Pat", schema.UserRole.Admin);
    addCourse(admin.id);

    expect(await categoriesFor(admin.id)).toEqual([
      "OpenRefundRequests",
      "Enrollments",
      "DiscussionQuestions",
      "DiscussionReplies",
    ]);
  });

  it("shows the person's saved choices, and the default for anything they haven't chosen", async () => {
    notifications.preferences.set(base.instructor.id, {
      Enrollments: { feed: true },
      DiscussionReplies: { feed: false },
    });

    const switches = await listNotificationSwitches(
      db,
      notifications,
      base.instructor.id
    );

    expect(switches).toEqual([
      { category: "Enrollments", enabled: true },
      { category: "DiscussionQuestions", enabled: true },
      { category: "DiscussionReplies", enabled: false },
    ]);
  });

  it("throws when the preferences can't be read", async () => {
    notifications.readPreferences = async () => {
      throw new Error("Knock is down");
    };

    await expect(
      listNotificationSwitches(db, notifications, base.user.id)
    ).rejects.toThrow("Knock is down");
  });
});

describe("flipping a switch", () => {
  it("saves that one category and leaves every other choice alone", async () => {
    notifications.preferences.set(base.instructor.id, {
      Enrollments: { feed: true },
      DiscussionReplies: { feed: false },
    });

    const result = await saveNotificationPreference(
      db,
      notifications,
      base.instructor.id,
      "DiscussionQuestions",
      false
    );

    expect(result).toEqual({ ok: true, enabled: false });
    expect(notifications.preferenceWrites).toEqual([
      {
        userId: base.instructor.id,
        preferences: {
          RefundRequestUpdates: { feed: true },
          OpenRefundRequests: { feed: true },
          SeatClaims: { feed: true },
          Enrollments: { feed: true },
          DiscussionQuestions: { feed: false },
          DiscussionReplies: { feed: false },
        },
      },
    ]);
  });

  it("can turn a category back on", async () => {
    notifications.preferences.set(base.user.id, {
      DiscussionReplies: { feed: false },
    });

    await saveNotificationPreference(
      db,
      notifications,
      base.user.id,
      "DiscussionReplies",
      true
    );

    const switches = await listNotificationSwitches(
      db,
      notifications,
      base.user.id
    );
    expect(switches).toEqual([{ category: "DiscussionReplies", enabled: true }]);
  });

  it("refuses a category whose switch the person doesn't see, and writes nothing", async () => {
    const result = await saveNotificationPreference(
      db,
      notifications,
      base.user.id,
      "OpenRefundRequests",
      false
    );

    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(notifications.preferenceWrites).toEqual([]);
  });

  it("throws when the save fails, so the switch can go back", async () => {
    notifications.writePreferences = async () => {
      throw new Error("Knock is down");
    };

    await expect(
      saveNotificationPreference(
        db,
        notifications,
        base.user.id,
        "DiscussionReplies",
        false
      )
    ).rejects.toThrow("Knock is down");
  });
});

function addUser(name: string, role: schema.UserRole) {
  return db
    .insert(schema.users)
    .values({ name, email: `${name.replace(/\s/g, "")}@example.com`, role })
    .returning()
    .get();
}

function addCourse(instructorId: number) {
  return db
    .insert(schema.courses)
    .values({
      title: "Another Course",
      slug: `another-course-${instructorId}`,
      description: "Another course",
      salesCopy: "Another course",
      instructorId,
      categoryId: base.category.id,
      status: schema.CourseStatus.Published,
    })
    .returning()
    .get();
}

function buySeats(userId: number, seats: number) {
  const team = db.insert(schema.teams).values({}).returning().get();
  const purchase = buyForSelf(userId);
  const seatRows = Array.from({ length: seats }, (_, i) =>
    db
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code: `SEAT-${purchase.id}-${i}`,
        purchaseId: purchase.id,
      })
      .returning()
      .get()
  );
  return { purchase, seats: seatRows };
}

function claimSeat(seatId: number, userId: number) {
  db.update(schema.coupons)
    .set({ redeemedByUserId: userId, redeemedAt: new Date().toISOString() })
    .where(eq(schema.coupons.id, seatId))
    .run();
  db.insert(schema.enrollments)
    .values({ userId, courseId: base.course.id })
    .run();
}

function buyForSelf(userId: number) {
  return db
    .insert(schema.purchases)
    .values({ userId, courseId: base.course.id, amountPaid: 7900 })
    .returning()
    .get();
}

async function categoriesFor(userId: number) {
  const switches = await listNotificationSwitches(db, notifications, userId);
  return switches.map((s) => s.category);
}
