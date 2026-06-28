const JST_OFFSET_SUFFIX = "+09:00";
const SLOT_MINUTES = 30;

export function parseTimezoneCsv(text) {
  const lines = String(text).trim().split(/\r?\n/);
  if (lines.length && lines[0].toLowerCase().startsWith("utc_offset")) {
    lines.shift();
  }

  return lines
    .filter(Boolean)
    .map((line) => {
      const [offsetText, iana = "", ...labelParts] = line.split(",");
      const offset = Number.parseFloat(offsetText);
      return {
        offset,
        iana: iana.trim(),
        label: labelParts.join(",").trim(),
      };
    })
    .filter((option) => option.iana && option.label && !Number.isNaN(option.offset));
}

export function getTimezoneOptionByIana(options, iana) {
  return options.find((option) => option.iana === iana) ?? null;
}

export function getResolvedTimeZone(timeZone, fallbackTimeZone = "UTC") {
  if (isValidTimeZone(timeZone)) {
    return timeZone;
  }

  if (isValidTimeZone(fallbackTimeZone)) {
    return fallbackTimeZone;
  }

  return "UTC";
}

export function collectWeekOffsets(slots, timeZone) {
  const resolvedTimeZone = getResolvedTimeZone(timeZone);
  const offsets = new Set();
  const sortedSlots = [...slots].sort(compareSlotsChronologically);

  for (const slot of sortedSlots) {
    const startUtc = getSlotStartUtc(slot);
    const endUtc = new Date(startUtc.getTime() + SLOT_MINUTES * 60_000);
    offsets.add(getUtcOffsetLabel(startUtc, resolvedTimeZone));
    offsets.add(getUtcOffsetLabel(endUtc, resolvedTimeZone));
  }

  return [...offsets];
}

export function collectDisplayedWeekOffsets(startDate, timeZone, dayCount = 7) {
  const slots = [];

  for (let dayOffset = 0; dayOffset < dayCount; dayOffset += 1) {
    const date = addDaysToDateString(startDate, dayOffset);

    for (let slot = 0; slot < 48; slot += 1) {
      slots.push({ date, slot });
    }
  }

  return collectWeekOffsets(slots, timeZone);
}

export function getDisplayedWeekTimezoneMeta(startDate, timeZone, dayCount = 7, fallbackTimeZone = "UTC") {
  const offsets = collectDisplayedWeekOffsets(
    startDate,
    getResolvedTimeZone(timeZone, fallbackTimeZone),
    dayCount,
  );
  return {
    offsetLabel: offsets.join(" / "),
    hasTransition: offsets.length > 1,
  };
}

export function getWeekTimezoneMeta(slots, timeZone) {
  const offsets = collectWeekOffsets(slots, timeZone);
  return {
    offsetLabel: offsets.join(" / "),
    hasTransition: offsets.length > 1,
  };
}

export function buildTargetTimezoneLines(slots, timeZone, outputFormat = "JP") {
  const grouped = groupConvertedIntervals(slots, timeZone);

  return grouped.map(({ month, day, weekday, intervals }) => {
    const formattedDate = formatDateLabel({ month, day, weekday }, outputFormat);
    const needsSuffixes =
      intervals.some((interval) => interval.crossesOffset) ||
      new Set(intervals.map((interval) => `${interval.startLabel}-${interval.endLabel}`)).size !==
        intervals.length;
    const formattedIntervals = intervals
      .map((interval) => formatInterval(interval, outputFormat, needsSuffixes))
      .join(", ");

    return `${formattedDate} ${formattedIntervals}`;
  });
}

function groupConvertedIntervals(slots, timeZone) {
  const sortedIntervals = slots
    .map((slot) => buildConvertedInterval(slot, timeZone))
    .sort((a, b) => a.startUtcMs - b.startUtcMs);

  const groups = [];

  for (const interval of sortedIntervals) {
    const currentGroup = groups.at(-1);
    const previous = currentGroup?.intervals.at(-1);

    if (currentGroup && sameLocalDate(currentGroup, interval) && canMergeIntervals(previous, interval)) {
      previous.endUtcMs = interval.endUtcMs;
      previous.endLabel = interval.endLabel;
      previous.endOffset = interval.endOffset;
      previous.endZoneName = interval.endZoneName;
      previous.crossesOffset = previous.crossesOffset || interval.crossesOffset;
      continue;
    }

    if (!currentGroup || !sameLocalDate(currentGroup, interval)) {
      groups.push({
        month: interval.month,
        day: interval.day,
        weekday: interval.weekday,
        dateKey: interval.dateKey,
        intervals: [cloneInterval(interval)],
      });
      continue;
    }

    currentGroup.intervals.push(cloneInterval(interval));
  }

  return groups;
}

function cloneInterval(interval) {
  return {
    startUtcMs: interval.startUtcMs,
    endUtcMs: interval.endUtcMs,
    startLabel: interval.startLabel,
    endLabel: interval.endLabel,
    startOffset: interval.startOffset,
    endOffset: interval.endOffset,
    startZoneName: interval.startZoneName,
    endZoneName: interval.endZoneName,
    crossesOffset: interval.crossesOffset,
  };
}

