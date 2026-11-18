// PROTOTYPE — throwaway spike for "Does Knock hold up against Cadence?" (issue #46).
// Not the Feed's look (that's issue #44): raw state only, on purpose.
// All feed and preference calls below go straight from the browser to Knock
// with the public key plus the server-signed X-Knock-User-Token.
import { useCallback, useEffect, useState } from "react";
import { data, useFetcher } from "react-router";
import { ne } from "drizzle-orm";
import type { Route } from "./+types/prototype.knock";
import { getCurrentUserId } from "~/lib/session";
import { db } from "~/db";
import { users } from "~/db/schema";
import {
  identifyAndSign,
  knockUserId,
  triggerNewEnrollmentPrototype,
} from "~/lib/knock.prototype.server";

const API = "https://api.knock.app/v1";

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("Select a user from the DevUI panel.", { status: 401 });
  }
  const { knockId, token } = await identifyAndSign(currentUserId);
  const other = db.select().from(users).where(ne(users.id, currentUserId)).get();
  return {
    knockId,
    token,
    otherKnockId: other ? knockUserId(other.id) : null,
    publicKey: process.env.KNOCK_PUBLIC_API_KEY!,
    channelId: process.env.KNOCK_FEED_CHANNEL_ID!,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) throw data("No user", { status: 401 });
  const student = db.select().from(users).where(ne(users.id, currentUserId)).get();
  try {
    const r = await triggerNewEnrollmentPrototype(currentUserId, student!.id);
    return { ok: true, result: r };
  } catch (e: any) {
    return { ok: false, result: { status: e?.status, message: e?.message } };
  }
}

type Log = { at: string; label: string; status: number; body: unknown };

export default function KnockPrototype({ loaderData }: Route.ComponentProps) {
  const { knockId, token, otherKnockId, publicKey, channelId } = loaderData;
  const [feed, setFeed] = useState<any>(null);
  const [prefs, setPrefs] = useState<any>(null);
  const [log, setLog] = useState<Log[]>([]);
  const trigger = useFetcher<typeof action>();

  const call = useCallback(
    async (label: string, path: string, init: RequestInit = {}) => {
      const r = await fetch(API + path, {
        ...init,
        headers: {
          Authorization: `Bearer ${publicKey}`,
          "X-Knock-User-Token": token,
          "Content-Type": "application/json",
        },
      });
      const text = await r.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {}
      setLog((l) => [
        { at: new Date().toLocaleTimeString(), label, status: r.status, body },
        ...l,
      ]);
      return { status: r.status, body: body as any };
    },
    [publicKey, token]
  );

  const loadFeed = useCallback(async () => {
    const r = await call("list feed", `/users/${knockId}/feeds/${channelId}`);
    if (r.status === 200) setFeed(r.body);
  }, [call, knockId, channelId]);

  const loadPrefs = useCallback(async () => {
    const r = await call("get preferences", `/users/${knockId}/preferences/default`);
    if (r.status === 200) setPrefs(r.body);
  }, [call, knockId]);

  useEffect(() => {
    setFeed(null);
    setPrefs(null);
    loadFeed();
    loadPrefs();
  }, [knockId, loadFeed, loadPrefs]);

  const batch = async (kind: "read" | "seen" | "unread" | "unseen", ids: string[]) => {
    if (ids.length === 0) return;
    await call(`mark ${kind}`, `/messages/batch/${kind}`, {
      method: "POST",
      body: JSON.stringify({ message_ids: ids }),
    });
    await loadFeed();
  };

  const setEnrollmentPref = async (on: boolean) => {
    await call(`set new-enrollment in_app_feed=${on} (merge)`, `/users/${knockId}/preferences/default`, {
      method: "PUT",
      body: JSON.stringify({
        __persistence_strategy__: "merge",
        categories: { "new-enrollment": { channel_types: { in_app_feed: on } } },
      }),
    });
    await loadPrefs();
  };

  const entries: any[] = feed?.entries ?? [];
  const claims = (() => {
    try {
      return JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    } catch {
      return null;
    }
  })();

  return (
    <div className="space-y-6 p-6 font-mono text-sm">
      <div className="rounded border-2 border-dashed border-amber-500 bg-amber-50 p-3">
        PROTOTYPE: Knock spike (issue #46). Throwaway, not the Feed design.
      </div>

      <section>
        <h2 className="font-bold">1. Signed user token</h2>
        <pre>{JSON.stringify({ knockId, claims, alg: "RS256 (server-signed)" }, null, 2)}</pre>
        <button
          className="rounded border px-2 py-1"
          disabled={!otherKnockId}
          onClick={() =>
            call(
              `NEGATIVE: read ${otherKnockId}'s feed with my token (expect 403)`,
              `/users/${otherKnockId}/feeds/${channelId}`
            )
          }
        >
          Negative test: read another user's feed
        </button>
      </section>

      <section>
        <h2 className="font-bold">2 + 3. Feed (headless API)</h2>
        <div className="flex flex-wrap gap-2">
          <button className="rounded border px-2 py-1" onClick={loadFeed}>Refresh feed</button>
          <button className="rounded border px-2 py-1" onClick={() => batch("seen", entries.map((e) => e.id))}>
            Mark all seen
          </button>
          <button className="rounded border px-2 py-1" onClick={() => batch("read", entries.map((e) => e.id))}>
            Mark all read
          </button>
        </div>
        <pre>{JSON.stringify(feed?.meta ?? null, null, 2)}</pre>
        <table className="mt-2 w-full border">
          <thead>
            <tr className="text-left">
              <th>workflow</th><th>actor</th><th>data</th><th>seen</th><th>read</th><th></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-t align-top">
                <td>{e.source?.key}</td>
                <td>{e.actors?.[0]?.name}</td>
                <td><pre>{JSON.stringify(e.data)}</pre></td>
                <td>{e.seen_at ? "✓" : "–"}</td>
                <td>{e.read_at ? "✓" : "–"}</td>
                <td className="space-x-1">
                  <button className="underline" onClick={() => batch("seen", [e.id])}>seen</button>
                  <button className="underline" onClick={() => batch("read", [e.id])}>read</button>
                  <button className="underline" onClick={() => batch("unread", [e.id])}>unread</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="font-bold">4. Preferences (new-enrollment is opt-in)</h2>
        <pre>{JSON.stringify(prefs, null, 2)}</pre>
        <div className="flex flex-wrap gap-2">
          <button className="rounded border px-2 py-1" onClick={() => setEnrollmentPref(true)}>Opt in</button>
          <button className="rounded border px-2 py-1" onClick={() => setEnrollmentPref(false)}>Opt out</button>
          <trigger.Form method="post">
            <button className="rounded border px-2 py-1">Trigger new-enrollment to me</button>
          </trigger.Form>
        </div>
        <pre>{JSON.stringify(trigger.data ?? null, null, 2)}</pre>
      </section>

      <section>
        <h2 className="font-bold">Request log</h2>
        {log.map((l, i) => (
          <details key={i} open={i === 0}>
            <summary>
              {l.at} · {l.label} → <b>{l.status}</b>
            </summary>
            <pre className="whitespace-pre-wrap">{JSON.stringify(l.body, null, 2)}</pre>
          </details>
        ))}
      </section>
    </div>
  );
}
