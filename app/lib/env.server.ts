import { existsSync } from "node:fs";

// ─── Server environment ───
// Vite only puts VITE_ values from .env on process.env, so server code that
// needs anything else loads .env itself. A missing .env is fine (tests, CI,
// a fresh checkout): nothing throws, and the values are simply absent.
// Values already on process.env win over .env.

let loaded = false;

function loadDotEnv() {
  if (loaded) return;
  loaded = true;
  if (existsSync(".env")) process.loadEnvFile(".env");
}

function read(name: string): string | undefined {
  loadDotEnv();
  return process.env[name] || undefined;
}

/** The Knock keys. Any of them may be missing; callers choose a fallback. */
export function knockEnv() {
  return {
    secretApiKey: read("KNOCK_SECRET_API_KEY"),
    signingKey: read("KNOCK_SIGNING_KEY"),
    publicApiKey: read("KNOCK_PUBLIC_API_KEY"),
    feedChannelId: read("KNOCK_FEED_CHANNEL_ID"),
  };
}
