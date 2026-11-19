// PROTOTYPE, throwaway (#65). "Seed my feed": triggers the two committed Knock
// workflows with the *current* DevUI user as recipient and some other seeded
// user as actor, so the feed fills without switching users.
import type { Route } from "./+types/prototype.notifications.seed";
import { requireUserId } from "~/lib/access.server";
import { knock, knockUserId } from "~/lib/knock-prototype.server";
import { db } from "~/db";
import { comments, courses, lessons, modules, users } from "~/db/schema";
import { and, desc, eq, isNull, ne } from "drizzle-orm";

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const me = db.select().from(users).where(eq(users.id, userId)).get()!;
  const recipient = { id: knockUserId(me.id), name: me.name, email: me.email };
  const others = db.select().from(users).where(ne(users.id, me.id)).all();
  const pick = () => others[Math.floor(Math.random() * others.length)];
  const triggered: string[] = [];
  const skipped: string[] = [];

  // Discussion Reply: prefer a question I asked, so the link is honest.
  const question =
    db
      .select({
        id: comments.id,
        body: comments.body,
        lessonId: lessons.id,
        lessonTitle: lessons.title,
        slug: courses.slug,
      })
      .from(comments)
      .innerJoin(lessons, eq(lessons.id, comments.lessonId))
      .innerJoin(modules, eq(modules.id, lessons.moduleId))
      .innerJoin(courses, eq(courses.id, modules.courseId))
      .where(and(isNull(comments.parentId), eq(comments.userId, me.id)))
      .orderBy(desc(comments.createdAt))
      .get() ??
    db
      .select({
        id: comments.id,
        body: comments.body,
        lessonId: lessons.id,
        lessonTitle: lessons.title,
        slug: courses.slug,
      })
      .from(comments)
      .innerJoin(lessons, eq(lessons.id, comments.lessonId))
      .innerJoin(modules, eq(modules.id, lessons.moduleId))
      .innerJoin(courses, eq(courses.id, modules.courseId))
      .where(isNull(comments.parentId))
      .get();

  if (question) {
    const replier = pick();
    await knock.workflows.trigger("discussion-reply", {
      recipients: [recipient],
      actor: { id: knockUserId(replier.id), name: replier.name, email: replier.email },
      data: {
        questionId: question.id,
        questionExcerpt: question.body.slice(0, 80),
        replyExcerpt: "Good question! Have a look at the second example in the lesson notes.",
        lessonTitle: question.lessonTitle,
        replierName: replier.name,
        url: `/courses/${question.slug}/lessons/${question.lessonId}`,
      },
    });
    triggered.push(`Discussion Reply from ${replier.name}`);
  } else {
    skipped.push("no Discussion Question in the seed data");
  }

  // New Enrollment: only lands if this user's enrollment preference is on.
  const course =
    db.select().from(courses).where(eq(courses.instructorId, me.id)).get() ??
    db.select().from(courses).get();
  if (course) {
    const student = pick();
    await knock.workflows.trigger("new-enrollment", {
      recipients: [recipient],
      actor: { id: knockUserId(student.id), name: student.name, email: student.email },
      data: {
        courseId: course.id,
        courseTitle: course.title,
        studentName: student.name,
        url: `/instructor/${course.id}/students`,
      },
    });
    triggered.push(`New Enrollment by ${student.name} (lands only if Enrollment is opted in)`);
  }

  return { triggered, skipped };
}
