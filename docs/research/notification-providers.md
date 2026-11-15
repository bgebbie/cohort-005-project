# Which notification providers fit Cadence?

Research for [#2](https://github.com/bgebbie/cohort-005-project/issues/2), part of the map [#1 "Map: in-app notifications"](https://github.com/bgebbie/cohort-005-project/issues/1).

All sources are first-party pricing pages, docs or changelogs. **Checked 2026-11-15.** Vendors change their pricing pages often, so re-check them before you sign up.

## Constraints (from the map)

- Hosted only, with no self-hosting (ADR 0006: one Node process, one SQLite file).
- A free tier that covers a dev/demo app.
- A Node server SDK.
- Live delivery to the browser, with no page reload.
- A persistent inbox: bell, unread count, feed.
- A React inbox component that can be styled to match shadcn/ui is a strong plus. A headless API is an acceptable fallback.
- All four roles (Student, Instructor, Platform Admin, Team Admin) can receive Notifications.
- Email stays on Postmark.

**Scale assumption.** Cadence is a dev/demo app: a handful of seeded users, and at most a few hundred Notifications a month, even with heavy demoing. Every quota below is easily enough for that volume, except where noted. The cap that actually limits us is the number of **workflows** (Notification types), not volume.

## Points common to every provider

- **Identity.** Every provider uses our own user id as the recipient key, and none needs the user created in advance. Cadence's `users.id` is an integer (`app/db/schema.ts`), so we send `String(user.id)`. Each provider wants the browser to hold a short-lived token or hash, minted on our server for that user. In React Router, that means a loader mints it for the session user. When the DevUI switches users, the new user's token comes through on the next loader run. We should key the provider component by user id, so it tears down the socket and reconnects as the new user.
- **Dev without real Notifications.** An in-app Notification *is* the delivery, so "not sending real Notifications" mostly means sending to a separate dev environment, with separate keys and separate recipients. Email and other channels send nothing unless you add provider credentials to that environment.
- **Email.** Each of these providers routes email through an email provider you connect. None of them replaces Postmark for free, and email messages count toward each provider's quota. The one partial exception is Courier, which counts a multi-channel template as one send (see below). I did not check each provider's Postmark integration.

## Knock

- **Pricing.** The Free plan costs $0 and includes "up to 10,000" messages a month, unlimited workflows, unlimited isolated environments, preferences, and the in-app feed. "Remove Knock branding" is **No** on Free. Each in-app item counts as a message (an in-app item plus an email is two). Logs are kept for 30 days, and feed items have no retention limit. The next tier, Starter, costs $250/month plus usage. [knock.app/pricing](https://knock.app/pricing)
- **Identity.** The recipient is our user id string. In production you turn on *enhanced security mode*: the server signs an RS256 JWT with `sub` = user id, using `signUserToken` from `@knocklabs/node/lib/tokenSigner` (expiry defaults to 3600s). The client passes this token as `userToken`. If enhanced security is off, "a request with your public key can act as any user". That is acceptable in dev and wrong for production. [Security and authentication](https://docs.knock.app/in-app-ui/security-and-authentication)
- **Local/dev.** Turning on environments adds a Development environment below Production. Each environment has its own keys and isolated users. Content is committed in dev and then promoted to prod, and a new environment "will not send anything" until channel credentials are added. [Environments](https://docs.knock.app/concepts/environments). A separate feature, *sandbox mode* in the dashboard workflow test runner, renders messages without delivering them. It applies only to dashboard test runs, not to events our app triggers. [Changelog 2026-06-30](https://knock.app/changelog/2026-06-30)
- **Live delivery.** The docs describe real-time "socket connections" without naming the transport. `auto_manage_socket_connection` disconnects the socket in inactive tabs, and an experimental BroadcastChannel option syncs tabs. [React feed](https://docs.knock.app/in-app-ui/react/feed)
- **React inbox and styling.** `@knocklabs/react` provides `NotificationFeedPopover`, `NotificationFeed` and `NotificationIconButton` (a bell with an unread/unseen badge), and also "a complete set of React hooks" for a headless UI. [React overview](https://docs.knock.app/in-app-ui/react/overview). For styling, you can override `--rnf-*` CSS variables or the unique `rnf-*` classes, drop Knock's CSS entirely, use `renderItem` to supply your own cell, and set `colorMode` to `dark`. [React feed](https://docs.knock.app/in-app-ui/react/feed). Knock also publishes a guide to building a custom inbox with shadcn/ui on its hooks. [Blog](https://knock.app/blog/how-to-build-a-custom-inbox-with-nextjs)
- **Preferences.** A per-user `PreferenceSet` can opt the user out by channel, category or workflow, and Knock checks it on every workflow run. Knock offers a hosted no-code preference center, or you can build your own. [Preferences](https://docs.knock.app/concepts/preferences)
- **Lock-in.** The workflows, templates and preference model are proprietary. The CLI and Management API let you keep workflows in version control, which eases audit but not migration. Knock is closed source, so there is no self-host escape hatch (we don't want one anyway).

## Novu Cloud

- **Pricing.** The Free plan costs $0 and includes "10,000 workflow runs / month", **"Up to 5 workflows"**, "2 environments (Dev + Prod)", "Activity feed retention: 24 hours", up to 3 team members, and all channels including in-app. The comparison table appears to show unlimited subscribers (inferred from a flattened table). "Remove Novu branding" is Pro-only. Pro starts at $30/month for 30,000+ runs and 7-day retention, and appears to allow 20 workflows (also inferred from the table's columns). [novu.co/pricing](https://novu.co/pricing)
- **Identity.** The recipient is a `subscriberId`, and Novu recommends using our own user id. Subscribers are created just in time on trigger. [Subscribers](https://docs.novu.co/platform/concepts/subscribers), [Trigger workflow](https://docs.novu.co/platform/workflow/trigger-workflow) (these pages may be stale). In production you enable HMAC: `subscriberHash = HMAC-SHA256(NOVU_SECRET_KEY, subscriberId)` as hex, computed with Node's built-in `crypto`. With HMAC on and no hash, "the Inbox will not load". [Prepare for production](https://docs.novu.co/platform/inbox/prepare-for-production). The server SDK is `@novu/api`. [TypeScript SDK](https://docs.novu.co/platform/sdks/server/typescript)
- **Local/dev.** Novu has Development and Production environments, each with its own secret key and integrations. A workflow that exists only in Development doesn't run with the Production key. You promote work with "Publish changes", which has an API `dryRun`. Custom environments are Team/Enterprise only. There is no sandbox mode that suppresses delivery. [Environments](https://docs.novu.co/platform/concepts/environments)
- **Live delivery.** The docs say the Inbox "securely connects to Novu's services" and syncs "in real-time", without naming the transport. [Inbox overview](https://docs.novu.co/platform/inbox/overview)
- **React inbox and styling.** `@novu/react` (React 18 or 19) provides `<Inbox />`, `<Preferences />`, sub-components such as `InboxContent`/`Notifications`, and hooks for a headless UI. [Inbox overview](https://docs.novu.co/platform/inbox/overview). The `appearance` prop takes `baseTheme` (including a built-in `dark`), `variables` (such as `colorPrimary` and `borderRadius`), and `elements`, where each key accepts **a style object or CSS classes, including Tailwind**. [Styling](https://docs.novu.co/platform/inbox/configuration/styling). The docs include an official "With shadcn/ui Drawer" example that wraps `InboxContent`. [Customize popover](https://docs.novu.co/platform/inbox/advanced-customization/customize-popover). Of the five providers, this is the closest out-of-the-box fit for shadcn/ui.
- **Preferences.** The Inbox has built-in preferences per workflow and channel, shown in the `Preferences` modal. [Inbox overview](https://docs.novu.co/platform/inbox/overview)
- **Lock-in.** The cloud API is proprietary. Novu's core is open source, so there is a theoretical self-host exit, which the constraints rule out for us.
- **Catch.** The 5-workflow cap. Fitting more Notification types under it means collapsing them into one generic workflow whose wording comes from the payload, and that loses per-type preferences.

## Courier

- **Pricing.** The Developer plan is free for "10,000 sends per month". "One send is one template sent to one recipient", and "A template that delivers by email, SMS, push, Slack, and in-app still counts as one send." "Sends from Test and custom environments count the same as Production." Business is pay-as-you-go at $0.005/send. The pricing page does not list Inbox or Preferences as features of the Developer plan. Courier's per-send billing suggests they are included, but **I could not confirm that Inbox is on the free plan**. [courier.com/pricing](https://www.courier.com/pricing)
- **Identity.** The `userId` is "whatever your app already calls this user, such as a database id". The server mints a JWT with `client.auth.issueToken({ scope: "user_id:<id> inbox:read:messages inbox:write:events", expires_in })` from the Node SDK. If you omit `expires_in`, "omitting it mints a token that **never expires**". The SDKs don't refresh tokens, so the server must re-mint them. Preference scopes are `read:preferences write:preferences`. [Authenticate users](https://www.courier.com/docs/in-app/authenticate-users.md?lang=React)
- **Local/dev.** Courier has a Test environment with separate keys, and test sends count toward the quota. Custom environments are Enterprise-only. [courier.com/pricing](https://www.courier.com/pricing)
- **Live delivery.** Delivery is over a **WebSocket**, and you must call `inbox.listenForUpdates()` after sign-in, or the inbox loads only once. [courier-react](https://www.courier.com/docs/sdk-libraries/courier-react-web)
- **React inbox and styling.** `@trycourier/courier-react` (React 18+) provides `<CourierInbox />`, toasts, `<CourierPreferences />`, and a `useCourier()` hook that you can use headless. [Inbox overview](https://www.courier.com/docs/platform/inbox/inbox-overview). Styling uses a `CourierInboxTheme` object (`lightTheme`/`darkTheme`, `mergeTheme`) covering the popup, header, list items, and empty/loading/error states. The docs don't mention CSS classes or variables, and you can replace slots such as the list item. [Customize the inbox](https://www.courier.com/docs/in-app/customize-the-inbox.md?lang=React). Matching shadcn means mapping our tokens into a JS theme object, not writing Tailwind classes.
- **Preferences.** `<CourierPreferences />` is a topic-based preference center (topics, routing, digest schedule). [courier-react](https://www.courier.com/docs/sdk-libraries/courier-react-web)
- **Lock-in.** Proprietary templates, topics and routing.
- **Email note.** Because a multi-channel template counts as one send, adding email next to an in-app Notification costs no extra quota. Of these providers, Courier comes closest to "email nearly free", though we would still need Postmark as the delivery provider.

## MagicBell

- **Pricing.** The Builder plan costs $0 and includes **"1,000 Deliveries/mo."**, "1 Project" and "Unlimited Users". Every channel a user receives a Notification on counts, in-app included. The next tier, Startup, costs **$249/month** for 50,000 deliveries and 5 projects. The pricing page doesn't say whether the free plan has branding or preferences. [magicbell.com/pricing](https://www.magicbell.com/pricing)
- **Identity.** The User JWT is HS256, signed with the project Secret Key, and carries the claims `user_external_id` (our id) and/or `user_email`, plus `api_key`. There is no MagicBell helper, and the docs' Node example uses `jsonwebtoken`. [User JWT](https://www.magicbell.com/docs/api/authentication/user)
- **Local/dev.** The free plan includes only **one project**, so there is no separate dev project. Dev and demo would share it.
- **Live delivery.** `magicbell-js` has a `Realtime` client over **WebSocket**, and the API's `connection_id` refers to an Ably connection, so Ably is likely the transport underneath. [Browser/Node client](https://www.magicbell.com/docs/libraries/magicbell-js), [API reference](https://www.magicbell.com/docs/api/reference)
- **React inbox and styling.** `@magicbell/react` provides `Inbox`, `FloatingInbox`, `ToastContainer` and `UserPreferences`. Styling uses `--magicbell-*` CSS custom properties, overridable class names, and replacement components (`ItemComponent`, `ButtonComponent`), and buttons accept an `unstyled` prop. The React docs list no hooks. For a headless UI, you would use `magicbell-js`. [React components](https://www.magicbell.com/docs/libraries/magicbell-react)
- **Preferences.** `UserPreferences` lets users toggle channels per category. [React components](https://www.magicbell.com/docs/libraries/magicbell-react)
- **Lock-in.** Proprietary. The jump from free to $249/month is the steepest of the five.

## SuprSend

- **Pricing.** The Free plan costs $0 and includes "10k Notifications/mo" and "In-app notification feed (**with SuprSend branding**)". **Preferences are not on Free**: the Channel Preferences, Categories, Preference Center UI and Hosted Preference Page rows all show dashes in the Free column. Logs are kept for 30 days. Opt-outs and failures aren't billed. The page's text was too garbled to tell whether "Multiple Environments" is on Free, so **that is unconfirmed**. Essentials costs $100/month, billed annually, for 50k Notifications. [suprsend.com/pricing](https://www.suprsend.com/pricing)
- **Identity.** The recipient is a `distinct_id`. The inbox moved from an HMAC subscriber id to a server-signed **ES256 JWT** (`entity_type: "subscriber"`, `entity_id` = distinct_id). A `refreshUserToken` callback fetches a new token before the old one expires. If `entity_id` doesn't match, the inbox shows empty with no error. [React inbox overview](https://docs.suprsend.com/docs/inbox-react), [Client authentication](https://docs.suprsend.com/docs/client-authentication)
- **Local/dev.** The docs show staging and production keys, but I could not confirm that the Free plan includes them (see above). [API keys](https://docs.suprsend.com/docs/developer/api-keys)
- **Live delivery.** The docs mention a real-time connection-status dot and banner, without naming the transport. [Customising feed](https://docs.suprsend.com/docs/react-customize-inbox)
- **React inbox and styling.** `@suprsend/react` replaces the old `@suprsend/react-inbox`. It offers a drop-in feed or a headless implementation. Styling uses a `theme` prop object (bell, badge, header, tabs, cards), `themeType` for dark mode, and custom badge/header components. [React inbox overview](https://docs.suprsend.com/docs/inbox-react), [Customising feed](https://docs.suprsend.com/docs/react-customize-inbox)
- **Preferences.** Paid plans only (see Pricing).
- **Lock-in.** Proprietary.

## Comparison at a glance

| | Free volume | Free type/workflow cap | Dev env on Free | Preferences on Free | Styling route to shadcn | Next tier |
|---|---|---|---|---|---|---|
| Knock | 10k msgs | Unlimited | Yes, unlimited | Yes | CSS vars/classes, `renderItem`, or hooks | $250/mo |
| Novu | 10k runs | **5** | Dev + Prod | Yes | Tailwind classes in `appearance.elements`, shadcn Drawer example, hooks | $30/mo |
| Courier | 10k sends (multi-channel = 1) | Not stated | Test (sends count) | Unconfirmed | JS theme object, slot replacement, hook | $0.005/send |
| MagicBell | **1k** deliveries | Not stated | **No** (1 project) | Unconfirmed | CSS vars/classes, replacement components | $249/mo |
| SuprSend | 10k | Not stated | Unconfirmed | **No** | JS theme object, headless | $100/mo |

## Ranked shortlist

1. **Knock.** It meets every constraint on Free with no workflow cap: unlimited workflows and environments, preferences included, a Node token-signing helper, a live socket feed, and a styleable React feed plus hooks for a full shadcn build. Downsides: Knock branding on Free, and a steep $250 step if we ever outgrow it.
2. **Novu Cloud.** It has the best shadcn fit out of the box (Tailwind classes, an official shadcn Drawer example), built-in preferences, Dev + Prod environments, and a cheap $30 upgrade. But the Free plan allows only **5 workflows** and keeps activity for 24 hours.
3. **Courier.** Capable (WebSocket, JWT via the Node SDK, a preferences component, and multi-channel templates that count as one send), but styling goes through a JS theme object rather than CSS/Tailwind, test sends count toward the quota, and Inbox on Free is unconfirmed.
4. **SuprSend.** Inbox and headless options are fine, but preferences aren't on Free and the Free feed carries SuprSend branding.
5. **MagicBell.** Only 1k deliveries and one project on Free, no hooks in the React package, and a $249 next tier.

## Recommendation

**Choose Knock**, and build the inbox with its React hooks and our own shadcn/ui components. Fall back to its `--rnf-*` variables and classes if that's quicker. This choice holds however many Notification types the list ends up with.

The choice depends on the length of the Notification list, which a sibling ticket on the map decides. **If the list ends up with 5 or fewer Notification types, Novu is a close competitor** and arguably nicer to style. Do not squeeze more types under Novu's cap by collapsing them into one generic workflow, because that would remove per-type preferences, which are still open on the map.
