import { parse } from "node-html-parser";

const BASE_URL = "https://www.darc.de";
const CALENDAR_URL = `${BASE_URL}/der-club/referate/conteste/ct-kalender/darc-contestkalender/`;

interface Contest {
  name: string;
  startTime: string | null; // ISO 8601 datetime or null
  endTime: string | null;   // ISO 8601 datetime or null
  startDate: string;        // "YYYY-MM-DD" of the first day
  endDate: string;          // "YYYY-MM-DD" of the last day (may differ for multi-day)
  infoUrl: string;
  mode: string | null;
  bands: string | null;
}

// Parse date string like "Mo 02.03.26" -> "2026-03-02"
function parseDate(raw: string): string | null {
  const m = raw.match(/(\d{2})\.(\d{2})\.(\d{2})/);
  if (!m) return null;
  const [, day, month, year] = m;
  return `20${year}-${month}-${day}`;
}

// Normalize time string to "HH:MM" - handles "13:00", "1300", "13.00"
function parseTime(t: string): string | null {
  t = t.trim();
  if (/^\d{1,2}:\d{2}$/.test(t)) return t.padStart(5, "0");
  if (/^\d{1,2}\.\d{2}$/.test(t)) return t.replace(".", ":").padStart(5, "0");
  if (/^\d{4}$/.test(t)) return `${t.slice(0, 2)}:${t.slice(2)}`;
  return null;
}

// Combine date + time into ISO-like string "YYYY-MM-DDTHH:MM:00Z"
function toISO(date: string | null, time: string | null): string | null {
  if (!date || !time) return null;
  return `${date}T${time}:00Z`;
}

