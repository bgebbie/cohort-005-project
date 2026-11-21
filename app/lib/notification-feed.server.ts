import { knockEnv } from "~/lib/env.server";
import {
  KNOCK_WORKFLOWS,
  knockUserId,
  signFeedUserToken,
} from "~/lib/knock.server";
import type { KnockFeedConfig } from "~/lib/notification-feed";
import type { NotificationName } from "~/lib/notifications.server";

/**
 * What the browser needs to read this person's Notification Feed, signed
 * fresh for them. Null when Knock isn't configured (or the signing key is
 * unusable), in which case the feed is shown empty.
 */
export async function notificationFeedConfig(
  cadenceUserId: number,
  env: ReturnType<typeof knockEnv> = knockEnv()
): Promise<KnockFeedConfig | null> {
  const { signingKey, publicApiKey, feedChannelId } = env;
  if (!signingKey || !publicApiKey || !feedChannelId) return null;

  let userToken: string;
  try {
    userToken = await signFeedUserToken(signingKey, cadenceUserId);
  } catch (error) {
    console.error("[notifications] could not sign a feed user token:", error);
    return null;
  }

  return {
    knockUserId: knockUserId(cadenceUserId),
    userToken,
    publicApiKey,
    feedChannelId,
    workflows: workflowNotifications(),
  };
}

function workflowNotifications(): Record<string, NotificationName> {
  const workflows: Record<string, NotificationName> = {};
  for (const [notification, { workflow }] of Object.entries(KNOCK_WORKFLOWS)) {
    workflows[workflow] = notification as NotificationName;
  }
  return workflows;
}
