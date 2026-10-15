# Accounts, sync and deploying

[← Back to the README](../README.md)


Without any setup, GuitarCoach keeps everything on the device. With a free [Supabase](https://supabase.com) project, the **Account** page offers sign-in (Google, or a code sent by email) and syncs:
- songs and edits;
- recordings, including uploaded audio (up to 50 MB per file);
- alignments, practice sessions and reports;
- chord calibration and most settings.

Latency, microphone choice and text size stay per device. The browser copy is always the working copy: changes are saved locally first and synced in the background (after edits, when the connection returns, when the app comes back to the foreground, and every 5 minutes). If two devices change the same item, the newer change wins. Audio is downloaded to a device the first time that recording is played there. Deleting a song deletes it everywhere; *Remove everything from this device* in Settings doesn't touch the account.

Setup, once:
1. Create a Supabase project. In **SQL Editor**, run [`supabase/setup.sql`](../supabase/setup.sql). It creates the `records` table and the private `audio` bucket, with rules that let each person read and write only their own data.
2. In **Authentication → URL Configuration**:
   - set *Site URL* to your deployed address (e.g. `https://guitarcoach.vercel.app`);
   - add `https://<that address>/account` and `http://localhost:3000/account` to *Redirect URLs*.
3. Optional: in **Authentication → Emails**, add `{{ .Token }}` to the *Magic Link* and *Confirm signup* templates, so the email also carries a code. This matters on a phone, where the sign-in link often opens in a different browser from the app; an iPhone home-screen app never shares storage with Safari. Supabase only allows template edits with your own SMTP server; a Gmail address with an app password works (`smtp.gmail.com`, port 465). Without it, use Google sign-in on phones.
4. For Google sign-in:
   - In Google Cloud Console, create an OAuth client (type *Web application*) with the authorised redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`.
   - Paste its client ID and secret into Supabase under **Authentication → Sign In / Providers → Google**.
5. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (from **Project Settings → API Keys**) in `.env.local` and in your hosting provider, then rebuild. Both values are meant to be public; the access rules above protect the data. See [`.env.example`](../.env.example).

Free Supabase projects pause after a week without any activity. To prevent that, a daily Vercel Cron job (`vercel.json`) calls `/api/keepalive`, which makes one tiny read from the database. Without a signed-in user, the access rules return no rows. If you set a `CRON_SECRET` environment variable in Vercel, only Vercel's scheduler can call that route. If the project pauses anyway, the app keeps working on each device; restore the project from the Supabase dashboard to sync again.

The sync engine (`src/lib/sync/engine.ts`) is unit-tested with two simulated devices. It covers edits, deletions, conflicts, per-device settings, wiping a device, merging on first sign-in, separate accounts, and audio upload and download.

## Deploying

The app deploys to [Vercel](https://vercel.com) as is. Import the GitHub repository, add the two environment variables above if you use accounts, and deploy. The free Hobby plan is for personal, non-commercial use. HTTPS is required for the microphone on phones, and Vercel provides it.