// Clean text: remove HTML entities, extra whitespace
function cleanText(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// Get all month page URLs from the main calendar page
async function getMonthUrls(): Promise<string[]> {
  const resp = await fetch(CALENDAR_URL);
  const html = await resp.text();
  const root = parse(html);

  const urls: string[] = [];
  const links = root.querySelectorAll('a.leftlink');
  for (const link of links) {
    const href = link.getAttribute("href");
    if (href && /\/ct-kalender\/\d{6}\/$/.test(href)) {
      urls.push(BASE_URL + href);
    }
  }
  return urls;
}

// Parse contest text from an anchor tag's text content
// Patterns:
//   "HH:MM < Contest Name > HH:MM\n[mode][band]"   (multi-day, < > brackets)
//   "HH:MM - HH:MM\nContest Name\n[mode][band]"    (single-day, dash)
//   "Contest Name > HH:MM"                           (end only, starts prev day)
interface ParsedContest {
  name: string;
  startTimeRaw: string | null;
  endTimeRaw: string | null;
  mode: string | null;
  bands: string | null;
}

function parseContestText(text: string): ParsedContest | null {
  text = cleanText(text);
  if (!text || text === "&nbsp;" || text === " ") return null;

  let name: string | null = null;
  let startTimeRaw: string | null = null;
  let endTimeRaw: string | null = null;
  let mode: string | null = null;
  let bands: string | null = null;

  // Extract mode and bands from bracket patterns like [CW][80-10m] or [CW/SSB][80m]
  const bracketMatches = [...text.matchAll(/\[([^\]]+)\]/g)];
  if (bracketMatches.length >= 2) {
    mode = bracketMatches[0][1].trim();
    bands = bracketMatches[1][1].trim();
  } else if (bracketMatches.length === 1) {
    mode = bracketMatches[0][1].trim();
  }

  // Remove bracket content for name/time parsing
  const textNoBrackets = text.replace(/\[[^\]]*\]/g, "").trim();

  // Normalize for pattern matching:
  // 1. Strip trailing parenthetical category annotations, e.g. (CMO)(UKW) or malformed (CMO/ UKW]
  // 2. Normalize ">-" separators (e.g. "YU DX Contest >- 11:59") to ">"
  const textClean = textNoBrackets
    .replace(/(\s*\([^)\n]*[)\]])+\s*$/, "")
    .replace(/>(\s*-\s*)(?=\d)/g, "> ")
    .trim();

  // Time token: HH:MM, HH.MM, or HHMM
  const timeToken = String.raw`\d{1,2}[:.]\d{2}|\d{4}`;

  // Pattern 1: "HH:MM < Name > HH:MM" (multi-day contest, angles)
  const multiDay = textClean.match(
    new RegExp(`^(${timeToken})\\s*<\\s*(.+?)\\s*>\\s*(${timeToken})$`)
  );
  if (multiDay) {
    startTimeRaw = multiDay[1];
    name = cleanText(multiDay[2]);
    endTimeRaw = multiDay[3];
    return { name, startTimeRaw, endTimeRaw, mode, bands };
  }

  // Pattern 2a: "HH:MM - HH:MM Name" (time range then name)
  const timeRange = textClean.match(
    new RegExp(`^(${timeToken})\\s*[-–]\\s*(${timeToken})\\s+(.+)$`)
  );
  if (timeRange) {
    startTimeRaw = timeRange[1];
    endTimeRaw = timeRange[2];
    name = cleanText(timeRange[3]);
    return { name, startTimeRaw, endTimeRaw, mode, bands };
  }

  // Pattern 2b: "HH:MM - Name - HH:MM" (start, name with dashes, end)
  const timeWrap = textClean.match(
    new RegExp(`^(${timeToken})\\s*[-–]\\s*(.+?)\\s*[-–]\\s*(${timeToken})$`)
  );
  if (timeWrap) {
    startTimeRaw = timeWrap[1];
    name = cleanText(timeWrap[2]);
    endTimeRaw = timeWrap[3];
    return { name, startTimeRaw, endTimeRaw, mode, bands };
  }

  // Pattern 3: "Name > HH:MM" (contest ending, started prev day)
  const endOnly = textClean.match(
    new RegExp(`^(.+?)\\s*>\\s*(${timeToken})$`)
  );
  if (endOnly) {
    name = cleanText(endOnly[1]).replace(/^[<\s]+|[>\s]+$/g, "").trim();
    endTimeRaw = endOnly[2];
    return { name, startTimeRaw: null, endTimeRaw, mode, bands };
  }

  // Pattern 4: "HH:MM < Name" (started here, ends next period)
  const startOnly = textClean.match(
    new RegExp(`^(${timeToken})\\s*<\\s*(.+)$`)
  );
  if (startOnly) {
    startTimeRaw = startOnly[1];
    name = cleanText(startOnly[2]).replace(/\s*>$/, "").trim();
    return { name, startTimeRaw, endTimeRaw: null, mode, bands };
  }

  // Pattern 5: "Name >" (continuation marker without explicit end time)
  const trailingArrow = textClean.match(/^(.+?)\s*>$/);
  if (trailingArrow) {
    name = cleanText(trailingArrow[1]);
    return { name, startTimeRaw: null, endTimeRaw: null, mode, bands };
  }

  // Fallback: just use the cleaned text as name (strip leading/trailing < > )
  if (textClean.length > 2) {
    name = textClean.replace(/^[<>\s]+|[<>\s]+$/g, "").trim();
    if (name) return { name, startTimeRaw: null, endTimeRaw: null, mode, bands };
  }

  return null;
}

