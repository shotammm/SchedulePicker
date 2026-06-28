import test from "node:test";
import assert from "node:assert/strict";

const timezoneModule = await import("../js/timezone.js");
const {
  buildTargetTimezoneLines,
  collectDisplayedWeekOffsets,
  getDisplayedWeekTimezoneMeta,
  collectWeekOffsets,
  getTimezoneOptionByIana,
  getWeekTimezoneMeta,
  parseTimezoneCsv,
} = timezoneModule.default ?? timezoneModule;

const CSV_TEXT = `UTC_Offset,IANA,Timezone
-8,America/Los_Angeles,North America / Los Angeles
8,Asia/Singapore,Asia / Singapore
5.75,Asia/Kathmandu,Asia / Kathmandu
10,Australia/Sydney,Oceania / Sydney
`;

test("parseTimezoneCsv keeps labels and iana ids", () => {
  const options = parseTimezoneCsv(CSV_TEXT);
  assert.equal(options.length, 4);
  assert.deepEqual(options[0], {
    offset: -8,
    iana: "America/Los_Angeles",
    label: "North America / Los Angeles",
  });
});

test("Los Angeles DST end week mixes PDT and PST correctly", () => {
  const slots = [
    { date: "2026-11-01", slot: 0 },
    { date: "2026-11-01", slot: 1 },
    { date: "2026-11-02", slot: 0 },
    { date: "2026-11-02", slot: 1 },
  ];

  const lines = buildTargetTimezoneLines(slots, "America/Los_Angeles", "JP");
  assert.deepEqual(lines, [
    "10/31(土) 8:00-9:00",
    "11/1(日) 7:00-8:00",
  ]);
});

test("fallback-boundary intervals keep explicit DST suffixes", () => {
  const slots = [{ date: "2026-11-01", slot: 35 }];

  const lines = buildTargetTimezoneLines(slots, "America/Los_Angeles", "JP");
  assert.deepEqual(lines, ["11/1(日) 1:30 PDT-1:00 PST"]);
});

test("repeated local times stay split by timezone suffix", () => {
  const slots = [
    { date: "2026-11-01", slot: 34 },
    { date: "2026-11-01", slot: 36 },
  ];

  const lines = buildTargetTimezoneLines(slots, "America/Los_Angeles", "JP");
  assert.deepEqual(lines, [
    "11/1(日) 1:00-1:30 PDT, 1:00-1:30 PST",
  ]);
});

test("collectWeekOffsets returns both offsets for a DST transition week", () => {
  const slots = [
    { date: "2026-11-01", slot: 0 },
    { date: "2026-11-02", slot: 0 },
  ];

  assert.deepEqual(
    collectWeekOffsets(slots, "America/Los_Angeles"),
    ["UTC-07:00", "UTC-08:00"],
  );
});

test("collectWeekOffsets includes both offsets for a single boundary-crossing slot", () => {
  const slots = [{ date: "2026-11-01", slot: 35 }];

  assert.deepEqual(
    collectWeekOffsets(slots, "America/Los_Angeles"),
    ["UTC-07:00", "UTC-08:00"],
  );
});

test("displayed JST week offsets stay automatic before any slots are selected", () => {
  assert.deepEqual(
    collectDisplayedWeekOffsets("2026-10-26", "America/Los_Angeles"),
    ["UTC-07:00", "UTC-08:00"],
  );
});

test("displayed JST spring-forward week keeps chronological offset order", () => {
  assert.deepEqual(
    collectDisplayedWeekOffsets("2026-03-02", "America/Los_Angeles"),
    ["UTC-08:00", "UTC-07:00"],
  );
});

test("getWeekTimezoneMeta reports transition weeks", () => {
  const slots = [
    { date: "2026-11-01", slot: 0 },
    { date: "2026-11-02", slot: 0 },
  ];

  assert.deepEqual(getWeekTimezoneMeta(slots, "America/Los_Angeles"), {
    offsetLabel: "UTC-07:00 / UTC-08:00",
    hasTransition: true,
  });
});

test("displayed-week metadata stays tied to the rendered week", () => {
  assert.deepEqual(
    getDisplayedWeekTimezoneMeta("2026-06-22", "America/Los_Angeles"),
    {
      offsetLabel: "UTC-07:00",
      hasTransition: false,
    },
  );

  assert.deepEqual(
    getDisplayedWeekTimezoneMeta("2026-10-26", "America/Los_Angeles"),
    {
      offsetLabel: "UTC-07:00 / UTC-08:00",
      hasTransition: true,
    },
  );
});

test("displayed-week metadata falls back safely for invalid saved timezone ids", () => {
  assert.deepEqual(
    getDisplayedWeekTimezoneMeta("2026-06-22", "Not/A_Real_Timezone", 7, "America/Los_Angeles"),
    {
      offsetLabel: "UTC-07:00",
      hasTransition: false,
    },
  );
});

test("fractional offset zones stay accurate", () => {
  const slots = [{ date: "2026-07-01", slot: 12 }];
  const lines = buildTargetTimezoneLines(slots, "Asia/Kathmandu", "JP");
  assert.deepEqual(lines, ["7/1(水) 2:45-3:15"]);
});

test("no-DST zones keep one stable offset", () => {
  const slots = [{ date: "2026-07-01", slot: 0 }];
  assert.deepEqual(collectWeekOffsets(slots, "Asia/Singapore"), ["UTC+08:00"]);
});

test("timezone lookup resolves the selected option by iana id", () => {
  const options = parseTimezoneCsv(CSV_TEXT);
  assert.equal(
    getTimezoneOptionByIana(options, "Australia/Sydney").label,
    "Oceania / Sydney",
  );
});

test("EN date labels keep the converted date weekday", () => {
  const slots = [{ date: "2026-07-01", slot: 0 }];
  const lines = buildTargetTimezoneLines(slots, "Asia/Singapore", "EN");
  assert.deepEqual(lines, ["June 30 (Tue) 11:00PM-11:30PM"]);
});
