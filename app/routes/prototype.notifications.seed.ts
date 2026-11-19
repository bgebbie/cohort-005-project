// PROTOTYPE, throwaway (#65). "Seed my feed": triggers the two committed Knock
// workflows with the *current* DevUI user as recipient and some other seeded
// user as actor, so the feed fills without switching users. Only sends what
// the catalogue allows for this user.
import type { Route } from "./+types/prototype.notifications.seed";
import { requireUserId } from "~/lib/access.server";
import { knock, knockUserId } from "~/lib/knock-prototype.server";
import { db } from "~/db";
import { comments, courses, lessons, modules, users, UserRole } from "~/db/schema";
import { and, desc, eq, isNull, ne } from "drizzle-orm";

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const me = db.select().from(users).where(eq(users.id, userId)).get()!;
  const recipient = { id: knockUserId(me.id), name: me.name, email: me.email };
  const others = db.select().from(users).where(ne(users.id, me.id)).all();
  const pick = () => others[Math.floor(Math.random() * others.length)];
  const triggered: string[] = [];
  const skipped: string[] = [];

  // Discussion Reply: only for a question I actually asked.
  const question = db
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
    .where(
      and(
        isNull(comments.parentId),
        isNull(comments.deletedAt),
        eq(comments.userId, me.id)
      )
    )
    .orderBy(desc(comments.createdAt))
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
    skipped.push("Discussion Reply: you haven't asked a Discussion Question");
  }

  // New Enrollment goes to the course's Instructor only, and only lands if
  // their Enrollment preference is on.
  const course =
    me.role === UserRole.Instructor
      ? db.select().from(courses).where(eq(courses.instructorId, me.id)).get()
      : undefined;
  if (!course) {
    skipped.push("New Enrollment: only for an Instructor with a course");
  } else {
    const students = others.filter((u) => u.role === UserRole.Student);
    const student = students[Math.floor(Math.random() * students.length)];
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
