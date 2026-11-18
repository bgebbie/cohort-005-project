// PROTOTYPE — throwaway. Spike for "Does Knock hold up against Cadence?" (issue #46).
// Lives on the prototype/knock-spike branch only; never merged.
import Knock, { signUserToken } from "@knocklabs/node";
import { eq } from "drizzle-orm";
import { db } from "~/db";
import { comments, lessons, users } from "~/db/schema";

// KNOCK_API_KEY (secret) is read from the env by default.
export const knock = new Knock();

export function knockUserId(userId: number) {
  return `cadence-user-${userId}`;
}

function inlineUser(userId: number) {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) throw new Error(`No user ${userId}`);
  return { id: knockUserId(user.id), name: user.name, email: user.email };
}

export async function identifyAndSign(userId: number) {
  const u = inlineUser(userId);
  await knock.users.update(u.id, { name: u.name, email: u.email });
  const token = await signUserToken(u.id, { expiresInSeconds: 60 * 60 });
  return { knockId: u.id, token };
}

// Fired from the real reply paths. Fire-and-forget; logs the outcome.
export function triggerDiscussionReplyPrototype(reply: {
  id: number;
  userId: number;
  lessonId: number;
  parentId: number | null;
  body: string;
}) {
  if (reply.parentId === null) return;
  const parent = db
    .select()
    .from(comments)
    .where(eq(comments.id, reply.parentId))
    .get();
  if (!parent || parent.userId === reply.userId) return;
  const lesson = db
    .select()
    .from(lessons)
    .where(eq(lessons.id, reply.lessonId))
    .get();

  knock.workflows
    .trigger("discussion-reply", {
      recipients: [inlineUser(parent.userId)],
      actor: inlineUser(reply.userId),
      data: {
        lesson_title: lesson?.title ?? "a lesson",
        reply_excerpt: reply.body.slice(0, 140),
        question_id: parent.id,
        reply_id: reply.id,
      },
    })
    .then((r) =>
      console.log("[knock prototype] discussion-reply run", r.workflow_run_id)
    )
    .catch((e) =>
      console.error("[knock prototype] discussion-reply failed", e?.status, e?.message)
    );
}

export async function triggerNewEnrollmentPrototype(
  instructorId: number,
  studentId: number
) {
  return knock.workflows.trigger("new-enrollment", {
    recipients: [inlineUser(instructorId)],
    actor: inlineUser(studentId),
    data: { course_title: "Prototype Course", student_id: studentId },
  });
}
