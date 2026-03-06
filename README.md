# DARC Contest Scraper

Scrapes the [DARC contest calendar](https://www.darc.de/der-club/referate/conteste/ct-kalender/darc-contestkalender/) and outputs all contests for the current year.

Warning: Comes with no warranty. The Source at DARC is awful and full with unstructurized data. This script tries its very best to catch all strange things and convert the source.
If someone - who is responsible for that page - changes things, it may break again.

examples for strange (but catched) behaviour? Sure:
| # | Pattern | Example |
|---|---|---|
| 1 | Multi-day contest with `< Name >` but no end time, spanning multiple days via colspan | `00:00 < Aktivitätswoche des DTC >` (colspan=7) |
| 2 | Contest split across week boundary with different names on each side | Week 1: `02:00 < BARTG HF RTTY Contest >` / Week 2: `BARTG > 02:00` |
| 3 | Category annotations in parentheses after end time | `14:00 < DARC µW.-Wettbewerb > 13:59 (CMO)(UKW)` |
| 4 | `>-` instead of `>` as separator | `12:00 < YU DX Contest >- 11:59` |
| 5 | No time given at all | `Aktivitätswoche Rheinland-Pfalz 2025` |

## Usage

```bash
bun run scraper.ts              # JSON output (default)
bun run scraper.ts --rss        # RSS 2.0 output
bun run scraper.ts --format rss # RSS 2.0 output (alternative)
```

Automatic use to run every midnight: create a cronjob (bun needed):
```
0 0 * * * cd /path/to/tool && bun run scraper.ts --rss > /destination/of/file/calendar.rss 2> /dev/null
```

Output is written to stdout; progress and errors omitted.

This github-repo has an automatic Pipeline which creates calendar.rss every night at 02:00am.
simply download https://raw.githubusercontent.com/int2001/darccontest2wl/refs/heads/master/calendar.rss for actual contest-data.

