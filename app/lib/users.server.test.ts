import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import { eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import {
  editUser,
  signUp,
  syncAllUsers,
  updateProfile,
} from "./users.server";
import {
  fakeNotificationPort,
  type FakeNotificationPort,
} from "./notifications.server";

type TestDb = ReturnType<typeof createTestDb>;

const DEFAULTS = {
  RefundRequestUpdates: { feed: true },
  OpenRefundRequests: { feed: true },
  SeatClaims: { feed: true },
  Enrollments: { feed: false },
  DiscussionQuestions: { feed: true },
  DiscussionReplies: { feed: true },
};

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let notifications: FakeNotificationPort;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  notifications = fakeNotificationPort();
});

function failingPort(): FakeNotificationPort {
  const port = fakeNotificationPort();
  port.identify = async () => {
    throw new Error("Knock is down");
  };
  return port;
}

function getUser(id: number) {
  return db.select().from(schema.users).where(eq(schema.users.id, id)).get();
}

describe("signing up", () => {
  it("creates a Student and syncs them with the default preferences", async () => {
    const result = await signUp(db, notifications, "Ada", "ada@example.com");

    expect(result.created).toBe(true);
    expect(getUser(result.user.id)?.role).toBe(UserRole.Student);
    expect(notifications.identified).toEqual([
      {
        id: result.user.id,
        name: "Ada",
        email: "ada@example.com",
        avatarUrl: null,
      },
    ]);
    expect(notifications.preferences.get(result.user.id)).toEqual(DEFAULTS);
  });

  it("logs in an existing email without creating or syncing anyone", async () => {
    const result = await signUp(
      db,
      notifications,
      "Someone Else",
      base.user.email
    );

    expect(result).toMatchObject({ created: false, user: { id: base.user.id } });
    expect(notifications.identified).toEqual([]);
  });

  it("still signs the person up when the sync fails, and logs it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await signUp(db, failingPort(), "Ada", "ada@example.com");

    expect(getUser(result.user.id)?.name).toBe("Ada");
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe("updating your profile on Settings", () => {
  it("syncs you when your name changes, keeping preferences you already have", async () => {
    notifications.preferences.set(base.user.id, { Enrollments: { feed: true } });

    await updateProfile(db, notifications, base.user.id, "Ada Lovelace", "Hi");

    expect(getUser(base.user.id)).toMatchObject({
      name: "Ada Lovelace",
      bio: "Hi",
    });
    expect(notifications.identified).toEqual([
      {
        id: base.user.id,
        name: "Ada Lovelace",
        email: base.user.email,
        avatarUrl: base.user.avatarUrl,
      },
    ]);
    expect(notifications.preferenceWrites).toEqual([]);
  });

  it("doesn't sync when only the bio changes", async () => {
    await updateProfile(db, notifications, base.user.id, base.user.name, "Hi");

    expect(getUser(base.user.id)?.bio).toBe("Hi");
    expect(notifications.identified).toEqual([]);
  });

  it("still saves the name when the sync fails, and logs it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await updateProfile(db, failingPort(), base.user.id, "Ada Lovelace", "");

    expect(getUser(base.user.id)).toMatchObject({
      name: "Ada Lovelace",
      bio: null,
    });
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe("a Platform Admin editing a user", () => {
  it("saves the name and email and syncs the user", async () => {
    await editUser(
      db,
      notifications,
      base.instructor.id,
      "Prof. Grace",
      "grace@example.com"
    );

    expect(getUser(base.instructor.id)).toMatchObject({
      name: "Prof. Grace",
      email: "grace@example.com",
      bio: base.instructor.bio,
    });
    expect(notifications.identified).toEqual([
      {
        id: base.instructor.id,
        name: "Prof. Grace",
        email: "grace@example.com",
        avatarUrl: base.instructor.avatarUrl,
      },
    ]);
    expect(notifications.preferences.get(base.instructor.id)).toEqual(DEFAULTS);
  });

  it("still saves the edit when the sync fails, and logs it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await editUser(
      db,
      failingPort(),
      base.instructor.id,
      "Prof. Grace",
      "grace@example.com"
    );

    expect(getUser(base.instructor.id)?.name).toBe("Prof. Grace");
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe("syncing every user (the seed and the backfill)", () => {
  it("syncs every existing user and gives each the default preferences", async () => {
    const result = await syncAllUsers(db, notifications);

    expect(result).toEqual({ synced: 2, failed: 0 });
    expect(notifications.identified.map((user) => user.id).sort()).toEqual(
      [base.user.id, base.instructor.id].sort()
    );
    expect(notifications.preferences.get(base.user.id)).toEqual(DEFAULTS);
    expect(notifications.preferences.get(base.instructor.id)).toEqual(DEFAULTS);
  });

  it("is safe to run again: choices made in between are kept", async () => {
    await syncAllUsers(db, notifications);
    notifications.preferences.set(base.instructor.id, {
      ...DEFAULTS,
      Enrollments: { feed: true },
    });
    const writesBefore = notifications.preferenceWrites.length;

    await syncAllUsers(db, notifications);

    expect(notifications.preferenceWrites).toHaveLength(writesBefore);
    expect(notifications.preferences.get(base.instructor.id)).toMatchObject({
      Enrollments: { feed: true },
    });
  });

  it("carries on past a user whose sync fails, and counts the failure", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const identify = notifications.identify;
    notifications.identify = async (user) => {
      if (user.id === base.user.id) throw new Error("Knock is down");
      await identify(user);
    };

    const result = await syncAllUsers(db, notifications);

    expect(result).toEqual({ synced: 1, failed: 1 });
    expect(notifications.preferences.get(base.instructor.id)).toEqual(DEFAULTS);
    logged.mockRestore();
  });
});
