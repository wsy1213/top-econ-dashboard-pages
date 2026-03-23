# Top Economics Journals - Latest Issue Reader

A lightweight web app that aggregates latest-issue article information for top economics journals and the latest NBER working papers.

## Included Sources

- English journals:
  - American Economic Review
  - Journal of Political Economy
  - Quarterly Journal of Economics
  - Econometrica
  - Review of Economic Studies
  - American Economic Journal: Macroeconomics / Microeconomics / Applied Economics / Economic Policy
  - Review of Economics and Statistics
  - Journal of Public Economics
  - Journal of Development Economics
  - AER: Insights
  - American Economic Review: Papers and Proceedings
  - RAND Journal of Economics
  - Journal of Labor Economics
  - Journal of Economic Literature
  - Economic Journal
- Chinese journals:
  - 中国社会科学
  - 经济研究
  - 管理世界
  - 经济学季刊
  - 世界经济
  - 金融研究
- NBER latest papers

## How It Works

- Uses Crossref API to fetch journal article metadata and infer the latest issue by `volume/issue`.
- Uses NBER RSS feed for latest working papers.
- Chinese journals now try CNKI latest-issue table of contents first; if CNKI parsing fails, the app falls back to Crossref.
- Renders all sources in a single English dashboard.

## Run

```bash
cd /Users/wushiyue/Desktop/顶刊阅读/_ghpages_copy
npm install
npm start
```

Open:

- http://127.0.0.1:3000

## Notes

- Some sources may occasionally fail due to remote API limits or metadata gaps.
- Chinese journal coverage depends on Crossref indexing availability.

## Stability Tuning

You can configure these env vars when needed:

- `FETCH_CONCURRENCY` (default `4`): lower this if you still hit rate limits.
- `FETCH_RETRIES` (default `3`): retry count for transient failures.
- `CACHE_TTL_MS` (default `600000`): server-side cache time for `/api/latest`.
- `CROSSREF_MAILTO` (default `you@example.com`): set to your real email for polite Crossref usage.

## CNKI Browser Mode

For some CNKI journals that cannot be fetched reliably via plain HTTP, the app uses a Playwright browser fetcher.

- Install dependencies and browser once:
  - `npm install`
- Optional (recommended for CNKI-restricted journals): provide login cookie:
  - `CNKI_COOKIE='your_cookie_string' npm start`

## Public Website + Daily 00:00 Auto Update (GitHub Actions)

This copy supports static deployment to GitHub Pages.

### 1) Generate static data locally (optional test)

```bash
cd /Users/wushiyue/Desktop/顶刊阅读/_ghpages_copy
npm run build:static
```

This writes:

- `public/data/site-data.json`

### 2) Push this copy to a public GitHub repo

- Create a new repo (recommended), for example: `top-econ-dashboard-pages`.
- Push files from `_ghpages_copy` to that repo.

### 3) Enable Pages from Actions

- In GitHub repo: `Settings -> Pages -> Source: GitHub Actions`.

### 4) Configure repository secrets

- `CROSSREF_MAILTO` (required/recommended)
- `OPENAI_API_KEY` (for title translation)
- `CNKI_COOKIE` (optional, improves some CNKI fetches)

### 5) Schedule

Workflow file:

- `.github/workflows/deploy-pages.yml`

It runs:

- manually (`workflow_dispatch`)
- daily at UTC `16:00`, which is Beijing time `00:00` next day.
