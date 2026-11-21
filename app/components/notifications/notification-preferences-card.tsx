import { useEffect } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import type { PreferenceCategory } from "~/lib/notifications.server";
import type { NotificationSwitch } from "~/lib/notification-preferences.server";

export const SET_NOTIFICATION_PREFERENCE = "set-notification-preference";

/** What the Settings action returns for a preference save. */
export type NotificationPreferenceSaveResult =
  | { ok: true }
  | { ok: false; error: string };

const CATEGORY_COPY: Record<
  PreferenceCategory,
  { label: string; description: string }
> = {
  RefundRequestUpdates: {
    label: "Refund Request updates",
    description:
      "When a Refund Request you raised is received, approved or declined.",
  },
  OpenRefundRequests: {
    label: "Open Refund Requests",
    description: "When someone raises a Refund Request for a Platform Admin to decide.",
  },
  SeatClaims: {
    label: "Seat claims",
    description: "When someone claims a Seat on your Team Licence.",
  },
  Enrollments: {
    label: "Enrollments",
    description: "When a Student enrolls on one of your courses.",
  },
  DiscussionQuestions: {
    label: "Discussion Questions",
    description: "When someone asks a question on one of your courses.",
  },
  DiscussionReplies: {
    label: "Discussion Replies",
    description: "When someone replies to a question you asked.",
  },
};

/**
 * The Notifications card on Settings: one switch per category the person
 * sees. Each flip saves at once and shows straight away; a failed save
 * toasts and the switch goes back.
 *
 * Saves go one at a time. The action reads the whole set, changes one value
 * and writes the set back, so two saves in flight could undo each other.
 * Every switch is disabled while a save is in flight.
 *
 * `switches` is null when the preferences couldn't be loaded.
 */
export function NotificationPreferencesCard({
  switches,
}: {
  switches: NotificationSwitch[] | null;
}) {
  const fetcher = useFetcher<NotificationPreferenceSaveResult>();
  const saving = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok === false) {
      toast.error(fetcher.data.error);
    }
  }, [fetcher.state, fetcher.data]);

  const pendingCategory = fetcher.formData?.get("category");
  const pendingEnabled = fetcher.formData?.get("enabled") === "true";

  return (
    <Card id="notifications" className="mt-8 max-w-md scroll-mt-6">
      <CardHeader>
        <h2 className="text-lg font-semibold">Notifications</h2>
        <p className="text-sm text-muted-foreground">
          Choose what shows up in your Notification Feed.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {switches === null ? (
          <p className="text-sm text-muted-foreground">
            We couldn't load your Notification preferences. Try again later.
          </p>
        ) : (
          switches.map(({ category, enabled }) => {
            const copy = CATEGORY_COPY[category];
            const id = `notification-preference-${category}`;
            const checked =
              pendingCategory === category ? pendingEnabled : enabled;
            return (
              <div
                key={category}
                className="flex items-start justify-between gap-4"
              >
                <div className="space-y-1">
                  <Label htmlFor={id}>{copy.label}</Label>
                  <p className="text-sm text-muted-foreground">
                    {copy.description}
                  </p>
                </div>
                <Switch
                  id={id}
                  checked={checked}
                  disabled={saving}
                  onCheckedChange={(next) =>
                    fetcher.submit(
                      {
                        intent: SET_NOTIFICATION_PREFERENCE,
                        category,
                        enabled: String(next),
                      },
                      { method: "post" }
                    )
                  }
                />
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
