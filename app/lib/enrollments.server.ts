import { and, count, eq, isNull } from "drizzle-orm";
import { coupons, courses, purchases, enrollments, users } from "~/db/schema";
import {
  notify,
  type NotificationPort,
  type NotificationUser,
} from "~/lib/notifications.server";
import { getSeatAvailability, type Db } from "~/lib/refunds.server";

// ─── Enrollments ───
// Enrollment from an Individual Purchase, and Seat claims on a Team Licence.
// See GLOSSARY.md. Every function takes the database first and `now` last; a
// function that sends Notifications takes the NotificationPort second and
// sends them after its transaction commits.

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Queryable = Db | Tx;

type Enrollment = typeof enrollments.$inferSelect;
type Purchase = typeof purchases.$inferSelect;
type Seat = typeof coupons.$inferSelect;

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
 *
 * Once the claim commits, the Team Licence's buyer gets a Seat claim
 * Notification. A refused claim sends nothing.
 */
export async function claimSeat(
  db: Db,
  notifications: NotificationPort,
  input: SeatClaimInput,
  now: Date
): Promise<ClaimSeatResult> {
  const claimed = claimSeatInTransaction(db, input, now);
  if (!claimed.ok) return claimed;

  await notifySeatClaimed(db, notifications, claimed.seat, input.userId);

  return { ok: true, enrollment: claimed.enrollment };
}

type SeatClaimed =
  | { ok: true; enrollment: Enrollment; seat: Seat }
  | { ok: false; error: string };

function claimSeatInTransaction(
  db: Db,
  input: SeatClaimInput,
  now: Date
): SeatClaimed {
  return db.transaction((tx): SeatClaimed => {
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

    return { ok: true, enrollment, seat };
  });
}

/** Sends the Seat claim Notification to the Team Licence's buyer. */
async function notifySeatClaimed(
  db: Db,
  notifications: NotificationPort,
  seat: Seat,
  claimerId: number
) {
  const teamLicence = db
    .select({ buyerId: purchases.userId, courseTitle: courses.title })
    .from(purchases)
    .innerJoin(courses, eq(courses.id, purchases.courseId))
    .where(eq(purchases.id, seat.purchaseId))
    .get();
  const buyer = teamLicence && getNotificationUser(db, teamLicence.buyerId);
  const claimer = getNotificationUser(db, claimerId);
  if (!teamLicence || !buyer || !claimer) return;
  // Never about the recipient's own action.
  if (buyer.id === claimer.id) return;

  await notify(notifications, {
    notification: "SeatClaimed",
    recipients: [buyer],
    actor: claimer,
    data: {
      claimerName: claimer.name,
      courseTitle: teamLicence.courseTitle,
      seatsLeft: countSeatsLeft(db, seat.purchaseId),
      link: "/team",
      seatId: seat.id,
    },
    idempotencyKey: `seat-claimed:${seat.id}`,
  });
}

/** Unclaimed Seats on a Team Licence that can still be claimed. */
function countSeatsLeft(db: Db, purchaseId: number): number {
  const row = db
    .select({ seatsLeft: count() })
    .from(coupons)
    .where(
      and(
        eq(coupons.purchaseId, purchaseId),
        isNull(coupons.redeemedByUserId),
        isNull(coupons.refundedAt)
      )
    )
    .get();
  return row?.seatsLeft ?? 0;
}

function getNotificationUser(
  db: Db,
  userId: number
): NotificationUser | undefined {
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get();
}
