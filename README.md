# DARC Contest Scraper

Scrapes the [DARC contest calendar](https://www.darc.de/der-club/referate/conteste/ct-kalender/darc-contestkalender/) and outputs all contests for the current year.

## Usage

```bash
bun run scraper.ts              # JSON output (default)
bun run scraper.ts --rss        # RSS 2.0 output
bun run scraper.ts --format rss # RSS 2.0 output (alternative)
```

Output is written to stdout; progress and errors to stderr.
