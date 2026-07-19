# Bullion Desk — Setup Guide

From nothing to a live dashboard. About 15 minutes, done once.

No coding, no terminal. Everything happens on the GitHub website with a mouse.

---

## What you are building

Two problems had to be solved:

**Problem 1 — your browser blocks price APIs.** A security rule called CORS.
Cannot be switched off from inside a web page.

**Problem 2 — Islamicly and Dar Al Sabaek have no price in their HTML.** They
draw it with JavaScript after the page loads. Downloading the page gets you
`{{LiveRates.current_price}}`, not a number.

One machine solves both. A GitHub Action is a full Ubuntu computer:

```
  Every 30 minutes, on GitHub's servers:

  ├─ fetch spot, FX, Brent from JSON APIs        (fast, ~2s)
  ├─ open Islamicly + Dar Al Sabaek in a real
  │  headless Chrome, let their JavaScript run,
  │  read the displayed prices                   (slow, ~50s)
  ├─ check every scraped number against spot
  │  and reject anything implausible
  └─ save it all into docs/prices.json

  Your browser then reads that file from the same website — no CORS, no block.
```

---

## Before you start

- A GitHub account (free — github.com).
- The `bullion-desk-repo.zip`, unzipped.

You should see:

```
bullion/
├── .github/workflows/prices.yml     the scheduled job
├── docs/
│   ├── index.html                   the dashboard
│   ├── prices.json                  empty for now
│   └── history.json                 empty for now
├── scripts/fetch-prices.mjs         fetching + scraping
├── README.md
├── SETUP-GUIDE.md
└── .gitignore
```

**If you cannot see `.github`**, your computer hides dot-folders:

- **Windows**: File Explorer → View → tick *Hidden items*
- **Mac**: Finder → press `Cmd` `Shift` `.`

This folder matters more than any other. Without it, nothing ever updates.

---

## Step 1 — Create the repository

1. github.com → sign in.
2. Top right **+** → **New repository**.
3. Name: `bullion-desk`
4. **Public** or **Private**:
   - Public — anyone with the link sees the dashboard. Your holdings are *not*
     published; they live only in your browser. Pages is free.
   - Private — Pages needs a paid plan. On free tier, choose Public.
5. Do **not** tick "Add a README file".
6. **Create repository**.

---

## Step 2 — Upload the files

On the empty repo page, click the link **uploading an existing file**.

1. Open your `bullion` folder.
2. Select **everything inside it** — `.github`, `docs`, `scripts`, `README.md`,
   `SETUP-GUIDE.md`, `.gitignore`. Not the `bullion` folder itself.
3. Drag them onto the upload area.
4. **Check `.github/workflows/prices.yml` appears in the list.** If not, see the
   hidden-folder note above.
5. Commit message: `first commit` → **Commit changes**.

> **If drag-and-drop refuses `.github`**: click **Add file → Create new file**,
> type `.github/workflows/prices.yml` as the filename (the slashes create the
> folders), paste in the contents of that file from the zip, and commit.

---

## Step 3 — Let the job write to your repo

1. Repository **Settings** (top row, not your account settings).
2. Sidebar: **Actions** → **General**.
3. Bottom: **Workflow permissions** → **Read and write permissions**.
4. **Save**.

Skip this and the job fetches everything correctly, then fails when saving.

---

## Step 4 — Turn on the website

1. **Settings** → **Pages**.
2. Source: **Deploy from a branch**.
3. Branch: **main** · Folder: **/docs** ← not the default.
4. **Save**.

Note the address: `https://YOUR-USERNAME.github.io/bullion-desk/`

---

## Step 5 — First run

1. **Actions** tab. Enable workflows if prompted.
2. Sidebar: **Update prices** → **Run workflow** → green **Run workflow**.
3. Refresh after ~10 seconds.

**This first run takes 2–3 minutes** — it downloads Chromium. Later runs are
about a minute.

Click into the run and open the **Fetch prices** step to see exactly what each
source did:

```
metals: ok
fx: ok
brent: ok
islamicly_gold: ok (+4.9% vs spot-implied)
islamicly_silver: ok (+4.7% vs spot-implied)
daralsabaek_gold: failed: timeout
```

That log is the honest picture. A `failed` line means that source gave nothing
and the dashboard will fall back to a coefficient, clearly labelled.

---

## Step 6 — Open your dashboard

`https://YOUR-USERNAME.github.io/bullion-desk/`

404 at first is normal — wait two minutes and refresh.

**Bookmark it.** That is the only thing you open from now on.

---

## Step 7 — Set the fallback (5 minutes, worth doing)

If a scrape fails, the dashboard needs something to fall back on.

1. Open your gold and silver apps, note the rates.
2. Dashboard → **Fallback calibration**.
3. Enter the four figures → **Save fallback**.

It stores the ratio between each and live spot. When scraping works these are
ignored; when it fails you get a sensible number labelled `derived` instead of a
dash.

---

## Reading the dashboard

**Chip labels.** Under every price:
- `scraped` — read from Islamicly or Dar Al Sabaek directly. The real figure.
- `derived` — scrape failed; this is spot × your saved coefficient. An estimate.
- `no data` — neither available.

**Status pills** across the top: one per source, green when working.

**Source diagnostics** at the bottom expands to show exactly what each source
reported, including the drift of each scraped price against spot.

**Charts** plot only days actually recorded. Empty at first; real thereafter.

---

## Troubleshooting

**Red cross on the run**

Open the failed run and read the red step.
- *403 / permission denied* on commit — Step 3 was missed.
- *browser download failed* — transient; re-run.

**Scrapes say `failed` but APIs are fine**

Normal and expected sometimes. Causes, in order of likelihood:
- Site was slow and hit the 30s timeout — usually fixes itself next run.
- Site blocked GitHub's datacentre IP.
- Site changed its layout so no number lands in the plausible range.

The dashboard keeps working on coefficients. If it persists for days, the site
has likely blocked the runner for good — tell me and we'll reconsider.

**A scrape says `ok` but the number looks wrong**

Check Source diagnostics for the drift figure. Under about 8% is normal premium.
Much more suggests it grabbed the wrong number, and the band needs tightening in
`scripts/fetch-prices.mjs`.

**404 on the Pages URL**

Wait five minutes. Confirm Settings → Pages folder is **/docs**.

**Nothing updated in days**

GitHub pauses schedules on repos with no activity for ~60 days. Run the workflow
manually to resume.

---

## Changing things

**Run less often** — edit `.github/workflows/prices.yml`, the cron line.
`"0 * * * *"` is hourly. Scraping is the slow part, so hourly halves your
Actions usage.

**Turn scraping off** — delete the `Install Playwright + Chromium` step. The
script detects Playwright is missing, marks the scrapes as failed, and falls
back to coefficients. Runs drop to ~2 seconds.

**Adjust the sanity band** — in `scripts/fetch-prices.mjs`, `BAND_LO` and
`BAND_HI`. Widen if legitimate prices are being rejected; tighten if wrong
numbers are getting through.

**Add a source** — each is a small function in the same file. If one throws, the
rest still publish.

---

## One thing to keep in mind

Scraping other people's websites is inherently fragile. These two sites don't
offer APIs, so it is the only way to read their actual displayed prices — and
they may block the runner or change their layout at any time.

The guards mean that when that happens you will see `derived` or `no data`
rather than a wrong number wearing a green badge. That is the important part.
A dashboard that admits it doesn't know beats one that confidently lies.
