import { describe, it, expect, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { claimSeat, enrollFromIndividualPurchase } from "./enrollments.server";
import { approveRefundRequest, raiseRefundRequest } from "./refunds.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let platformAdmin: typeof schema.users.$inferSelect;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
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

  it("lets a Lapsed Student enroll again", () => {
    const student = addStudent("Ada");
    const first = buy(student.id);
    if (!first.ok) throw new Error("first purchase refused");
    lapse(first.purchase.id, student.id);
    expect(enrollmentsOf(student.id)).toHaveLength(0);

    const result = buy(student.id);

    expect(result.ok).toBe(true);
    expect(purchasesOf(student.id)).toHaveLength(2);
    expect(enrollmentsOf(student.id)).toHaveLength(1);
  });
});

describe("claiming a Seat", () => {
  it("claims the Seat for the Student and gives them an Enrollment", () => {
    const teamAdmin = addStudent("Tess");
    const student = addStudent("Ada");
    const [seat] = buySeats(teamAdmin.id, 2, "GB");

    const result = claim(seat.code, student.id, "GB");

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

  it("refuses a Seat that is already claimed", () => {
    const teamAdmin = addStudent("Tess");
    const first = addStudent("Ada");
    const second = addStudent("Bob");
    const [seat] = buySeats(teamAdmin.id, 1, null);
    claim(seat.code, first.id, null);

    const result = claim(seat.code, second.id, null);

    expect(result).toEqual({
      ok: false,
      error: "Coupon has already been redeemed",
    });
    expect(getSeat(seat.id)?.redeemedByUserId).toBe(first.id);
    expect(enrollmentsOf(second.id)).toHaveLength(0);
  });

  it("refuses a Seat on hold while its Team Licence has an Open Refund Request", () => {
    const teamAdmin = addStudent("Tess");
    const student = addStudent("Ada");
    const [seat] = buySeats(teamAdmin.id, 2, null);
    raiseOn(seat.purchaseId, teamAdmin.id);

    const result = claim(seat.code, student.id, null);

    expect(result).toEqual({
      ok: false,
      error:
        "This seat can't be claimed right now. Ask the person who shared it with you.",
    });
    expect(getSeat(seat.id)?.redeemedByUserId).toBeNull();
    expect(enrollmentsOf(student.id)).toHaveLength(0);
  });

  it("refuses a Seat whose Team Licence was refunded", () => {
    const teamAdmin = addStudent("Tess");
    const student = addStudent("Ada");
    const [seat] = buySeats(teamAdmin.id, 2, null);
    const refundRequestId = raiseOn(seat.purchaseId, teamAdmin.id);
    approve(refundRequestId);

    const result = claim(seat.code, student.id, null);

    expect(result).toEqual({
      ok: false,
      error:
        "This seat is no longer available. Ask the person who shared it with you.",
    });
    expect(getSeat(seat.id)?.redeemedByUserId).toBeNull();
    expect(enrollmentsOf(student.id)).toHaveLength(0);
  });

  it("refuses a Student who is already enrolled on the course", () => {
    const teamAdmin = addStudent("Tess");
    const student = addStudent("Ada");
    buy(student.id);
    const [seat] = buySeats(teamAdmin.id, 1, null);

    const result = claim(seat.code, student.id, null);

    expect(result).toEqual({
      ok: false,
      error: "You are already enrolled in this course",
    });
    expect(getSeat(seat.id)?.redeemedByUserId).toBeNull();
    expect(enrollmentsOf(student.id)).toHaveLength(1);
  });

  it.each([
    ["a different country", "IN"],
    ["an unknown country", null],
  ])(
    "refuses a claim from %s when the Purchase recorded one",
    (_label, studentCountry) => {
      const teamAdmin = addStudent("Tess");
      const student = addStudent("Ada");
      const [seat] = buySeats(teamAdmin.id, 1, "GB");

      const result = claim(seat.code, student.id, studentCountry);

      expect(result).toEqual({
        ok: false,
        error:
          "This coupon can only be redeemed from the same country as the purchaser",
      });
      expect(getSeat(seat.id)?.redeemedByUserId).toBeNull();
      expect(enrollmentsOf(student.id)).toHaveLength(0);
    }
  );

  it("lets a Seat be claimed from anywhere when the Purchase recorded no country", () => {
    const teamAdmin = addStudent("Tess");
    const student = addStudent("Ada");
    const [seat] = buySeats(teamAdmin.id, 1, null);

    const result = claim(seat.code, student.id, "IN");

    expect(result.ok).toBe(true);
    expect(enrollmentsOf(student.id)).toHaveLength(1);
  });

  it("refuses a code that matches no Seat", () => {
    const student = addStudent("Ada");

    const result = claim("NO-SUCH-SEAT", student.id, null);

    expect(result).toEqual({ ok: false, error: "Coupon not found" });
    expect(enrollmentsOf(student.id)).toHaveLength(0);
  });

  it("lets a Lapsed Student enroll again by claiming a Seat", () => {
    const teamAdmin = addStudent("Tess");
    const student = addStudent("Ada");
    const bought = buy(student.id);
    if (!bought.ok) throw new Error("purchase refused");
    lapse(bought.purchase.id, student.id);
    const [seat] = buySeats(teamAdmin.id, 1, null);

    const result = claim(seat.code, student.id, null);

    expect(result.ok).toBe(true);
    expect(getSeat(seat.id)?.redeemedByUserId).toBe(student.id);
    expect(enrollmentsOf(student.id)).toHaveLength(1);
  });
});

function approve(refundRequestId: number) {
  const approved = approveRefundRequest(
    db,
    refundRequestId,
    platformAdmin.id,
    null,
    NOW
  );
  if (!approved.ok) throw new Error(approved.error);
}

function raiseOn(purchaseId: number, buyerId: number) {
  const raised = raiseRefundRequest(
    db,
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

function claim(code: string, userId: number, country: string | null) {
  return claimSeat(db, { code, userId, country }, NOW);
}

/** Approves a Refund Request on the Individual Purchase, so the buyer lapses. */
function lapse(purchaseId: number, buyerId: number) {
  const raised = raiseRefundRequest(
    db,
    purchaseId,
    buyerId,
    "It was not what I expected.",
    NOW
  );
  if (!raised.ok) throw new Error(raised.error);
  const approved = approveRefundRequest(
    db,
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
