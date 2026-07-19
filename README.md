# Bullion Desk

Live gold, silver and Brent prices with portfolio P&L, in Kuwaiti dinar and Indian rupees.

## The problem

Browsers block cross-origin requests to price APIs, and your two local price
sources (Islamicly, Dar Al Sabaek) render their prices with JavaScript — the
number isn't in the HTML at all.

## The fix

A GitHub Action runs on GitHub's servers every 30 minutes and does both jobs:

```
API sources     ──► plain HTTP        ──►┐
                    spot, FX, Brent      │
                                         ├──► docs/prices.json ──► dashboard
Scrape sources  ──► headless Chrome   ──►┘     (same origin, no CORS)
                    Islamicly, Dar Al Sabaek
```

No browser means no CORS. A real Chrome means JavaScript-rendered pages work.

## Sources

| Data | Source | Method | Key |
|---|---|---|---|
| Gold, silver spot USD/oz | api.gold-api.com | HTTP | no |
| USD→INR, USD→KWD | open.er-api.com | HTTP | no |
| Brent USD/bbl | Yahoo Finance chart API | HTTP | no |
| Gold, silver India ₹/g | islamicly.com | headless Chrome | no |
| Gold, silver Kuwait KD/g | daralsabaek.com | headless Chrome | no |

## How scraping is kept honest

Scraping is fragile. These guards make its failures loud instead of silent:

1. **Spot cross-check.** Every scraped price is compared against
   `spot ÷ 31.1035 × FX`. Anything below 94% or above 130% of that is rejected.
   A cached 2017 page, an unrendered `{{template}}`, or a stray page number all
   fail this test.
2. **Asymmetric band.** The floor sits at 94% deliberately: 22K gold is 91.6% of
   24K, so a 22K price scraped by mistake falls outside and is rejected.
3. **Nearest-to-expected matching.** Rather than a CSS selector that snaps on
   redesign, the scraper reads every number on the rendered page and takes the
   one closest to spot-implied. Survives layout changes.
4. **Null, never stale.** A failed scrape writes `null` and a reason. Values
   carry forward only if under 48h old, and are labelled `_carried` when they do.
5. **Provenance on screen.** Each price chip says `scraped` or `derived`, so you
   always know whether you're seeing the real figure or a coefficient estimate.

## Fallback

If a scrape fails, the dashboard falls back to a coefficient — your last known
local price divided by spot-implied — and labels the chip `derived`. Set these
under **Fallback calibration**. When scraping works, they're ignored.

## Cost

Playwright + Chromium makes each run ~60s instead of ~2s. GitHub's free tier is
2,000 minutes/month; at 30-minute intervals this uses roughly 1,440. Widen the
cron to hourly if you want more headroom.

## Note on terms of service

Islamicly and Dar Al Sabaek don't offer public APIs and their terms discourage
automated access. This is a low-frequency personal read of prices they publish
openly. If either blocks the runner, the guards will report it and the
coefficient fallback takes over — nothing breaks silently.

## Setup

See SETUP-GUIDE.md.
