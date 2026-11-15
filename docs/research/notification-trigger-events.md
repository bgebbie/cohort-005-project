# Which events in Cadence could trigger a Notification?

Research for [#3](https://github.com/bgebbie/cohort-005-project/issues/3), part of the map [#1 "Map: in-app notifications"](https://github.com/bgebbie/cohort-005-project/issues/1).

This is a **candidate list, not a decision**. It records every state change in the code that a person might want to hear about, and who that person would be. It does not say which ones should ship.

- **Source:** this repo's code at commit `979e285` (local `main`). Every `file:line` below refers to that commit.
- **Exhaustiveness:** I grepped every `.insert(`, `.update(` and `.delete(` under `app/` (tests excluded) and checked each one. Each write either appears below as a candidate, or is listed under [Not candidates](#not-candidates).
- **Language:** follows `GLOSSARY.md`. Where the code uses a term the glossary says to avoid, the code name is given in `code` font. For example, a Seat is the `coupons` table, and claiming a Seat is "redeem" in the code.

## How each recipient is found

| Recipient | How the code identifies them |
| --- | --- |
| The buyer (Student or Team Admin) | `purchases.userId` (`app/db/schema.ts:217`) |
| Instructor of a course | `courses.instructorId`, exactly one per course |
| Platform Admins | Every user with `role = UserRole.Admin` (`app/db/schema.ts:11-15`). There's no assignment, so a Notification to Platform Admins goes to all of them. |
| Team Admin | The buyer of the Team Licence (`purchases.userId`). The same person also gets a `team_members` row with `TeamMemberRole.Admin`, created on their first Team Licence (`app/routes/courses.$slug.purchase.tsx:210-219`). `TeamMemberRole.Member` is never written, so a Student who claims a Seat does **not** join the team. The Team Admin is only linked to Seat holders through `coupons.redeemedByUserId`. |
| Students enrolled on a course | `enrollments` rows for the course. Lapsed Students have no row, because approval deletes it (`app/lib/refunds.server.ts:658`, ADR 0001). A "tell everyone on the course" fan-out therefore skips them unless they're found through `lesson_progress` instead. |
| Author of a comment or question | `comments.userId`. A question is a top-level comment (`parentId` null). Replies go one level deep (`app/routes/courses.$slug.lessons.$lessonId.tsx:425`). |

## Email today

There's one email entry point, `sendEmail` (`app/lib/mailer.server.ts:67`). It sends through Postmark, or writes to `.outbox/` when there's no token. It has exactly **two callers**, and both are about Refund Requests:

- `app/routes/courses.$slug.refund.ts:75`: a Refund Request was raised. Goes to the buyer.
- `app/routes/admin.refunds.tsx:130`: a Refund Request was approved or declined. Goes to the buyer.

`enrollUser` in `app/routes/courses.$slug.purchase.tsx:145-178` takes a `sendEmail` flag, but its body is only the comment `// Would send welcome email here` (`:173-175`), and its only caller passes `false` (`:371`). No other event sends email.

## Candidates by recipient

Each table row is one candidate: a (state change, recipient) pair. Some state changes appear under more than one role.

### Student

| # | Event | Where it happens | Email already? | Edge cases |
| --- | --- | --- | --- | --- |
| S1 | Individual Purchase made, which gives an Enrollment | `app/routes/courses.$slug.purchase.tsx:370-371` | No (welcome email stub only, `:173-175`) | The Student caused it, so this is a self-notification (a receipt or welcome). The action doesn't re-check that the course is Published (the loader does, `:286`). |
| S2 | Seat claimed, which gives an Enrollment | `app/routes/redeem.$code.tsx:98-110` | No | Self-caused, like S1. The Student was invited outside Cadence (the Team Admin copies a link, `app/routes/team.tsx:172`), so before the claim there's no Cadence person to notify. |
| S3 | Your Refund Request was raised | `app/lib/refunds.server.ts:379-388`, called from `app/routes/courses.$slug.refund.ts:63` | **Yes**, to the buyer (`courses.$slug.refund.ts:75`) | Self-caused confirmation. The buyer may be a Team Admin, not a Student; see T2. |
| S4 | Your Refund Request was approved, and your Enrollment ends | `app/lib/refunds.server.ts:614-685` (Enrollment deleted at `:658`, unless you also hold a Claimed Seat for the course, `:645-657`, ADR 0004) | **Yes**, to the buyer (`admin.refunds.tsx:130`) | The email says the money "is on its way" (`refunds.server.ts:760`). The approval can carry an optional note. A Student who also holds a Claimed Seat keeps their Enrollment, so the wording "you've lost access" would be wrong for them. |
| S5 | Your Refund Request was declined | `app/lib/refunds.server.ts:692-733` | **Yes**, to the buyer (`admin.refunds.tsx:130`) | A decline always has a note (`:701-707`), which tells the buyer whether a new Refund Request is worth raising. |
| S6 | A staff member replied to your question | `app/routes/instructor.questions.tsx:211` (reply from the queue), or `app/routes/courses.$slug.lessons.$lessonId.tsx:903` (reply on the lesson page) | No | The recipient is the parent comment's author. Staff here means the owning Instructor or any Platform Admin (`app/lib/access.server.ts:99`). Skip it if the replier is the question's author. |
| S7 | Someone else replied in a thread you're part of | `app/routes/courses.$slug.lessons.$lessonId.tsx:898-909` (with `parentId` set) | No | Recipients could be the question's author only, or everyone who has replied. Exclude the replier. The question may have been soft-deleted but kept because it has replies (`:400-401`). |
| S8 | Your comment was deleted by staff | `app/routes/courses.$slug.lessons.$lessonId.tsx:459-477, 935` | No | Only when `isStaff` and the deleter isn't the author (`:464`). A self-delete isn't an event. |
| S9 | A new lesson or module was added to a course you're enrolled on | `app/routes/instructor.$courseId.tsx:753-764` (add lesson), `:722-725` (add module) | No | Fan-out to every enrolled Student, without Lapsed Students. A lesson is added empty (`createLesson(..., null, null, ...)`, `:762`) and filled in later at `app/routes/instructor.$courseId.lessons.$lessonId.tsx:207`, so "added" can come before there's anything to watch. Courses have no "lesson published" state. |
| S10 | A lesson or module you had progress on was deleted | `app/routes/instructor.$courseId.tsx:827-842` (lesson), `:740-751` (module, which deletes its lessons, `:236-240`) | No | Fan-out to enrolled Students. The thing the Notification points at is gone (see "Not yet specified" in #1). |
| S11 | A quiz was saved again or deleted, which **wipes your quiz attempts** | `app/routes/instructor.$courseId.lessons.$lessonId.quiz.tsx:399-403` (save-quiz deletes the existing quiz first), `:425-431` (delete-quiz). Attempts are removed at `:208-217`. | No | This cuts against ADR 0001, which keeps a Student's quiz attempts. Every edit of a quiz removes every Student's results for it. Recipients would be Students with an attempt on that quiz. |
| S12 | Your quiz was scored (passed or failed) | `app/routes/courses.$slug.lessons.$lessonId.tsx:602-611` | No | The result is already shown inline, so this is a self-notification. Pass or fail is `scoreValue > 0.7` (`:599`), which ignores `quizzes.passingScore`, so a "you passed" Notification would inherit that bug. |
| S13 | You completed a lesson, or the whole course | `app/routes/courses.$slug.lessons.$lessonId.tsx:947-950` (`markLessonComplete`, `:218-243`) | No | Self-caused. "Course completed" isn't stored anywhere; it would mean counting completed lessons at this point. |
| S14 | A course you're enrolled on was archived, or set back to Draft | `app/routes/instructor.$courseId.tsx:695-698` (Instructor), `app/routes/admin.courses.tsx:141-144` (Platform Admin) | No | Fan-out to enrolled Students. Content access doesn't check course status (`access.server.ts:130`), so it's unclear whether anything changes for them. |
| S15 | A Platform Admin changed your name or email | `app/routes/admin.users.tsx:119-124` | No | When the email changes, an email Notification would go to the new address. An in-app one wouldn't have that problem. Applies to any role, not only Students. |
| S16 | Your role was changed (for example, you became an Instructor) | `app/routes/admin.users.tsx:126-130` | No | Applies to any role. A Platform Admin can change their own role, which would make it a self-notification. |
| S17 | You're getting close to, or have crossed, the Watch Limit or the end of the 14-day window, so you can no longer get a Refund | Derived. Watch time is written at `app/routes/api.video-tracking.ts:29-38`; the limits live in `app/lib/refund-rules.ts`. | No | **There's no trigger point.** Nothing records the moment the Watch Limit is crossed, and nothing runs on a schedule for the window. This candidate would need a check on every watch event, or a scheduled job. |

### Instructor

| # | Event | Where it happens | Email already? | Edge cases |
| --- | --- | --- | --- | --- |
| I1 | A new Enrollment on your course from an Individual Purchase (a sale) | `app/routes/courses.$slug.purchase.tsx:370-371` | No | Self-notification if the Instructor buys their own course. Nothing blocks that. |
| I2 | A Team Licence was bought for your course | `app/routes/courses.$slug.purchase.tsx:378` | No | Gives no Enrollment, only Seats. The amount is `pppPrice * quantity` (`:377`). |
| I3 | A Seat on your course was claimed, which gives a new Enrollment | `app/routes/redeem.$code.tsx:98-110` | No | Same recipient rule as I1. |
| I4 | A new question was asked on your course | `app/routes/courses.$slug.lessons.$lessonId.tsx:898-909` (with `parentId` null) | No | Skip it if the author is the Instructor or a Platform Admin. The queue already leaves those out (`app/routes/instructor.questions.tsx:66-68`). A Platform Admin also sees every course's queue (`:176`). |
| I5 | A Student replied in a thread on your course | `app/routes/courses.$slug.lessons.$lessonId.tsx:898-909` (with `parentId` set) | No | Exclude the Instructor's own replies. If staff already answered, a reply from the Student may turn the thread back into a question that needs an answer, but the queue won't show it again (`instructor.questions.tsx:48-61`). |
| I6 | A question has waited 3 or more days without a reply | Derived. `STALE_AFTER_DAYS = 3` (`app/routes/instructor.questions.tsx:160`) is used only for display. | No | **There's no trigger point.** It would need a scheduled job. |
| I7 | Your course was rated, or a rating changed | `app/routes/courses.$slug.tsx:330-363` (insert at `:358`, update at `:350`), from the action at `:478` | No | Only enrolled Students can rate (`:465`). A change of rating is an update, so decide whether it counts. |
| I8 | A Refund Request was raised on a Purchase of your course | `app/lib/refunds.server.ts:379-388` | No (only the buyer is emailed) | The Instructor has no say over Refund Requests (the glossary says only a Platform Admin decides them), so this would be for information only. |
| I9 | A Refund Request on your course was approved, so a Student left (or Unclaimed Seats were cancelled) | `app/lib/refunds.server.ts:614-685` | No | For information only. |
| I10 | A Platform Admin changed your course's status | `app/routes/admin.courses.tsx:141-144` | No | The Instructor didn't cause it. A Platform Admin can also edit the course through the Instructor's editor (`app/routes/instructor.$courseId.tsx:669`), which would be another "someone else changed your course" event. |
| I11 | Your role was changed, for example to Instructor (S16 seen from the Instructor's side) | `app/routes/admin.users.tsx:126-130` | No | The first time someone becomes an Instructor, they can now create courses (`app/routes/instructor.new.tsx:121`). |

### Platform Admin

| # | Event | Where it happens | Email already? | Edge cases |
| --- | --- | --- | --- | --- |
| P1 | A new Refund Request needs a decision | `app/lib/refunds.server.ts:379-388`, from `app/routes/courses.$slug.refund.ts:63` | **No.** Only the buyer is emailed. Platform Admins learn about it only by opening `/admin/refunds`. | Fan-out to every Platform Admin. A Team Licence Refund Request with a Claimed Seat can only be declined (`refunds.server.ts:500-503`). |
| P2 | Another Platform Admin decided a Refund Request | `app/lib/refunds.server.ts:669-678` (approve), `:713-721` (decline) | No | The first decision wins. A second Platform Admin who tries gets a 409 (`:587-595`). Clearing the item from other Platform Admins' inboxes is the useful part. Exclude the Platform Admin who decided. |
| P3 | A new question across any course | `app/routes/courses.$slug.lessons.$lessonId.tsx:898-909` | No | The queue shows every course to a Platform Admin (`instructor.questions.tsx:176`). This could be noisy as a fan-out. |
| P4 | An Instructor published a course | `app/routes/instructor.$courseId.tsx:695-698` | No | Courses have no review or approval step, so this would be for information only. |
| P5 | An Instructor created a course (in Draft) | `app/routes/instructor.new.tsx:59-72` | No | For information only. |
| P6 | A new person signed up | `app/routes/signup.tsx:77-81` | No | Signing up with an existing email just logs that person in (`:64-74`), so that isn't an event. |
| P7 | A Purchase was made (an Individual Purchase or a Team Licence) | `app/routes/courses.$slug.purchase.tsx:370, 378` | No | For information only. |

### Team Admin

| # | Event | Where it happens | Email already? | Edge cases |
| --- | --- | --- | --- | --- |
| T1 | A Seat on your Team Licence was claimed | `app/routes/redeem.$code.tsx:98-104` | No | The recipient is `purchases.userId` for `coupons.purchaseId`. Nothing stops the Team Admin claiming one of their own Seats, so this can be a self-notification (see Surprises). Once one Seat is claimed, the Team Licence can no longer be refunded. |
| T2 | Your Team Licence Refund Request was raised | `app/lib/refunds.server.ts:379-388`, which redirects to `/team` (`courses.$slug.refund.ts:77`) | **Yes**, to the buyer (shared with S3) | While it's open, every Unclaimed Seat is on hold (`refunds.server.ts:117-118`, ADR 0003). |
| T3 | Your Team Licence Refund Request was approved, and the Unclaimed Seats are cancelled | `app/lib/refunds.server.ts:628-643` | **Yes**, to the buyer (shared with S4) | The approval email's wording is written for an Individual Purchase. It doesn't mention Seats. |
| T4 | Your Team Licence Refund Request was declined, and the Seats can be claimed again | `app/lib/refunds.server.ts:692-733` | **Yes**, to the buyer (shared with S5) | |
| T5 | Your Team Licence was bought, and its Seats are ready to share | `app/routes/courses.$slug.purchase.tsx:378` (`createTeamPurchase`, `:245-256`) | No | Self-caused receipt. |
| T6 | Someone tried to claim a Seat that's on hold or cancelled | `app/routes/redeem.$code.tsx:61-67` (fails, writes nothing) | No | It isn't a state change. The person trying is told to "ask the person who shared it with you" (`:38-41`), so the Team Admin may want to hear about it. |

**Students holding an Unclaimed Seat link**, whose Seat goes on hold (T2) or is cancelled (T3), can't be notified: Cadence doesn't know who they are until they claim.

## Not candidates

These writes exist, but nobody other than the person acting would want to hear about them:

- Category create, update and delete (`app/routes/admin.categories.tsx:90, 110, 132`)
- Reordering and moving modules and lessons, and renaming them (`app/routes/instructor.$courseId.tsx:227-234, 244, 295-302, 310-352`)
- Course title, description, sales copy, price and purchasing-power toggle edits (`app/routes/instructor.$courseId.tsx:145-192`). A price change doesn't affect existing Purchases.
- Lesson content edits (`app/routes/instructor.$courseId.lessons.$lessonId.tsx:85-90`)
- Lesson started (`markLessonInProgress`, `app/routes/courses.$slug.lessons.$lessonId.tsx:245-269`)
- Video watch events (`app/routes/api.video-tracking.ts:29`), except as input to S17
- Editing your own comment (`app/routes/courses.$slug.lessons.$lessonId.tsx:437-457`) or your own profile (`app/routes/settings.tsx:91-96`)
- DevUI user and country switching, and logout (`app/routes/api.switch-user.ts`, `api.set-dev-country.ts`, `api.logout.ts`)

## Surprises: where the code and the docs disagree

- **Refund lifecycle.** The glossary defines Pending Refund, Issued Refund and Failed Refund. The code has only `open`, `approved` and `declined` on the Refund Request (`app/db/schema.ts:34-38`). No column says the money was sent, so "your Refund was issued" or "your Refund failed" has nowhere to come from yet.
- **Team Admin can claim their own Seat.** The glossary says the buyer of a Team Licence "can't take the course through it". `redeemCoupon` (`app/routes/redeem.$code.tsx:47-113`) doesn't check whether the person claiming is the buyer.
- **Team Admin isn't limited to Students.** The glossary calls a Team Admin "a Student who buys ... a Team Licence". The code lets any role buy one.
- **Quiz edits destroy Student data.** Saving a quiz deletes every Student's attempts on it (S11), which cuts against ADR 0001's "keeps ... quiz attempts".
- **Quiz pass mark is ignored.** A quiz is passed when `scoreValue > 0.7` (`courses.$slug.lessons.$lessonId.tsx:599`), whatever its `passingScore` is.
- **Avoided terms in the code.** The code calls a Seat a "coupon", claiming one "redeem", and the UI says "Redeem Coupon" (`app/routes/redeem.$code.tsx:244`). `UserRole.Admin` and `TeamMemberRole.Admin` are both just "Admin".
- **Notification isn't in the glossary.** `GLOSSARY.md` has no Notification entry yet.
