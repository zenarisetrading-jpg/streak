# Deploying your own Streak

This walks through putting Streak on **your own** Cloudflare account, start to finish. It takes
about twenty minutes, most of which is waiting for things to deploy.

Everything runs on one account you control. There is no shared backend, no account on anyone
else's server, and nothing is sent anywhere except to Cloudflare (your app) and to Anthropic
(your meal estimates, from your Worker, with your key).

| Piece | What it does | Cost |
|---|---|---|
| **Cloudflare Workers** | Hosts the app at one URL that works on phone and desktop | Free tier is plenty |
| **Cloudflare D1** | Stores the data | Free tier is plenty |
| **Cloudflare Access** | Sign-in with a one-time email code | Free up to 50 users |
| **Claude API** | Estimates meals from photos or text, and workouts from notes | Pay as you go, ~1–3¢ per estimate |
| **Apple Health** *(optional)* | An iPhone Shortcut posts daily totals to the app | Free |

The only part that costs money is the Claude API, and only when you use it. If you skip step 5,
everything else still works — typed meals fall back to a local food table built into the app.

> **A note on the Claude API key.** It is stored as an encrypted Cloudflare secret and read only
> by the Worker, server-side. It never reaches the browser and never goes in a file in this repo.
> Keep it that way in anything you build on top of this.

---

## 1. Get the code

```bash
git clone https://github.com/<your-username>/daily-check-in.git
cd daily-check-in
npm install
cp wrangler.example.jsonc wrangler.jsonc
cp .dev.vars.example .dev.vars
```

`wrangler.jsonc` is gitignored. It is where your own account and sign-in IDs live, so it stays on
your machine and never goes back to GitHub.

You can run it locally right now, before any of the Cloudflare setup:

```bash
npm run dev        # http://localhost:8787
```

Localhost has no sign-in in front of it; `DEV_USER_EMAIL` in `.dev.vars` stands in for the
account. Meal photos need step 5, but the rest of the app works.

## 2. Connect to your Cloudflare account

Sign up at <https://dash.cloudflare.com/sign-up> if you have not already, then:

```bash
npm run cf -- login
npm run cf -- whoami
```

`whoami` prints your account ID. Put it in `wrangler.jsonc` as `account_id`. That pins deploys to
this account and nowhere else.

> Wrangler is always run as `npm run cf -- …` in this project. That keeps its login inside
> `.wrangler-home/` in this folder rather than in your home directory, so a work Cloudflare login
> on the same machine is never used by accident. It is worth keeping if you have more than one
> Cloudflare account.

## 3. Create the database and deploy

```bash
npm run cf -- d1 create daily-check-in
```

Copy the `database_id` it prints into `wrangler.jsonc`, then:

```bash
npm run deploy
```

This prints your URL — something like `https://app.<your-subdomain>.workers.dev`. Open it and it
will say **"Sign-in is not configured"**. That is correct: until step 4 the Worker refuses every
request. It fails closed on purpose, so a half-finished deploy is never an open one.

## 4. Turn on sign-in

1. In the Cloudflare dashboard, go to **Workers & Pages → app → Settings → Domains & Routes**.
   On the `workers.dev` row, choose **Enable Cloudflare Access**.
   - The first time, Cloudflare asks you to pick a Zero Trust team name. Choose the **Free** plan.
2. Open **Manage Cloudflare Access** and edit the policy:
   - **Action:** Allow
   - **Include → Emails:** your email, and anyone else in your household
   - **Login method:** One-time PIN. You get a 6-digit code by email — no password to manage.
3. Copy two values into `vars` in `wrangler.jsonc`:
   - `ACCESS_TEAM_DOMAIN` — `<your-team>.cloudflareaccess.com`
   - `ACCESS_AUD` — the application's **Audience (AUD) tag**
4. Set `ALLOWED_EMAILS` to the same addresses, comma-separated, and `OWNER_EMAIL` to yours. The
   Worker checks this list again behind Access, so sign-in has to pass twice.
5. `npm run deploy`

Each person sees only their own data. Signing in with a different email gives you a different,
empty app — nothing is shared between accounts.

### Let two paths through Access

Access sits in front of the Worker, at Cloudflare's edge. It intercepts every request to the
hostname *before* your code runs, which is what makes it a real lock — but two things have to get
through without a sign-in cookie, and they need saying out loud:

| Path | Why it cannot sign in |
|---|---|
| `/ingest/health` | An iPhone Shortcut has no browser and no cookie. It carries its own key instead. |
| The app icons and `/app.webmanifest` | A phone fetches these without cookies when you save the app to the home screen. Behind Access you get a blank icon. |

For each one, create a second application in **Zero Trust → Access → Applications**:

1. **Add an application → Self-hosted.**
2. Set the path to the exact path — `app.<your-subdomain>.workers.dev/ingest/health` for the
   first, and one per icon path for the second (or a path that covers them).
3. Add a policy with **Action: Bypass** and **Include: Everyone**.

**Bypass means no sign-in at all, so only ever point it at a path that defends itself.** Both of
these do. `/ingest/health` accepts nothing without a valid `dct_…` key, of which only a SHA-256
hash is ever stored; the icons are public images with no personal data in them. Never add a bypass
for `/api/...` or for the app itself.

Skip this entirely if you do not want Apple Health and do not mind a plain home-screen icon.
Everything else works without it.

### Optional: inviting people from inside the app

