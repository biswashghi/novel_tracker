import test from "node:test";
import assert from "node:assert/strict";
import { novelsToCsv, toCsv } from "../src/lib/csv.js";

test("toCsv quotes delimiters, quotes and line breaks per RFC 4180", () => {
  assert.equal(
    toCsv([["plain", "a,b", 'say "hi"', "line\nbreak", 3, null]]),
    'plain,"a,b","say ""hi""","line\nbreak",3,\r\n'
  );
});

test("toCsv neutralizes cells a spreadsheet would run as formulas", () => {
  assert.equal(toCsv([["=1+1", "+cmd", "-2", "@SUM(A1)", "safe-dash"]]), "'=1+1,'+cmd,'-2,'@SUM(A1),safe-dash\r\n");
  assert.equal(toCsv([['=HYPERLINK("x")']]), `"'=HYPERLINK(""x"")"\r\n`);
});

test("novelsToCsv writes a header row and one row per novel", () => {
  const csv = novelsToCsv([
    {
      title: "Beware Of Chicken",
      sourceSite: "royalroad.com",
      novelHomeUrl: "https://www.royalroad.com/fiction/39408/beware-of-chicken",
      lastReadChapterLabel: "Chapter 63",
      lastReadChapterUrl: "https://www.royalroad.com/fiction/39408/beware-of-chicken/chapter/1/c63",
      status: "active",
      rating: 4,
      tags: ["cozy", "cultivation"],
      notes: "Great, relaxing",
      chapterHistory: [{}, {}, {}],
      updatedAt: "2026-09-20T18:00:00.000Z"
    },
    { title: "Unrated", sourceSite: "example.com", status: "paused", rating: 0 }
  ]);

  const lines = csv.trimEnd().split("\r\n");
  assert.equal(lines[0], "Title,Source,Novel page,Chapter,Chapter URL,Status,Rating,Tags,Notes,Chapters read,Last read");
  assert.equal(
    lines[1],
    'Beware Of Chicken,royalroad.com,https://www.royalroad.com/fiction/39408/beware-of-chicken,Chapter 63,' +
      'https://www.royalroad.com/fiction/39408/beware-of-chicken/chapter/1/c63,active,4,cozy; cultivation,' +
      '"Great, relaxing",3,2026-09-20T18:00:00.000Z'
  );
  assert.equal(lines[2], "Unrated,example.com,,,,paused,,,,,");
});
