import { and, eq } from "drizzle-orm";
import { coupons, purchases, enrollments } from "~/db/schema";
import { getSeatAvailability, type Db } from "~/lib/refunds.server";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Queryable = Db | Tx;

type Enrollment = typeof enrollments.$inferSelect;
type Purchase = typeof purchases.$inferSelect;

function findEnrollment(db: Queryable, userId: number, courseId: number) {
  return db
    .select()
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .get();
}

export type IndividualPurchaseInput = {
  userId: number;
  courseId: number;
  amountPaid: number;
  country: string | null;
};

export type EnrollFromIndividualPurchaseResult =
  | { ok: true; purchase: Purchase; enrollment: Enrollment }
  | { ok: false; reason: "already_enrolled" };

/**
 * Records an Individual Purchase and gives the buyer an Enrollment on the
 * course. Refused, with no Purchase recorded, if the buyer is already
 * enrolled. A Lapsed Student has no Enrollment, so they can enroll again.
 */
export function enrollFromIndividualPurchase(
  db: Db,
  input: IndividualPurchaseInput,
  now: Date
): EnrollFromIndividualPurchaseResult {
  return db.transaction((tx): EnrollFromIndividualPurchaseResult => {
    if (findEnrollment(tx, input.userId, input.courseId)) {
      return { ok: false, reason: "already_enrolled" };
    }

    const purchase = tx
      .insert(purchases)
      .values({
        userId: input.userId,
        courseId: input.courseId,
        amountPaid: input.amountPaid,
        country: input.country,
        createdAt: now.toISOString(),
      })
      .returning()
      .get();

    const enrollment = tx
      .insert(enrollments)
      .values({
        userId: input.userId,
        courseId: input.courseId,
        enrolledAt: now.toISOString(),
      })
      .returning()
      .get();

    return { ok: true, purchase, enrollment };
  });
}

export const SEAT_ON_HOLD =
  "This seat can't be claimed right now. Ask the person who shared it with you.";
export const SEAT_REFUNDED =
  "This seat is no longer available. Ask the person who shared it with you.";

export type SeatClaimInput = {
  code: string;
  userId: number;
  country: string | null;
};

export type ClaimSeatResult =
  | { ok: true; enrollment: Enrollment }
  | { ok: false; error: string };

/**
 * A Student claims a Seat on a Team Licence by its code, which gives them an
 * Enrollment on the course.
 */
export function claimSeat(
  db: Db,
  input: SeatClaimInput,
  now: Date
): ClaimSeatResult {
  return db.transaction((tx): ClaimSeatResult => {
    const seat = tx
      .select()
      .from(coupons)
      .where(eq(coupons.code, input.code))
      .get();
    if (!seat) {
      return { ok: false, error: "Coupon not found" };
    }

    if (seat.redeemedByUserId !== null) {
      return { ok: false, error: "Coupon has already been redeemed" };
    }

    const availability = getSeatAvailability(tx, seat);
    if (availability === "on_hold") {
      return { ok: false, error: SEAT_ON_HOLD };
    }
    if (availability === "refunded") {
      return { ok: false, error: SEAT_REFUNDED };
    }

    if (findEnrollment(tx, input.userId, seat.courseId)) {
      return { ok: false, error: "You are already enrolled in this course" };
    }

    // A Purchase with no recorded country can be claimed from anywhere. One
    // with a country needs the Student to be in it; an unknown country
    // doesn't match.
    const purchase = tx
      .select()
      .from(purchases)
      .where(eq(purchases.id, seat.purchaseId))
      .get();
    if (purchase?.country && purchase.country !== (input.country ?? "")) {
      return {
        ok: false,
        error:
          "This coupon can only be redeemed from the same country as the purchaser",
      };
    }

    tx.update(coupons)
      .set({ redeemedByUserId: input.userId, redeemedAt: now.toISOString() })
      .where(eq(coupons.id, seat.id))
      .run();

    const enrollment = tx
      .insert(enrollments)
      .values({
        userId: input.userId,
        courseId: seat.courseId,
        enrolledAt: now.toISOString(),
      })
      .returning()
      .get();

    return { ok: true, enrollment };
  });
}
