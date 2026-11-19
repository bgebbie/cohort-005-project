// PROTOTYPE, throwaway. Answers "What does the Notification Feed look like in
// Cadence?" (#65). Lives on prototype/notification-feed only.
//
// Three variants of the Notification Feed, mounted in the app shell
// (layout.app.tsx) and switched with ?variant=A|B|C:
//   A  Bell + popover in the sidebar header. Badge = UNSEEN. Opening marks seen.
//   B  Bell + right-hand drawer, "New" / "Earlier". Badge = UNREAD. Dismiss.
//   C  "Notifications" nav item + full inbox page (/prototype/notifications),
//      filtered by category. Count = UNREAD.
//
// Real Knock: the feed, counts, seen/read/archived all go browser → Knock with
// the public key + the signed user token. Only the two committed workflows
// (discussion-reply, new-enrollment) exist in Knock. Every other catalogue
// Notification is a client-side FIXTURE row: tagged "fixture", read state kept
// in memory. Displayed counts = Knock meta + fixture rows, so they match the list.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import {
  Bell,
  CheckCheck,
  Circle,
  GraduationCap,
  MessageSquare,
  Receipt,
  UsersRound,
  X,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { UserRole } from "~/db/schema";

const KNOCK_API = "https://api.knock.app/v1";

export type FeedVariant = "A" | "B" | "C";
export const FEED_VARIANTS: { key: FeedVariant; name: string }[] = [
  { key: "A", name: "Bell popover, unseen badge" },
  { key: "B", name: "Drawer, unread badge" },
  { key: "C", name: "Inbox page" },
];

export type KnockFeedConfig = {
  knockUserId: string;
  userToken: string;
  publicApiKey: string;
  feedChannelId: string;
  role: UserRole;
  isTeamAdmin: boolean;
};

export type FeedItem = {
  id: string;
  inserted_at: string;
  read_at: string | null;
  seen_at: string | null;
  source: { key: string; categories: string[] };
  data: Record<string, any>;
  actors: { name?: string }[];
  fixture?: boolean;
};

type FeedMeta = { unread_count: number; unseen_count: number; total_count: number };

// ---------------------------------------------------------------------------
// Fixtures: catalogue Notifications that have no Knock workflow yet.
// ---------------------------------------------------------------------------

