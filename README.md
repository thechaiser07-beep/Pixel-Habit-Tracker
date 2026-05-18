# Pixel — Habit Tracker
## Setup Guide

---

### Step 1 — Supabase: create the tables

1. Go to [supabase.com](https://supabase.com) and open your project
2. In the left sidebar click **SQL Editor** → **New query**
3. Paste the entire contents of `supabase_setup.sql` and click **Run**
4. You should see "Success. No rows returned"

---

### Step 2 — Supabase: get your credentials

1. In your project go to **Project Settings** (gear icon) → **API**
2. Copy **Project URL** — looks like `https://xxxxxxxxxxxx.supabase.co`
3. Copy **anon / public** key — the long `eyJ…` string

---

### Step 3 — Edit index.html

Open `index.html` and find these three lines near the top of the `<script>` block:

```js
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_KEY = 'YOUR_SUPABASE_ANON_KEY';
const USER_ID      = 'YOUR_UNIQUE_ID';
```

Replace them:

| Variable | What to put |
|---|---|
| `SUPABASE_URL` | Your Project URL from Step 2 |
| `SUPABASE_KEY` | Your anon key from Step 2 |
| `USER_ID` | Any string you choose, e.g. `"alex-2024"` — **use the same value on every device** so your data stays in sync |

---

### Step 4 — Push to GitHub

```bash
# Inside your repo folder
git add index.html
git commit -m "add habit tracker"
git push
```

> Only push `index.html`. You don't need to push `supabase_setup.sql` or this README.

---

### Step 5 — Enable GitHub Pages

1. Go to your repo on GitHub
2. Click **Settings** → **Pages** (left sidebar)
3. Under **Source** select **Deploy from a branch**
4. Set branch to `main` (or `master`) and folder to `/ (root)`
5. Click **Save**

GitHub will show a URL like:
```
https://YOUR-USERNAME.github.io/YOUR-REPO-NAME/
```

It takes ~60 seconds to go live. Open that URL on your phone and add it to your home screen.

---

### Accessing from your phone

- Open the GitHub Pages URL in Safari (iOS) or Chrome (Android)
- **iOS**: tap the Share button → "Add to Home Screen"
- **Android**: tap the three-dot menu → "Add to Home Screen"

The app will open full-screen like a native app and your data syncs instantly across all devices.
