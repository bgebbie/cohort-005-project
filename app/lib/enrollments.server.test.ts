import { describe, it, expect, beforeEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { claimSeat, enrollFromIndividualPurchase } from "./enrollments.server";
import {
  fakeNotificationPort,
  type FakeNotificationPort,
  type NotificationPort,
} from "./notifications.server";
import { approveRefundRequest, raiseRefundRequest } from "./refunds.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let platformAdmin: typeof schema.users.$inferSelect;
let notifications: FakeNotificationPort;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  notifications = fakeNotificationPort();
  platformAdmin = db
    .insert(schema.users)
    .values({ name: "Pat Admin", email: "pat@example.com", role: UserRole.Admin })
    .returning()
    .get();
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

function enrollmentsOf(userId: number) {
  return db
    .select()
    .from(schema.enrollments)
    .where(
      and(
        eq(schema.enrollments.userId, userId),
        eq(schema.enrollments.courseId, base.course.id)
      )
    )
    .all();
}

function purchasesOf(userId: number) {
  return db
    .select()
    .from(schema.purchases)
    .where(eq(schema.purchases.userId, userId))
    .all();
}

describe("enrolling after an Individual Purchase", () => {
  it("records the Purchase and gives the buyer an Enrollment", () => {
    const student = addStudent("Ada");

    const result = enrollFromIndividualPurchase(
      db,
      {
        userId: student.id,
        courseId: base.course.id,
        amountPaid: 4900,
        country: "IN",
      },
      NOW
    );

    expect(result.ok).toBe(true);
    expect(purchasesOf(student.id)).toEqual([
      expect.objectContaining({
        courseId: base.course.id,
        amountPaid: 4900,
        country: "IN",
        createdAt: NOW.toISOString(),
      }),
    ]);
    expect(enrollmentsOf(student.id)).toEqual([
      expect.objectContaining({ enrolledAt: NOW.toISOString() }),
    ]);
  });

  it("refuses a Student who is already enrolled, recording no Purchase", () => {
    const student = addStudent("Ada");
    buy(student.id);

    const result = buy(student.id);

    expect(result).toEqual({ ok: false, reason: "already_enrolled" });
    expect(purchasesOf(student.id)).toHaveLength(1);
    expect(enrollmentsOf(student.id)).toHaveLength(1);
  });

  it("lets a Lapsed Student enroll again", async () => {
    const student = addStudent("Ada");
    const first = buy(student.id);
    if (!first.ok) throw new Error("first purchase refused");
    await lapse(first.purchase.id, student.id);
    expect(enrollmentsOf(student.id)).toHaveLength(0);

    const result = buy(student.id);

    expect(result.ok).toBe(true);
    expect(purchasesOf(student.id)).toHaveLength(2);
    expect(enrollmentsOf(student.id)).toHaveLength(1);
  });
});

describe("claiming a Seat", () => {
  it("claims the Seat for the Student and gives them an Enrollment", async () => {
    const teamAdmin = addStudent("Tess");
    const student = addStudent("Ada");
    const [seat] = buySeats(teamAdmin.id, 2, "GB");

    const result = await claim(seat.code, student.id, "GB");

    expect(result.ok).toBe(true);
    expect(getSeat(seat.id)).toEqual(
      expect.objectContaining({
        redeemedByUserId: student.id,
        redeemedAt: NOW.toISOString(),
      })
    );
    expect(enrollmentsOf(student.id)).toEqual([
      expect.objectContaining({ enrolledAt: NOW.toISOString() }),
    ]);
  });

  it("refuses a Seat that is already claimed", async () => {
    const teamAdmin = addStudent("Tess");
    const first = addStudent("Ada");
    const second = addStudent("Bob");
    const [seat] = buySeats(teamAdmin.id, 1, null);
    await claim(seat.code, first.id, null);

    const result = await claim(seat.code, second.id, null);

    expect(result).toEqual({
      ok: false,
      error: "Coupon has already been redeemed",
    });
    expect(getSeat(seat.id)?.redeemedByUserId).toBe(first.id);
    expect(enrollmentsOf(second.id)).toHaveLength(0);
    // Only the first, successful claim was notified.
    expect(notifications.triggers.map((t) => t.actor?.id)).toEqual([first.id]);
  });

  it("refuses a Seat on hold while its Team Licence has an Open Refund Request", async () => {
    const teamAdmin = addStudent("Tess");
    const student = addStudent("Ada");
    const [seat] = buySeats(teamAdmin.id, 2, null);
    await raiseOn(seat.purchaseId, teamAdmin.id);

    const result = await claim(seat.code, student.id, null);

    expect(result).toEqual({
      ok: false,
      error:
        "This seat can't be claimed right now. Ask the person who shared it with you.",
    });
    expect(getSeat(seat.id)?.redeemedByUserId).toBeNull();
    expect(enrollmentsOf(student.id)).toHaveLength(0);
    expect(notifications.triggers).toEqual([]);
  });

  it("refuses a Seat whose Team Licence was refunded", async () => {
    const teamAdmin = addStudent("Tess");
    const student = addStudent("Ada");
    const [seat] = buySeats(teamAdmin.id, 2, null);
    const refundRequestId = await raiseOn(seat.purchaseId, teamAdmin.id);
    await approve(refundRequestId);

    const result = await claim(seat.code, student.id, null);

    expect(result).toEqual({
      ok: false,
      error:
        "This seat is no longer available. Ask the person who shared it with you.",
    });
    expect(getSeat(seat.id)?.redeemedByUserId).toBeNull();
    expect(enrollmentsOf(student.id)).toHaveLength(0);
    expect(notifications.triggers).toEqual([]);
  });

  it("refuses a Student who is already enrolled on the course", async () => {
    const teamAdmin = addStudent("Tess");
    const student = addStudent("Ada");
    buy(student.id);
    const [seat] = buySeats(teamAdmin.id, 1, null);

    const result = await claim(seat.code, student.id, null);

    expect(result).toEqual({
      ok: false,
      error: "You are already enrolled in this course",
    });
    expect(getSeat(seat.id)?.redeemedByUserId).toBeNull();
    expect(enrollmentsOf(student.id)).toHaveLength(1);
    expect(notifications.triggers).toEqual([]);
  });

  it.each([
    ["a different country", "IN"],
    ["an unknown country", null],
  ])(
    "refuses a claim from %s when the Purchase recorded one",
    async (_label, studentCountry) => {
      const teamAdmin = addStudent("Tess");
      const student = addStudent("Ada");
      const [seat] = buySeats(teamAdmin.id, 1, "GB");

      const result = await claim(seat.code, student.id, studentCountry);

      expect(result).toEqual({
        ok: false,
        error:
          "This coupon can only be redeemed from the same country as the purchaser",
      });
      expect(getSeat(seat.id)?.redeemedByUserId).toBeNull();
      expect(enrollmentsOf(student.id)).toHaveLength(0);
      expect(notifications.triggers).toEqual([]);
    }
  );

  it("lets a Seat be claimed from anywhere when the Purchase recorded no country", async () => {
    const teamAdmin = addStudent("Tess");
    const student = addStudent("Ada");
    const [seat] = buySeats(teamAdmin.id, 1, null);

    const result = await claim(seat.code, student.id, "IN");

    expect(result.ok).toBe(true);
    expect(enrollmentsOf(student.id)).toHaveLength(1);
  });

  it("refuses a code that matches no Seat", async () => {
    const student = addStudent("Ada");

    const result = await claim("NO-SUCH-SEAT", student.id, null);

    expect(result).toEqual({ ok: false, error: "Coupon not found" });
    expect(enrollmentsOf(student.id)).toHaveLength(0);
    expect(notifications.triggers).toEqual([]);
  });

  it("lets a Lapsed Student enroll again by claiming a Seat", async () => {
    const teamAdmin = addStudent("Tess");
    const student = addStudent("Ada");
    const bought = buy(student.id);
    if (!bought.ok) throw new Error("purchase refused");
    await lapse(bought.purchase.id, student.id);
    const [seat] = buySeats(teamAdmin.id, 1, null);

    const result = await claim(seat.code, student.id, null);

    expect(result.ok).toBe(true);
    expect(getSeat(seat.id)?.redeemedByUserId).toBe(student.id);
    expect(enrollmentsOf(student.id)).toHaveLength(1);
  });
});

describe("the Seat claim Notification", () => {
  it("tells the Team Licence's buyer who claimed a Seat and how many are left", async () => {
    const teamAdmin = addStudent("Tess");
    const student = addStudent("Ada");
    const [seat] = buySeats(teamAdmin.id, 3, null);

    const result = await claim(seat.code, student.id, null);

    expect(result.ok).toBe(true);
    expect(notifications.triggers).toEqual([
      {
        notification: "SeatClaimed",
        recipients: [
          {
            id: teamAdmin.id,
            name: "Tess",
            email: "tess@example.com",
            avatarUrl: null,
          },
        ],
        actor: {
          id: student.id,
          name: "Ada",
          email: "ada@example.com",
          avatarUrl: null,
        },
        data: {
          claimerName: "Ada",
          courseTitle: "Test Course",
          seatsLeft: 2,
          link: "/team",
          seatId: seat.id,
        },
        idempotencyKey: `seat-claimed:${seat.id}`,
      },
    ]);
  });

  it("sends one Notification per claim, down to the last Seat", async () => {
    const teamAdmin = addStudent("Tess");
    const [first, last] = buySeats(teamAdmin.id, 2, null);

    await claim(first.code, addStudent("Ada").id, null);
    await claim(last.code, addStudent("Bob").id, null);

    expect(
      notifications.triggers.map((t) => [
        t.idempotencyKey,
        t.notification === "SeatClaimed" && t.data.seatsLeft,
      ])
    ).toEqual([
      [`seat-claimed:${first.id}`, 1],
      [`seat-claimed:${last.id}`, 0],
    ]);
  });

  it("sends nothing when the buyer claims a Seat on their own Team Licence", async () => {
    const teamAdmin = addStudent("Tess");
    const [seat] = buySeats(teamAdmin.id, 2, null);

    const result = await claim(seat.code, teamAdmin.id, null);

    expect(result.ok).toBe(true);
    expect(notifications.triggers).toEqual([]);
  });

  it("still claims the Seat when the Notification fails, and logs the failure", async () => {
    const teamAdmin = addStudent("Tess");
    const student = addStudent("Ada");
    const [seat] = buySeats(teamAdmin.id, 1, null);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing: NotificationPort = {
      trigger: async () => {
        throw new Error("Knock is down");
      },
    };

    const result = await claim(seat.code, student.id, null, failing);

    expect(result.ok).toBe(true);
    expect(getSeat(seat.id)?.redeemedByUserId).toBe(student.id);
    expect(enrollmentsOf(student.id)).toHaveLength(1);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

async function approve(refundRequestId: number) {
  const approved = await approveRefundRequest(
    db,
    fakeNotificationPort(),
    refundRequestId,
    platformAdmin.id,
    null,
    NOW
  );
  if (!approved.ok) throw new Error(approved.error);
}

async function raiseOn(purchaseId: number, buyerId: number) {
  const raised = await raiseRefundRequest(
    db,
    fakeNotificationPort(),
    purchaseId,
    buyerId,
    "It was not what I expected.",
    NOW
  );
  if (!raised.ok) throw new Error(raised.error);
  return raised.refundRequestId;
}

function buySeats(buyerId: number, count: number, country: string | null) {
  const team = db.insert(schema.teams).values({}).returning().get();
  const purchase = db
    .insert(schema.purchases)
    .values({
      userId: buyerId,
      courseId: base.course.id,
      amountPaid: 7900 * count,
      country,
      createdAt: NOW.toISOString(),
    })
    .returning()
    .get();
  return Array.from({ length: count }, (_, i) =>
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
}

function getSeat(seatId: number) {
  return db
    .select()
    .from(schema.coupons)
    .where(eq(schema.coupons.id, seatId))
    .get();
}

function claim(
  code: string,
  userId: number,
  country: string | null,
  port: NotificationPort = notifications
) {
  return claimSeat(db, port, { code, userId, country }, NOW);
}

/** Approves a Refund Request on the Individual Purchase, so the buyer lapses. */
async function lapse(purchaseId: number, buyerId: number) {
  const raised = await raiseRefundRequest(
    db,
    fakeNotificationPort(),
    purchaseId,
    buyerId,
    "It was not what I expected.",
    NOW
  );
  if (!raised.ok) throw new Error(raised.error);
  const approved = await approveRefundRequest(
    db,
    fakeNotificationPort(),
    raised.refundRequestId,
    platformAdmin.id,
    null,
    NOW
  );
  if (!approved.ok) throw new Error(approved.error);
}

function buy(userId: number, amountPaid = 7900) {
  return enrollFromIndividualPurchase(
    db,
    { userId, courseId: base.course.id, amountPaid, country: null },
    NOW
  );
}
