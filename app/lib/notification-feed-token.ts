// ─── Notification Feed token refresh (browser) ───
// The layout loader signs a feed user token on every navigation, but an idle
// tab never navigates. Knock asks for a newer token shortly before the current
// one expires; this fetches one from the server for the session's person.
//
// Served by routes/api.notification-feed-token.ts.

export const FEED_TOKEN_PATH = "/api/notification-feed-token";

type FetchToken = (path: string) => Promise<Response>;

/**
 * A freshly signed token for `knockUserId`, or undefined if there isn't one
 * for them. The session is shared between tabs, so a DevUI switch in another
 * tab can make the server sign for someone else: that token is refused, so
 * this feed never re-authenticates as a different person.
 */
export async function refreshFeedUserToken(
  knockUserId: string,
  fetchToken: FetchToken = (path) =>
    fetch(path, { credentials: "same-origin", cache: "no-store" })
): Promise<string | undefined> {
  try {
    const response = await fetchToken(FEED_TOKEN_PATH);
    if (!response.ok) return undefined;
    const body: unknown = await response.json();
    if (!isFeedUserToken(body) || body.knockUserId !== knockUserId) {
      return undefined;
    }
    return body.userToken;
  } catch (error) {
    console.error("[notifications] could not refresh the feed token:", error);
    return undefined;
  }
}

/** What the token route returns, when it signs one. */
export type FeedUserToken = { knockUserId: string; userToken: string };

function isFeedUserToken(body: unknown): body is FeedUserToken {
  return (
    typeof body === "object" &&
    body !== null &&
    "knockUserId" in body &&
    typeof body.knockUserId === "string" &&
    "userToken" in body &&
    typeof body.userToken === "string"
  );
}
