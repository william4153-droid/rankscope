# RankScope — Keyword Competition Analyzer

A Netlify-ready SEO research web application with a public homepage, email signup/login, protected user dashboard, search history, server-enforced daily quotas and a full administrator panel.

## Included features

### Public website

- Professional responsive landing page
- Product overview, features and workflow sections
- Signup and login modal
- Password reset flow
- Guests cannot access the keyword tool

### User dashboard

- Email/password authentication through Supabase Auth
- 20 keyword analyses per Pakistan calendar day by default
- Remaining-search progress and account status
- Keyword, target country and language inputs
- Search intent and 0–100 competition estimate
- Up to 10 ranking-page URLs
- Ranking page type, content angle, strengths and gaps
- Server-measured word counts for accessible pages
- CSV export
- Search history saved to the user's account

### Administrator dashboard

- Total, active and suspended user counts
- Today's total keyword searches
- Search and review all registered users
- Activate or suspend accounts
- Change user/admin roles
- Change an individual user's daily search limit
- Reset an individual user's usage for the current day
- Delete a user account and its saved data
- Review recent keyword activity across all users

## Architecture

- **Frontend:** static HTML/CSS and bundled JavaScript
- **Authentication and database:** Supabase Auth + Postgres
- **AI analysis:** Gemini Interactions API with Google Search and URL Context
- **Page measurement:** Netlify Function + Cheerio
- **Hosting:** Netlify

The Gemini API key and Supabase service-role key remain inside Netlify Functions. They are never included in browser code. The Supabase anon key is intentionally public and is used only with Supabase Auth.

## 1. Create a Supabase project

1. Create a project in Supabase.
2. Open **SQL Editor**.
3. Open `supabase/schema.sql` from this project.
4. Paste the entire SQL file into the SQL Editor and run it once.
5. Open **Authentication → Providers → Email** and keep Email enabled.
6. Open **Authentication → URL Configuration**.
7. Set **Site URL** to your final Netlify URL, for example:

```text
https://your-site-name.netlify.app
```

8. Add the same URL to **Redirect URLs**. You may also add your custom domain later.

Email confirmation can remain enabled. New users will be asked to confirm their address before logging in. For rapid private testing, you can temporarily disable email confirmation in Supabase Auth settings.

## 2. Obtain Supabase keys

In Supabase, open **Project Settings → API** and copy:

- Project URL
- Anon/publishable key
- Service-role key

The service-role key is highly privileged. Never place it in HTML, frontend JavaScript, GitHub commits or a `VITE_`/public environment variable.

## 3. Configure the administrator

Choose the email address that will own the admin panel. Add it to the Netlify `ADMIN_EMAILS` variable. The administrator must create an account using that exact email.

One administrator:

```text
ADMIN_EMAILS=owner@example.com
```

Multiple administrators:

```text
ADMIN_EMAILS=owner@example.com,manager@example.com
```

The role is synchronized when that account calls a protected API endpoint, normally immediately after login.

## 4. Deploy to Netlify

1. Upload this project to a GitHub repository.
2. In Netlify, select **Add new site → Import an existing project**.
3. Connect the GitHub repository.
4. Netlify will read `netlify.toml` automatically.
5. Open **Project configuration → Environment variables**.
6. Add every variable below with Functions runtime access:

```text
GEMINI_API_KEY=your_gemini_key
GEMINI_MODEL=gemini-3.5-flash
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
ADMIN_EMAILS=your-admin-email@example.com
```

7. Trigger a fresh deploy.
8. Return to Supabase Auth URL Configuration and confirm the deployed Netlify URL is present.
9. Sign up with the email listed in `ADMIN_EMAILS` to open the admin panel.

### Netlify build settings

```text
Build command: npm run build
Publish directory: dist
Functions directory: netlify/functions
Node version: 20 or newer
```

## 5. Local development

Install Netlify CLI globally if needed, then run:

```bash
npm install
cp .env.example .env
# Fill in the real values in .env
npm run dev
```

Use the local URL shown by Netlify CLI. Add that URL, commonly `http://localhost:8888`, to the Supabase Auth redirect allow-list while testing password reset and email confirmation.

## Daily quota behavior

- Standard profile limit: 20 successful analyses per Pakistan day.
- The database atomically reserves a search before Gemini runs.
- If Gemini fails or returns invalid data, the reserved search is released.
- Cached searches still count because the user initiated another keyword check.
- The admin can set a custom limit from 0 to 1000 for each user.
- Usage resets by date according to `Asia/Karachi`.

The quota is enforced in Postgres and the protected Netlify Function. Editing browser JavaScript does not remove the limit.

## Security controls

- User JWTs are verified server-side before every protected request.
- Suspended users cannot run analysis.
- Admin operations require an active `admin` profile.
- Row Level Security is enabled on profiles, usage and search history.
- Only service-role server code can roll back quota reservations or manage all users.
- The current admin cannot suspend, demote or delete their own account through the dashboard.
- Secrets should be stored in the Netlify environment-variable UI, not in source control.

## Accuracy limitations

Gemini Search grounding supplies current web-grounded research, but it is not a dedicated Google rank-tracking API. Result order may differ by city, device, personalization and time. For strict position tracking, connect a dedicated SERP provider such as DataForSEO, Serper or SerpAPI later.

Some websites block automated requests or render content exclusively with JavaScript. Their word count may appear as **Blocked** or may be lower than the fully rendered page.

## Main project files

```text
public/index.html              Landing page, auth UI and dashboards
public/style.css               Complete responsive design
public/app.js                  Auth, dashboard, history and admin logic
netlify/functions/analyze.mjs Gemini analysis, quota and search logging
netlify/functions/account.mjs User profile and daily usage
netlify/functions/history.mjs User search history
netlify/functions/admin.mjs   Admin user and activity management
netlify/functions/config.mjs  Public Supabase client configuration
netlify/shared/supabase.mjs   Shared server authentication helpers
supabase/schema.sql            Tables, RLS, triggers and quota functions
```