// Parse a monthly page and extract contests
async function parseMonthPage(url: string): Promise<Contest[]> {
  const resp = await fetch(url);
  const html = await resp.text();
  const root = parse(html);

  const contests: Contest[] = [];

  // The calendar is an HTML table (Excel export).
  // Rows alternate between:
  //   - Date rows: cells contain "Mo DD.MM.YY", "Di DD.MM.YY", ...
  //   - Contest rows: cells contain contest entries
  // A week is 7 columns (Mo=0..So=6)

  // Find all tables in the content area
  const tables = root.querySelectorAll("table");

  for (const table of tables) {
    const rows = table.querySelectorAll("tr");
    let currentWeekDates: (string | null)[] = []; // 7 slots for Mo..So

    for (const row of rows) {
      const cells = row.querySelectorAll("td");
      if (cells.length === 0) continue;

      // Check if this is a date row by looking for date pattern in first cell
      const firstCellText = cleanText(cells[0].text);
      const isDateRow = /^(Mo|Di|Mi|Do|Fr|Sa|So)\s+\d{2}\.\d{2}\.\d{2}$/.test(firstCellText);

      if (isDateRow) {
        // Extract dates for each day of the week
        currentWeekDates = [];
        for (let i = 0; i < 7; i++) {
          if (i < cells.length) {
            const txt = cleanText(cells[i].text);
            currentWeekDates.push(parseDate(txt));
          } else {
            currentWeekDates.push(null);
          }
        }
        continue;
      }

      // Skip filler rows (only 'x' characters, used as spacers)
      const allXs = cells.every(c => /^[xX\s]*$/.test(c.text));
      if (allXs) continue;

      // This is a contest row; process each cell
      if (currentWeekDates.length === 0) continue;

      let dayIndex = 0;
      for (const cell of cells) {
        const colspanAttr = cell.getAttribute("colspan");
        const colspan = colspanAttr ? parseInt(colspanAttr) : 1;

        // Find link(s) in this cell
        const links = cell.querySelectorAll("a");

        if (links.length > 0) {
          for (const link of links) {
            const href = link.getAttribute("href") || "";
            const linkText = cleanText(link.text);

            const parsed = parseContestText(linkText);
            if (!parsed || !parsed.name) continue;

            // Start date = first day covered by this cell
            const startDate = currentWeekDates[dayIndex] ?? null;
            // End date = last day covered by this cell (colspan tells us how many days)
            const endDate = currentWeekDates[Math.min(dayIndex + colspan - 1, 6)] ?? startDate;

            // Build start/end time
            let startISO: string | null = null;
            let endISO: string | null = null;

            if (parsed.startTimeRaw) {
              startISO = toISO(startDate, parseTime(parsed.startTimeRaw));
            }

            if (parsed.endTimeRaw) {
              endISO = toISO(endDate, parseTime(parsed.endTimeRaw));
            }

            const infoUrl = href.startsWith("http")
              ? href
              : href
              ? BASE_URL + href
              : CALENDAR_URL;

            contests.push({
              name: parsed.name,
              startTime: startISO,
              endTime: endISO,
              startDate: startDate || "unknown",
              endDate: endDate || startDate || "unknown",
              infoUrl,
              mode: parsed.mode,
              bands: parsed.bands,
            });
          }
        }

        dayIndex += colspan;
        if (dayIndex >= 7) break;
      }
    }
  }

  return contests;
}

// --- RSS helpers ---

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function toRssTime(isoTime: string | null): string | null {
  if (!isoTime) return null;
  // Extract HH:MM from "YYYY-MM-DDTHH:MM:00Z"
  const m = isoTime.match(/T(\d{2}):(\d{2})/);
  if (!m) return null;
  return `${m[1]}${m[2]}Z`;
}

function toRssDate(dateStr: string): string | null {
  // "YYYY-MM-DD" -> "Mar 7"
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const month = MONTH_ABBR[parseInt(m[2]) - 1];
  const day = parseInt(m[3]);
  return `${month} ${day}`;
}

