// PROTOTYPE, throwaway. Floating variant switcher for UI prototypes. Dev only.
import { useEffect } from "react";
import { useFetcher, useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";

export function PrototypeSwitcher({
  variants,
  current,
  seedAction,
}: {
  variants: { key: string; name: string }[];
  current: string;
  seedAction?: string;
}) {
  const [params, setParams] = useSearchParams();
  const seed = useFetcher<{ triggered: string[]; skipped: string[] }>();
  const i = Math.max(
    0,
    variants.findIndex((v) => v.key === current)
  );

  const go = (delta: number) => {
    const next = variants[(i + delta + variants.length) % variants.length];
    const p = new URLSearchParams(params);
    p.set("variant", next.key);
    setParams(p, { replace: true, preventScrollReset: true });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!seed.data) return;
    toast.success(
      `Triggered in Knock: ${seed.data.triggered.join(", ") || "nothing"}` +
        (seed.data.skipped.length ? ` · skipped: ${seed.data.skipped.join("; ")}` : "")
    );
  }, [seed.data]);

  if (!import.meta.env.DEV) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-zinc-900 px-2 py-1.5 text-sm text-white shadow-2xl ring-2 ring-amber-400">
      <button onClick={() => go(-1)} className="rounded-full p-1 hover:bg-white/15">
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-56 px-2 text-center">
        <b>{variants[i].key}</b> ({variants[i].name})
      </span>
      <button onClick={() => go(1)} className="rounded-full p-1 hover:bg-white/15">
        <ChevronRight className="size-4" />
      </button>
      {seedAction && (
        <seed.Form method="post" action={seedAction}>
          <button
            disabled={seed.state !== "idle"}
            className="ml-1 rounded-full bg-amber-400 px-3 py-0.5 text-xs font-semibold text-zinc-900 hover:bg-amber-300 disabled:opacity-50"
          >
            {seed.state !== "idle" ? "Seeding…" : "Seed my feed"}
          </button>
        </seed.Form>
      )}
    </div>
  );
}