**Settings → People** lets the owner invite someone without touching the dashboard. It needs the
Worker to be able to edit the Access policy, so fill in `CF_ACCOUNT_ID`, `ACCESS_APP_ID` and
`ACCESS_POLICY_ID` in `wrangler.jsonc` (all three are in the Access application's URL and
settings), and create a scoped API token:

```bash
npm run cf -- secret put ACCESS_ADMIN_TOKEN
```

Give that token **only** *Account → Access: Apps and Policies → Edit*, on this account. Nothing
else. Skip this whole section if you are the only user.

## 5. Add a Claude API key

Meal photos, typed or dictated meals, and workout notes are estimated by Claude, called from the
Worker. Without a key the app falls back to a small local food table, which is noticeably worse.

> A Claude Pro or Max subscription covers the Claude apps and Claude Code. It does **not** cover
> an app calling the API — that is separate, pay-as-you-go billing.

1. Go to <https://console.anthropic.com>.
2. Under **Billing**, add a small credit (US$5 goes a long way) and set a monthly spend limit.
3. Under **API keys**, create a key.
4. Store it as an encrypted Worker secret — you are prompted to paste it, and it is not echoed:

```bash
npm run cf -- secret put ANTHROPIC_API_KEY
```

Never paste the key into `wrangler.jsonc`, a `.env`, or any other file in this folder. If one ever
leaks, delete it in the console and create a new one.

**Controlling the cost.** `PHOTO_DAILY_LIMIT` in `wrangler.jsonc` caps estimates per person per
day, counted across photos, typed meals and workouts. The default of 60 is roughly $1.20 a day at
the very most. Token counts are logged to Workers logs as `event: meal_estimate`, so you can see
what you are actually spending.

## 6. Use it on your devices

- **iPhone:** open the URL in Safari, sign in with the emailed code, then **Share → Add to Home
  Screen**. It behaves like an app from then on. The camera button in the tab bar offers *Take
  Photo* or *Photo Library*.
- **Desktop:** the same URL. **Snap a meal** opens a file picker.
- **A shared device:** use **Sign out** in Settings before someone else signs in.

## 7. Apple Health (optional)

Needs the `/ingest/health` bypass application from step 4. Without it the Shortcut gets a login
page back instead of an answer, and fails with no useful error.

In **Settings → Apple Watch & Health**, choose **Create Shortcut key**. The key is shown once —
copy it then, it is not shown again. Only a SHA-256 hash of it is stored, so it cannot be read
back out of the database. **Disconnect** revokes it; creating a new key replaces the old one and
the old Shortcut stops working.

### What to send

There is no Shortcut file to download — Shortcuts are awkward to share safely, and building it
yourself takes about ten minutes. Anything that can make an HTTPS request will do, so this works
from Android, a cron job or a script just as well.

```
POST https://<your-app>.workers.dev/ingest/health
Authorization: Bearer dct_…
Content-Type: application/json

{
  "date": "2026-11-16",
  "activeKcal": 520,
  "restingKcal": 1680,
  "steps": 8430,
  "exerciseMinutes": 41,
  "sleepHours": 7.2,
  "restingHR": 54,
  "hrv": 38
}
```

- `date` is the only required field. `YYYY-MM-DD`, and within two days of today.
- Every other field is optional. A later upload for the same day updates the fields it sends and
  leaves the rest alone, so you can run one Shortcut in the morning for sleep and another at night
  for activity.
- Values may arrive as Shortcuts writes them — `"1,234.5 kcal"` parses fine, and a list of samples
  is summed — so you rarely need to clean anything up before sending.
- Workout samples can be sent too, and are matched against sessions you logged by hand rather than
  double-counted. See `worker/health.mjs` for that payload.

**In Shortcuts:** *Find Health Samples* for each metric → *Get Contents of URL* with method POST,
the Authorization header above, and a JSON body built from those values. Then add an automation to
run it once a day.

## Bringing in existing data

**Settings → Account → Import old history** takes a `.json` file of records. Days you have already
logged are never overwritten, so importing the same file twice is harmless.

---

## Local development

```bash
npm run dev     # builds, applies migrations locally, serves on :8787
npm test        # builds, then runs the test suite
```

`worker/assets.mjs` is generated by `scripts/build.mjs` — never edit it by hand, and run
`npm run build` (or `npm run dev`, or `npm test`) after changing anything in `web/`, or the dev
server will keep serving the previous version of your files.

See `DESIGN.md` before touching the interface: the app uses a small set of design-system classes
and tokens rather than ad-hoc CSS.

## Troubleshooting

| What you see | What it means |
|---|---|
| "Sign-in is not configured" | `ACCESS_TEAM_DOMAIN` or `ACCESS_AUD` is missing from `wrangler.jsonc`. Finish step 4. |
| Signed in, but "not allowed" | Your email is in the Access policy but not in `ALLOWED_EMAILS`. They have to match. |
| Meal estimates fail | No `ANTHROPIC_API_KEY` secret, no credit on the Anthropic account, or you hit `PHOTO_DAILY_LIMIT`. Check `npm run cf -- tail` for the reason. |
| Edits to `web/` do nothing | You are seeing the built `worker/assets.mjs`. Run `npm run build`. |
| The Shortcut gets HTML back, or a login page | `/ingest/health` has no Bypass application. See the end of step 4. |
| The home-screen icon is blank | Same cause, for the icon paths. |
