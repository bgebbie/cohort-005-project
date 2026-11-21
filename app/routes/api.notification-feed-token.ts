import { data } from "react-router";
import type { Route } from "./+types/api.notification-feed-token";
import { getCurrentUserId } from "~/lib/session";
import { notificationFeedConfig } from "~/lib/notification-feed.server";
import type { FeedUserToken } from "~/lib/notification-feed-token";

// A freshly signed Notification Feed token for the session's person, for an
// open tab whose token is about to expire (see lib/notification-feed-token.ts).
// Null when nobody is signed in or Knock isn't configured.
export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);
  const config = currentUserId
    ? await notificationFeedConfig(currentUserId)
    : null;
  const body: FeedUserToken | null = config
    ? { knockUserId: config.knockUserId, userToken: config.userToken }
    : null;

  return data(body, { headers: { "Cache-Control": "no-store" } });
}
