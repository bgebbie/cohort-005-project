import { describe, expect, it, vi } from "vitest";
import {
  FEED_TOKEN_PATH,
  refreshFeedUserToken,
} from "./notification-feed-token";

function respondWith(body: unknown, init: ResponseInit = { status: 200 }) {
  const requested: string[] = [];
  const fetchToken = async (path: string) => {
    requested.push(path);
    return new Response(JSON.stringify(body), init);
  };
  return { fetchToken, requested };
}

describe("refreshing the feed's user token", () => {
  it("gets a freshly signed token for the same person", async () => {
    const { fetchToken, requested } = respondWith({
      knockUserId: "12",
      userToken: "fresh-token",
    });

    await expect(refreshFeedUserToken("12", fetchToken)).resolves.toBe(
      "fresh-token"
    );
    expect(requested).toEqual([FEED_TOKEN_PATH]);
  });

  it("refuses a token for someone else, after a user switch in another tab", async () => {
    const { fetchToken } = respondWith({
      knockUserId: "7",
      userToken: "someone-elses-token",
    });

    await expect(
      refreshFeedUserToken("12", fetchToken)
    ).resolves.toBeUndefined();
  });

  it("has nothing when the server signs no token (signed out, or no Knock keys)", async () => {
    const { fetchToken } = respondWith(null);

    await expect(
      refreshFeedUserToken("12", fetchToken)
    ).resolves.toBeUndefined();
  });

  it("has nothing when the server fails", async () => {
    const { fetchToken } = respondWith(
      { knockUserId: "12", userToken: "fresh-token" },
      { status: 500 }
    );

    await expect(
      refreshFeedUserToken("12", fetchToken)
    ).resolves.toBeUndefined();
  });

  it("has nothing, rather than throwing, when the network is down", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const offline = async () => {
      throw new TypeError("Failed to fetch");
    };

    await expect(refreshFeedUserToken("12", offline)).resolves.toBeUndefined();
    log.mockRestore();
  });
});