function buildConvertedInterval(slot, timeZone) {
  const startUtc = getSlotStartUtc(slot);
  const endUtc = new Date(startUtc.getTime() + SLOT_MINUTES * 60_000);
  const startLocal = getLocalParts(startUtc, timeZone);
  const endLocal = getLocalParts(endUtc, timeZone);
  const startOffset = getUtcOffsetLabel(startUtc, timeZone);
  const endOffset = getUtcOffsetLabel(endUtc, timeZone);
  const startZoneName = getShortZoneName(startUtc, timeZone);
  const endZoneName = getShortZoneName(endUtc, timeZone);

  return {
    month: startLocal.month,
    day: startLocal.day,
    weekday: startLocal.weekday,
    dateKey: startLocal.dateKey,
    startUtcMs: startUtc.getTime(),
    endUtcMs: endUtc.getTime(),
    startLabel: formatClock(startLocal.hour, startLocal.minute, "JP"),
    endLabel: formatClock(endLocal.hour, endLocal.minute, "JP"),
    startOffset,
    endOffset,
    startZoneName,
    endZoneName,
    crossesOffset: startOffset !== endOffset || startZoneName !== endZoneName,
  };
}

function canMergeIntervals(previous, current) {
  return (
    previous &&
    previous.endUtcMs === current.startUtcMs &&
    previous.endLabel === current.startLabel &&
    previous.endOffset === current.startOffset &&
    previous.endZoneName === current.startZoneName &&
    !previous.crossesOffset &&
    !current.crossesOffset
  );
}

function sameLocalDate(left, right) {
  return left.dateKey === right.dateKey;
}

function compareSlotsChronologically(left, right) {
  if (left.date !== right.date) {
    return left.date.localeCompare(right.date);
  }

  return left.slot - right.slot;
}

function getSlotStartUtc(slot) {
  const hour = String(Math.floor(slot.slot / 2)).padStart(2, "0");
  const minute = slot.slot % 2 === 0 ? "00" : "30";
  return new Date(`${slot.date}T${hour}:${minute}:00${JST_OFFSET_SUFFIX}`);
}

function addDaysToDateString(dateText, dayOffset) {
  const [year, month, day] = dateText.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + dayOffset);
  const nextYear = date.getUTCFullYear();
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, "0");
  const nextDay = String(date.getUTCDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function getLocalParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);

  return {
    month,
    day,
    hour: Number(values.hour),
    minute: Number(values.minute),
    weekday: {
      JP: getWeekdayLabel(year, month, day, "ja-JP"),
      EN: getWeekdayLabel(year, month, day, "en-US"),
    },
    dateKey: `${values.year}-${values.month}-${values.day}`,
  };
}

function getWeekdayLabel(year, month, day, locale) {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function isValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function getUtcOffsetLabel(date, timeZone) {
  const offsetPart = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName");

  if (!offsetPart || offsetPart.value === "GMT") {
    return "UTC+00:00";
  }

  const normalized = offsetPart.value.replace("GMT", "UTC");
  const match = normalized.match(/^UTC([+-])(\d{1,2})(?::(\d{2}))?$/);

  if (!match) {
    return normalized;
  }

  const [, sign, hours, minutes = "00"] = match;
  return `UTC${sign}${hours.padStart(2, "0")}:${minutes}`;
}

function getShortZoneName(date, timeZone) {
  return (
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "short",
    })
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value ?? ""
  );
}

function formatDateLabel({ month, day, weekday }, outputFormat) {
  if (outputFormat === "JP") {
    return `${month}/${day}(${weekday.JP})`;
  }

  const utcDate = new Date(Date.UTC(2000, month - 1, day));
  const monthLabel = utcDate.toLocaleDateString("en-US", {
    month: "long",
    timeZone: "UTC",
  });
  return `${monthLabel} ${day} (${weekday.EN})`;
}

function formatInterval(interval, outputFormat, needsSuffixes) {
  const includeEndSuffix = needsSuffixes || interval.crossesOffset;
  const includeStartSuffix = interval.crossesOffset;
  const startText = formatIntervalEndpoint(
    interval.startLabel,
    interval.startZoneName,
    outputFormat,
    includeStartSuffix,
  );
  const endText = formatIntervalEndpoint(
    interval.endLabel,
    interval.endZoneName,
    outputFormat,
    includeEndSuffix,
  );
  return `${startText}-${endText}`;
}

function formatIntervalEndpoint(label, zoneName, outputFormat, includeSuffixes) {
  const formattedLabel = outputFormat === "EN" ? convertClockLabelToEn(label) : label;
  return includeSuffixes ? `${formattedLabel} ${zoneName}` : formattedLabel;
}

function convertClockLabelToEn(label) {
  const [hourText, minuteText] = label.split(":");
  return formatClock(Number(hourText), Number(minuteText), "EN");
}

function formatClock(hour, minute, outputFormat) {
  const text = `${hour}:${String(minute).padStart(2, "0")}`;

  if (outputFormat === "JP") {
    return text;
  }

  const displayHour = hour % 12 || 12;
  const suffix = hour < 12 ? "AM" : "PM";
  return `${displayHour}:${String(minute).padStart(2, "0")}${suffix}`;
}
