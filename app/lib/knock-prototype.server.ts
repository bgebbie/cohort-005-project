// PROTOTYPE, throwaway. Restored from the Knock spike for the Notification Feed
// prototype ("What does the Notification Feed look like in Cadence?", #65).
// Lives on prototype/notification-feed only.
import Knock, { signUserToken } from "@knocklabs/node";

if (!process.env.KNOCK_SIGNING_KEY) {
  // Vite doesn't put non-VITE_ vars on process.env, so load .env ourselves.
  process.loadEnvFile(".env");
}

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`PROTOTYPE: ${name} missing from .env`);
  return value;
}

// .env names the secret KNOCK_API_KEY; the spike called it KNOCK_SECRET_API_KEY.
export const knock = new Knock({
  apiKey: process.env.KNOCK_SECRET_API_KEY ?? env("KNOCK_API_KEY"),
});

export const knockPublicConfig = {
  publicApiKey: env("KNOCK_PUBLIC_API_KEY"),
  feedChannelId: env("KNOCK_FEED_CHANNEL_ID"),
};

export function knockUserId(cadenceUserId: number) {
  return String(cadenceUserId);
}

// An hour, so a page left open while comparing variants keeps polling.
export function signKnockUserToken(cadenceUserId: number) {
  return signUserToken(knockUserId(cadenceUserId), {
    signingKey: env("KNOCK_SIGNING_KEY"),
    expiresInSeconds: 60 * 60,
  });
}
