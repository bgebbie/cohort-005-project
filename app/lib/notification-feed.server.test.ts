import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { notificationFeedConfig } from "./notification-feed.server";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const signingKey = privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();

const keys = {
  secretApiKey: undefined,
  signingKey,
  publicApiKey: "pk_test_cadence",
  feedChannelId: "00000000-0000-4000-8000-000000000000",
};

function tokenClaims(token: string) {
  const [header, payload] = token.split(".");
  const decode = (part: string | undefined) =>
    JSON.parse(Buffer.from(part ?? "", "base64url").toString("utf-8"));
  return { header: decode(header), payload: decode(payload) };
}

describe("the Notification Feed config for the signed-in person", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is absent without Knock keys, so the feed is simply empty", async () => {
    const noKeys = {
      secretApiKey: undefined,
      signingKey: undefined,
      publicApiKey: undefined,
      feedChannelId: undefined,
    };
    await expect(notificationFeedConfig(12, noKeys)).resolves.toBeNull();
    await expect(
      notificationFeedConfig(12, { ...keys, feedChannelId: undefined })
    ).resolves.toBeNull();
  });

  it("carries a token that can only read that person's feed", async () => {
    const config = await notificationFeedConfig(12, keys);

    expect(config).toMatchObject({
      knockUserId: "12",
      publicApiKey: "pk_test_cadence",
      feedChannelId: keys.feedChannelId,
    });
    const { header, payload } = tokenClaims(config?.userToken ?? "");
    expect(header.alg).toBe("RS256");
    expect(payload.sub).toBe("12");
  });

  it("tells the browser which Notification each workflow delivers", async () => {
    const config = await notificationFeedConfig(12, keys);

    expect(config?.workflows["discussion-reply"]).toBe("DiscussionReply");
  });

  it("is absent, and logged, when the signing key is unusable", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      notificationFeedConfig(12, { ...keys, signingKey: "not a key" })
    ).resolves.toBeNull();
    expect(log).toHaveBeenCalled();
  });
});