function ago(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function fixturesFor(role: UserRole, isTeamAdmin: boolean): FeedItem[] {
  const f = (
    id: string,
    key: string,
    category: string,
    minutes: number,
    actor: string,
    data: Record<string, any>,
    read = false
  ): FeedItem => ({
    id: `fixture-${id}`,
    inserted_at: ago(minutes),
    read_at: read ? ago(minutes - 1) : null,
    seen_at: read ? ago(minutes - 1) : null,
    source: { key, categories: [category] },
    data,
    actors: [{ name: actor }],
    fixture: true,
  });

  const items: FeedItem[] = [];
  if (role === UserRole.Student || isTeamAdmin) {
    items.push(
      f("refund-requested", "refund-request-confirmation", "refunds", 60 * 26, "Cadence", {
        courseTitle: "Advanced TypeScript Patterns",
        amount: "$49.00",
        url: "/dashboard",
      }, true),
      f("refund-approved", "refund-request-approved", "refunds", 60 * 3, "Priya (Platform Admin)", {
        courseTitle: "Advanced TypeScript Patterns",
        amount: "$49.00",
        decisionNote: "Sorry it wasn't a fit. Refund on its way.",
        url: "/dashboard",
      }),
      f("refund-declined", "refund-request-declined", "refunds", 60 * 24 * 9, "Priya (Platform Admin)", {
        courseTitle: "Intro to Rust",
        amount: "$29.00",
        decisionNote: "Outside the 30-day window.",
        url: "/courses",
      }, true)
    );
  }
  if (role === UserRole.Admin) {
    items.push(
      f("refund-open", "refund-request-opened", "refunds", 12, "Sam Student", {
        courseTitle: "Advanced TypeScript Patterns",
        amount: "$49.00",
        reason: "The course moved too fast for me and I couldn't keep up.",
        url: "/admin/refunds",
      })
    );
  }
  if (isTeamAdmin) {
    items.push(
      f("seat-claimed", "seat-claimed", "team", 45, "Jordan Lee", {
        courseTitle: "React for Teams",
        seatsLeft: 3,
        url: "/team",
      })
    );
  }
  if (role === UserRole.Instructor) {
    items.push(
      f("question", "discussion-question", "discussion", 30, "Alex Chen", {
        lessonTitle: "Generics in depth",
        excerpt: "Why does the constraint fail when I pass a union here?",
        url: "/instructor/questions",
      })
    );
  }
  return items;
}

// ---------------------------------------------------------------------------
// How each Notification reads. Rendered from Cadence-side `data`, not Knock's
// template `blocks` (an open question for the handover).
// ---------------------------------------------------------------------------

type Rendered = { icon: ReactNode; title: ReactNode; detail?: string; category: string };

function render(item: FeedItem): Rendered {
  const d = item.data;
  const actor = item.actors[0]?.name ?? "Someone";
  const b = (s: ReactNode) => <span className="font-semibold">{s}</span>;
  switch (item.source.key) {
    case "discussion-reply":
      return {
        icon: <MessageSquare className="size-4 text-blue-500" />,
        title: <>{b(d.replierName ?? actor)} replied to your question in {b(d.lessonTitle)}</>,
        detail: d.replyExcerpt ?? d.questionExcerpt,
        category: "discussion",
      };
    case "discussion-question":
      return {
        icon: <MessageSquare className="size-4 text-blue-500" />,
        title: <>{b(actor)} asked a question in {b(d.lessonTitle)}</>,
        detail: d.excerpt,
        category: "discussion",
      };
    case "new-enrollment":
      return {
        icon: <GraduationCap className="size-4 text-green-600" />,
        title: <>{b(d.studentName ?? actor)} enrolled in {b(d.courseTitle)}</>,
        category: "enrollment",
      };
    case "refund-request-confirmation":
      return {
        icon: <Receipt className="size-4 text-amber-500" />,
        title: <>Your refund request for {b(d.courseTitle)} ({d.amount}) is under review</>,
        category: "refunds",
      };
    case "refund-request-approved":
      return {
        icon: <Receipt className="size-4 text-green-600" />,
        title: <>Your refund for {b(d.courseTitle)} ({d.amount}) was {b("approved")}</>,
        detail: d.decisionNote,
        category: "refunds",
      };
    case "refund-request-declined":
      return {
        icon: <Receipt className="size-4 text-red-500" />,
        title: <>Your refund for {b(d.courseTitle)} was {b("declined")}. You can ask again.</>,
        detail: d.decisionNote,
        category: "refunds",
      };
    case "refund-request-opened":
      return {
        icon: <Receipt className="size-4 text-amber-500" />,
        title: <>{b(actor)} asked for a {d.amount} refund on {b(d.courseTitle)}</>,
        detail: d.reason,
        category: "refunds",
      };
    case "seat-claimed":
      return {
        icon: <UsersRound className="size-4 text-purple-500" />,
        title: <>{b(actor)} claimed a Seat on {b(d.courseTitle)}. {d.seatsLeft} left</>,
        category: "team",
      };
    default:
      return {
        icon: <Bell className="size-4" />,
        title: item.source.key,
        category: item.source.categories[0] ?? "other",
      };
  }
}

function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString();
}

// ---------------------------------------------------------------------------
// The feed: polls Knock, merges fixtures, exposes seen/read/archive.
// ---------------------------------------------------------------------------

type Feed = {
  items: FeedItem[];
  meta: FeedMeta | null;
  unread: number;
  unseen: number;
  error: string | null;
  markSeen: (items: FeedItem[]) => void;
  markRead: (items: FeedItem[]) => void;
  markUnread: (items: FeedItem[]) => void;
  archive: (items: FeedItem[]) => void;
  open: (item: FeedItem) => void;
  refresh: () => void;
};

const FeedContext = createContext<Feed | null>(null);

export function useFeed() {
  const feed = useContext(FeedContext);
  if (!feed) throw new Error("PROTOTYPE: no NotificationFeedProvider");
  return feed;
}