function buildDescription(contest: Contest): string {
  const st = toRssTime(contest.startTime);
  const et = toRssTime(contest.endTime);
  const sd = toRssDate(contest.startDate);
  const ed = toRssDate(contest.endDate);

  const sameDay = contest.startDate === contest.endDate;

  if (st && et && sd && ed) {
    if (sameDay) {
      return `${st}-${et}, ${sd}`;
    }
    return `${st}, ${sd} to ${et}, ${ed}`;
  }
  if (st && sd) {
    if (!sameDay && ed) return `${st}, ${sd} to ${ed}`;
    return `${st}, ${sd}`;
  }
  if (et && ed) {
    if (!sameDay && sd) return `${sd} to ${et}, ${ed}`;
    return `to ${et}, ${ed}`;
  }
  if (sd && ed && !sameDay) return `${sd} to ${ed}`;
  if (sd) return sd;
  return "";
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function generateGuid(contest: Contest): string {
  const slug = contest.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const time = contest.startTime ?? contest.startDate;
  return `darc-calendar://${slug}-${time}`;
}

const WEEKDAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function rssDate(d: Date): string {
  const wd  = WEEKDAYS[d.getUTCDay()];
  const day = String(d.getUTCDate()).padStart(2, "0");
  const mon = MONTH_ABBR[d.getUTCMonth()];
  const yr  = d.getUTCFullYear();
  const hh  = String(d.getUTCHours()).padStart(2, "0");
  const mm  = String(d.getUTCMinutes()).padStart(2, "0");
  const ss  = String(d.getUTCSeconds()).padStart(2, "0");
  return `${wd}, ${day} ${mon} ${yr} ${hh}:${mm}:${ss} +0000`;
}

function toRss(contests: Contest[]): string {
  const now = rssDate(new Date());
  const items = contests.map(c => {
    const desc = escapeXml(buildDescription(c));
    const title = escapeXml(c.name);
    const link = escapeXml(c.infoUrl);
    const guid = escapeXml(generateGuid(c));
    return `<item>
<title>${title}</title>
<link>${link}</link>
<description>${desc}</description>
<guid>${guid}</guid>
</item>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="utf-8" ?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>DARC Contest Calendar</title>
<link>${BASE_URL}</link>
<description>Calendar of ham radio contests from DARC</description>
<language>de-de</language>
<lastBuildDate>${now}</lastBuildDate>
<atom:link href="${CALENDAR_URL}" rel="self" type="application/rss+xml" />
${items}
</channel>
</rss>`;
}

// Merge contests that were split across week boundaries in the DARC calendar.
// A "start-only" entry (has startTime, no endTime) is matched with an "end-only"
// entry (no startTime, has endTime) by same name OR same URL, picking the nearest
// end date that is after the start date.
function mergeWeekSplitContests(contests: Contest[]): Contest[] {
  const startOnly: Contest[] = [];
  const endOnly: Contest[] = [];
  const complete: Contest[] = [];

  for (const c of contests) {
    if (c.startTime && !c.endTime) startOnly.push(c);
    else if (!c.startTime && c.endTime) endOnly.push(c);
    else complete.push(c);
  }

  const usedEnd = new Set<number>();
  const merged: Contest[] = [];

  for (const start of startOnly) {
    let matchIdx = -1;
    let matchDist = "9999-99-99";
    for (let i = 0; i < endOnly.length; i++) {
      if (usedEnd.has(i)) continue;
      const end = endOnly[i];
      const sameName = end.name === start.name;
      const sameUrl  = end.infoUrl !== CALENDAR_URL && end.infoUrl === start.infoUrl;
      if (!sameName && !sameUrl) continue;
      if (end.endDate <= start.startDate) continue;
      if (end.endDate < matchDist) { matchDist = end.endDate; matchIdx = i; }
    }
    if (matchIdx >= 0) {
      usedEnd.add(matchIdx);
      const end = endOnly[matchIdx];
      // Keep start's name (usually more complete); take end's endDate/endTime
      merged.push({ ...start, endTime: end.endTime, endDate: end.endDate });
    } else {
      merged.push(start);
    }
  }

  for (let i = 0; i < endOnly.length; i++) {
    if (!usedEnd.has(i)) merged.push(endOnly[i]);
  }

  return [...complete, ...merged];
}

async function main() {
  const useRss = process.argv.includes("--rss") ||
    (process.argv.includes("--format") &&
     process.argv[process.argv.indexOf("--format") + 1] === "rss");

  console.error("Fetching month URLs from main calendar page...");
  const monthUrls = await getMonthUrls();
  console.error(`Found ${monthUrls.length} month pages`);

  const allContests: Contest[] = [];

  for (const url of monthUrls) {
    const monthName = url.match(/\/(\d{6})\//)?.[1] ?? url;
    console.error(`Parsing ${monthName}...`);
    try {
      const contests = await parseMonthPage(url);
      allContests.push(...contests);
      // Small delay to be polite to the server
      await Bun.sleep(300);
    } catch (err) {
      console.error(`  Error: ${err}`);
    }
  }

  // Remove duplicates (same name + date + start time)
  const seen = new Set<string>();
  const unique = allContests.filter(c => {
    const key = `${c.name}|${c.startDate}|${c.startTime}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const merged = mergeWeekSplitContests(unique);

  // Apply default times: 00:00Z for missing startTime, 23:59Z for missing endTime
  const final = merged.map(c => ({
    ...c,
    startTime: c.startTime ?? (c.startDate !== "unknown" ? `${c.startDate}T00:00:00Z` : null),
    endTime:   c.endTime   ?? (c.endDate   !== "unknown" ? `${c.endDate}T23:59:00Z`   : null),
  }));

  console.error(`\nTotal contests: ${final.length}`);
  if (useRss) {
    console.log(toRss(final));
  } else {
    console.log(JSON.stringify(final, null, 2));
  }
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