export function NotificationFeedProvider({
  config,
  children,
}: {
  config: KnockFeedConfig | null;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<FeedItem[]>([]);
  const [meta, setMeta] = useState<FeedMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fixtures, setFixtures] = useState<FeedItem[]>([]);

  useEffect(() => {
    setFixtures(config ? fixturesFor(config.role, config.isTeamAdmin) : []);
  }, [config?.knockUserId, config?.role, config?.isTeamAdmin]);

  const headers = useMemo(
    () =>
      config && {
        Authorization: `Bearer ${config.publicApiKey}`,
        "X-Knock-User-Token": config.userToken,
        "Content-Type": "application/json",
      },
    [config?.publicApiKey, config?.userToken]
  );

  const refresh = useCallback(async () => {
    if (!config || !headers) return;
    const res = await fetch(
      `${KNOCK_API}/users/${config.knockUserId}/feeds/${config.feedChannelId}?page_size=50`,
      { headers }
    );
    if (!res.ok) {
      setError(`Knock feed ${res.status}`);
      return;
    }
    const json = await res.json();
    setError(null);
    setEntries(json.entries);
    setMeta(json.meta);
  }, [config?.knockUserId, headers]);

  useEffect(() => {
    setEntries([]);
    setMeta(null);
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const batch = useCallback(
    async (status: "seen" | "read" | "unread" | "archived", items: FeedItem[]) => {
      const now = new Date().toISOString();
      const fixtureIds = new Set(items.filter((i) => i.fixture).map((i) => i.id));
      if (fixtureIds.size) {
        setFixtures((fs) =>
          status === "archived"
            ? fs.filter((f) => !fixtureIds.has(f.id))
            : fs.map((f) =>
                !fixtureIds.has(f.id)
                  ? f
                  : status === "seen"
                    ? { ...f, seen_at: f.seen_at ?? now }
                    : status === "read"
                      ? { ...f, read_at: now, seen_at: f.seen_at ?? now }
                      : { ...f, read_at: null }
              )
        );
      }
      const ids = items.filter((i) => !i.fixture).map((i) => i.id);
      // Knock 422s on an empty batch.
      if (!ids.length || !headers) return;
      await fetch(`${KNOCK_API}/messages/batch/${status}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ message_ids: ids }),
      });
      refresh();
    },
    [headers, refresh]
  );

  const items = useMemo(
    () =>
      [...entries, ...fixtures].sort((a, b) => b.inserted_at.localeCompare(a.inserted_at)),
    [entries, fixtures]
  );

  const feed: Feed = {
    items,
    meta,
    unread: (meta?.unread_count ?? 0) + fixtures.filter((f) => !f.read_at).length,
    unseen: (meta?.unseen_count ?? 0) + fixtures.filter((f) => !f.seen_at).length,
    error,
    refresh,
    markSeen: (xs) => batch("seen", xs.filter((x) => !x.seen_at)),
    markRead: (xs) => batch("read", xs.filter((x) => !x.read_at)),
    markUnread: (xs) => batch("unread", xs),
    archive: (xs) => batch("archived", xs),
    // Clicking a Notification: mark it read, then go where it points.
    open: (item) => {
      if (!item.read_at) batch("read", [item]);
      if (item.data.url) navigate(item.data.url);
    },
  };

  return <FeedContext.Provider value={feed}>{children}</FeedContext.Provider>;
}

// ---------------------------------------------------------------------------
// Variant selection: ?variant= wins, then localStorage so it survives
// navigation between pages.
// ---------------------------------------------------------------------------

export function useFeedVariant(): FeedVariant {
  const [params] = useSearchParams();
  const fromUrl = params.get("variant") as FeedVariant | null;
  const [stored, setStored] = useState<FeedVariant>("A");
  useEffect(() => {
    const s = localStorage.getItem("prototype-feed-variant") as FeedVariant | null;
    if (fromUrl) localStorage.setItem("prototype-feed-variant", fromUrl);
    else if (s) setStored(s);
  }, [fromUrl]);
  const v = fromUrl ?? stored;
  return FEED_VARIANTS.some((x) => x.key === v) ? v : "A";
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function FixtureTag() {
  return (
    <span
      title="Fixture row: no Knock workflow for this Notification yet. Not counted."
      className="rounded border border-dashed border-amber-500 px-1 text-[10px] uppercase text-amber-600"
    >
      fixture
    </span>
  );
}

function CountBadge({ n, className }: { n: number; className?: string }) {
  if (n <= 0) return null;
  return (
    <span
      className={cn(
        "flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white",
        className
      )}
    >
      {n > 9 ? "9+" : n}
    </span>
  );
}

function Empty() {
  return (
    <div className="px-4 py-10 text-center text-sm text-muted-foreground">
      You're all caught up.
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variant A: bell + compact popover. Badge counts UNSEEN; opening marks seen.
// ---------------------------------------------------------------------------

function VariantA() {
  const feed = useFeed();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const unseen = feed.unseen;

  useEffect(() => {
    if (open) feed.markSeen(feed.items);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent"
        title="Notifications"
      >
        <Bell className="size-4" />
        <CountBadge n={unseen} className="absolute -right-1 -top-1" />
      </button>
      {open && (
        <div className="fixed left-56 top-2 z-40 ml-2 w-96 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            <button
              onClick={() => feed.markRead(feed.items)}
              className="text-xs text-primary hover:underline"
            >
              Mark all as read
            </button>
          </div>
          <ul className="max-h-[28rem] overflow-y-auto">
            {feed.items.length === 0 && <Empty />}
            {feed.items.map((item) => {
              const r = render(item);
              return (
                <li key={item.id}>
                  <button
                    onClick={() => {
                      feed.open(item);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-start gap-3 px-3 py-2.5 text-left text-sm hover:bg-accent",
                      !item.read_at && "bg-primary/5"
                    )}
                  >
                    <span className="mt-0.5">{r.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2">{r.title}</span>
                      <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        {timeAgo(item.inserted_at)}
                        {item.fixture && <FixtureTag />}
                      </span>
                    </span>
                    {!item.read_at && (
                      <Circle className="mt-1.5 size-2 shrink-0 fill-primary text-primary" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variant B: bell + full-height drawer. Badge counts UNREAD. New / Earlier,
// per-row read toggle and dismiss (archive).
// ---------------------------------------------------------------------------

function VariantB() {
  const feed = useFeed();
  const [open, setOpen] = useState(false);
  const unread = feed.unread;
  const fresh = feed.items.filter((i) => !i.read_at);
  const earlier = feed.items.filter((i) => i.read_at);

  useEffect(() => {
    if (open) feed.markSeen(feed.items);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const row = (item: FeedItem) => {
    const r = render(item);
    return (
      <li key={item.id} className="group relative border-b last:border-b-0">
        <button
          onClick={() => {
            feed.open(item);
            setOpen(false);
          }}
          className="flex w-full items-start gap-3 px-5 py-4 pr-16 text-left hover:bg-accent"
        >
          <span className="mt-0.5 rounded-full bg-muted p-2">{r.icon}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm">{r.title}</span>
            {r.detail && (
              <span className="mt-1 block border-l-2 pl-2 text-sm italic text-muted-foreground">
                {r.detail}
              </span>
            )}
            <span className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
              {timeAgo(item.inserted_at)} · {r.category}
              {item.fixture && <FixtureTag />}
            </span>
          </span>
        </button>
        <div className="absolute right-3 top-4 flex gap-1 opacity-0 group-hover:opacity-100">
          <button
            title={item.read_at ? "Mark unread" : "Mark read"}
            onClick={() => (item.read_at ? feed.markUnread([item]) : feed.markRead([item]))}
            className="rounded p-1 hover:bg-muted"
          >
            {item.read_at ? <Circle className="size-3.5" /> : <CheckCheck className="size-3.5" />}
          </button>
          <button title="Dismiss" onClick={() => feed.archive([item])} className="rounded p-1 hover:bg-muted">
            <X className="size-3.5" />
          </button>
        </div>
      </li>
    );
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="relative rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent"
        title="Notifications"
      >
        <Bell className="size-4" />
        <CountBadge n={unread} className="absolute -right-1 -top-1" />
      </button>
      {open && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={() => setOpen(false)}>
          <aside
            onClick={(e) => e.stopPropagation()}
            className="flex h-full w-[28rem] flex-col bg-background shadow-2xl"
          >
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">Notifications</h2>
                <p className="text-xs text-muted-foreground">{unread} unread</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => feed.markRead(feed.items)}
                  className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
                >
                  Mark all read
                </button>
                <button onClick={() => setOpen(false)} className="rounded p-1 hover:bg-accent">
                  <X className="size-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {feed.items.length === 0 && <Empty />}
              {fresh.length > 0 && (
                <>
                  <h3 className="bg-muted/50 px-5 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    New
                  </h3>
                  <ul>{fresh.map(row)}</ul>
                </>
              )}
              {earlier.length > 0 && (
                <>
                  <h3 className="bg-muted/50 px-5 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Earlier
                  </h3>
                  <ul className="opacity-75">{earlier.map(row)}</ul>
                </>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Variant C: a nav item with an UNREAD count, leading to a full inbox page.
// ---------------------------------------------------------------------------

function VariantCNavItem() {
  const feed = useFeed();
  const unread = feed.unread;
  return (
    <Link
      to="/prototype/notifications"
      className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    >
      <Bell className="size-4" />
      <span className="flex-1">Notifications</span>
      {unread > 0 && (
        <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
          {unread}
        </span>
      )}
    </Link>
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  all: "All",
  unread: "Unread",
  discussion: "Discussions",
  enrollment: "Enrollments",
  refunds: "Refunds",
  team: "Team",
};

export function InboxPage() {
  const feed = useFeed();
  const [filter, setFilter] = useState("all");
  const categories = ["all", "unread", ...new Set(feed.items.map((i) => render(i).category))];
  const shown = feed.items.filter((i) =>
    filter === "all" ? true : filter === "unread" ? !i.read_at : render(i).category === filter
  );

  // The page itself is "opening the feed".
  useEffect(() => {
    feed.markSeen(feed.items);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.items.length]);

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            {feed.unread} unread · {feed.meta?.total_count ?? 0} from Knock,{" "}
            {feed.items.filter((i) => i.fixture).length} fixtures
          </p>
        </div>
        <button
          onClick={() => feed.markRead(shown)}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
        >
          Mark {filter === "all" ? "all" : "these"} as read
        </button>
      </div>
      <div className="flex gap-6">
        <nav className="w-40 shrink-0 space-y-1">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={cn(
                "block w-full rounded-md px-3 py-1.5 text-left text-sm",
                filter === c ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent"
              )}
            >
              {CATEGORY_LABELS[c] ?? c}
            </button>
          ))}
        </nav>
        <div className="flex-1 overflow-hidden rounded-lg border">
          {shown.length === 0 && <Empty />}
          <table className="w-full text-sm">
            <tbody>
              {shown.map((item) => {
                const r = render(item);
                return (
                  <tr
                    key={item.id}
                    onClick={() => feed.open(item)}
                    className={cn(
                      "cursor-pointer border-b last:border-b-0 hover:bg-accent",
                      !item.read_at && "font-medium"
                    )}
                  >
                    <td className="w-8 py-3 pl-3">
                      {!item.read_at && <Circle className="size-2 fill-primary text-primary" />}
                    </td>
                    <td className="w-8 py-3">{r.icon}</td>
                    <td className="py-3 pr-3">
                      <div className={cn(!item.read_at ? "" : "text-muted-foreground")}>
                        {r.title}
                      </div>
                      {r.detail && (
                        <div className="truncate text-xs font-normal text-muted-foreground">
                          {r.detail}
                        </div>
                      )}
                    </td>
                    <td className="w-24 whitespace-nowrap py-3 pr-3 text-right text-xs font-normal text-muted-foreground">
                      {item.fixture && <FixtureTag />} {timeAgo(item.inserted_at)}
                    </td>
                    <td className="w-10 py-3 pr-3">
                      <button
                        title={item.read_at ? "Mark unread" : "Mark read"}
                        onClick={(e) => {
                          e.stopPropagation();
                          item.read_at ? feed.markUnread([item]) : feed.markRead([item]);
                        }}
                        className="rounded p-1 hover:bg-muted"
                      >
                        {item.read_at ? <Circle className="size-3.5" /> : <CheckCheck className="size-3.5" />}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Slots the sidebar renders.
// ---------------------------------------------------------------------------

export function FeedHeaderSlot() {
  const variant = useFeedVariant();
  if (variant === "A") return <VariantA />;
  if (variant === "B") return <VariantB />;
  return null;
}

export function FeedNavSlot() {
  const variant = useFeedVariant();
  return variant === "C" ? <VariantCNavItem /> : null;
}

export function FeedError() {
  const { error } = useFeed();
  return error ? (
    <div className="fixed left-1/2 top-2 z-50 -translate-x-1/2 rounded bg-red-600 px-3 py-1 text-xs text-white">
      PROTOTYPE: {error}
    </div>
  ) : null;
}
