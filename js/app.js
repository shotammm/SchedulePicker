// --- 定数 ---
const DAYS = ["月", "火", "水", "木", "金", "土", "日"];
const TIME_SLOTS = Array.from({length: 48}, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0');
  const m = i % 2 === 0 ? '00' : '30';
  return `${h}:${m}`;
});
const EMPHASIZED_SLOT_INDEXES = new Set([12, 24, 36]); // 6:00, 12:00, 18:00
// 24時間分（48コマ）全て描画、表示は10時間分（20コマ）分の高さ
const VISIBLE_SLOT_START = 0; // 表示開始スロット（0=0:00）
const VISIBLE_SLOT_COUNT = 20; // 10時間分（20コマ）
const DEFAULT_SCROLL_SLOT = 16; // 8:00
const JST_UTC_OFFSET = 9;
const DEFAULT_TZ_IANA = 'America/Los_Angeles';
const EMBEDDED_TIMEZONE_CSV = `UTC_Offset,IANA,Timezone
-9.5,Pacific/Marquesas,太平洋 / Marquesas (UTC-09:30, DSTなし)
-8,America/Los_Angeles,北米 / Los Angeles (UTC-08:00, DSTあり)
-7,America/Denver,北米 / Denver (UTC-07:00, DSTあり)
-6,America/Chicago,北米 / Chicago (UTC-06:00, DSTあり)
-5,America/New_York,北米 / New York (UTC-05:00, DSTあり)
0,Europe/London,欧州 / London (UTC+00:00, DSTあり)
1,Europe/Berlin,欧州 / Berlin (UTC+01:00, DSTあり)
2,Africa/Johannesburg,アフリカ / Johannesburg (UTC+02:00, DSTなし)
3,Europe/Helsinki,欧州 / Helsinki (UTC+03:00, DSTあり)
5,Asia/Karachi,アジア / Karachi (UTC+05:00, DSTなし)
5.5,Asia/Kolkata,アジア / Kolkata (UTC+05:30, DSTなし)
5.75,Asia/Kathmandu,アジア / Kathmandu (UTC+05:45, DSTなし)
6,Asia/Dhaka,アジア / Dhaka (UTC+06:00, DSTなし)
6.5,Asia/Yangon,アジア / Yangon (UTC+06:30, DSTなし)
7,Asia/Bangkok,アジア / Bangkok (UTC+07:00, DSTなし)
8,Asia/Singapore,アジア / Singapore (UTC+08:00, DSTなし)
9,Asia/Tokyo,アジア / Tokyo (UTC+09:00, DSTなし)
9.5,Australia/Adelaide,オセアニア / Adelaide (UTC+09:30, DSTあり)
10,Australia/Sydney,オセアニア / Sydney (UTC+10:00, DSTあり)
11,Pacific/Noumea,太平洋 / Noumea (UTC+11:00, DSTなし)
12,Pacific/Auckland,太平洋 / Auckland (UTC+12:00, DSTあり)
12.75,Pacific/Chatham,太平洋 / Chatham (UTC+12:45, DSTあり)
13,Pacific/Apia,太平洋 / Apia (UTC+13:00, DSTなし)
14,Pacific/Kiritimati,太平洋 / Kiritimati (UTC+14:00, DSTなし)
`;

// --- 状態 ---
let baseMonday = getMonday(dayjs()); // 表示中週の月曜
// 選択状態は日付＋時間帯で管理
let selectedSlots = []; // [{date: 'YYYY-MM-DD', slot: number}]
let hoverCell = null; // {dayIdx, slotIdx}
let outputFormat = localStorage.getItem('schedulepicker_output_format') || 'JP'; // JP or EN
let timezoneOptions = []; // [{offset:number,iana:string,label:string}]
let selectedTimezoneIndex = 0;
let selectedTimezoneOffset = -8; // 既定: 太平洋標準時
// ドラッグ選択の状態
let isDragging = false;
let dragStart = null;   // {dayIdx, slotIdx}
let dragCurrent = null; // {dayIdx, slotIdx}
let dragMode = 'select'; // 'select' | 'deselect'
let dragAppliedAt = 0;  // 直近ドラッグ確定時刻（クリック抑止用）
// 履歴（取り消し／やり直し）
let undoStack = []; // [{ added: SlotRef[], removed: SlotRef[] }]
let redoStack = [];
const UNDO_LIMIT = 10; // 履歴の上限

// --- 初期化 ---
dayjs.locale('ja');
renderAll();
bindEvents();

// --- 関数 ---
function getMonday(d) {
  const dow = d.day();
  return d.subtract((dow + 6) % 7, 'day').startOf('day');
}
function renderAll() {
  renderHeader();
  renderCalendar();
  renderOutputs();
}
function renderHeader() {
  const weekLabel = document.getElementById('weekLabel');
  weekLabel.textContent = `${baseMonday.format('YYYY/MM/DD')}週`;
}
function renderCalendar() {
  const cal = document.getElementById('calendar');
  let html = '<div class="header"></div>';
  for (let i = 0; i < 7; i++) {
    const d = baseMonday.add(i, 'day');
    let headerClass = '';
    if (hoverCell && hoverCell.dayIdx === i) headerClass = 'hover';
    if (d.isSame(dayjs(), 'day')) headerClass += (headerClass ? ' ' : '') + 'today';
    html += `<div class="header${headerClass ? ` ${headerClass}` : ''}" data-day="${i}">${d.format('M/D')}(${DAYS[i]})</div>`;
  }
  for (let t = 0; t < 48; t++) {
    const emphasizedClass = EMPHASIZED_SLOT_INDEXES.has(t) ? ' emphasized-line' : '';
    let timeClass = '';
    if (hoverCell && hoverCell.slotIdx === t) timeClass = 'hover';
    html += `<div class="time ${timeClass}${emphasizedClass}" data-slot="${t}">${TIME_SLOTS[t]}</div>`;
    for (let d = 0; d < 7; d++) {
      const date = baseMonday.add(d, 'day').format('YYYY-MM-DD');
      let cellClass = '';
      if (selectedSlots.some(s => s.date === date && s.slot === t)) cellClass = 'selected';
      if (hoverCell && hoverCell.dayIdx === d && hoverCell.slotIdx === t) cellClass += ' hover';
      if (isDragging && isCellInCurrentRect(d, t)) cellClass += (cellClass ? ' ' : '') + 'preview';
      html += `<div class="cell${cellClass ? ` ${cellClass}` : ''}${emphasizedClass}" data-day="${d}" data-slot="${t}"></div>`;
    }
  }
  cal.innerHTML = html;
}
function renderOutputs() {
  const outJ = document.getElementById('outputJST');
  const outT = document.getElementById('outputTZ');
  if (selectedSlots.length === 0) {
    outJ.textContent = '';
    outT.textContent = '';
    return;
  }
  const jstLines = buildJstLines();
  const tzLines = buildTzLines();
  outJ.textContent = jstLines.join('\n');
  outT.textContent = tzLines.join('\n');
}

function buildJstLines() {
  let byDate = {};
  selectedSlots.forEach(s => {
    if (!byDate[s.date]) byDate[s.date] = [];
    byDate[s.date].push(s.slot);
  });
  let lines = [];
  Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).forEach(([date, slots]) => {
    slots.sort((a, b) => a - b);
    let ranges = [];
    let start = slots[0], end = slots[0];
    for (let i = 1; i <= slots.length; i++) {
      if (slots[i] === end + 1) {
        end = slots[i];
      } else {
        ranges.push([start, end]);
        start = end = slots[i];
      }
    }
    let segs = ranges.map(([s, e]) => formatSlotTime(s, e, outputFormat));
    let d = dayjs(date);
    if (outputFormat === 'JP') {
      lines.push(`${d.format('M/D(ddd)')} ${segs.join(', ')}`);
    } else {
      const month = d.toDate().toLocaleDateString('en-US', { month: 'long' });
      const dayNum = d.toDate().toLocaleDateString('en-US', { day: 'numeric' });
      const weekday = d.toDate().toLocaleDateString('en-US', { weekday: 'short' });
      const dateStr = `${month} ${dayNum} (${weekday})`;
      lines.push(`${dateStr} ${segs.join(', ')}`);
    }
  });
  return lines;
}

function buildTzLines() {
  const deltaMinutes = Math.round((selectedTimezoneOffset - JST_UTC_OFFSET) * 60);
  // すべての選択スロットをターゲットTZの日時に変換
  let byDate = {}; // dateStr -> array of dayjs
  selectedSlots.forEach(s => {
    const date = s.date;
    const h = Math.floor(s.slot / 2);
    const m = s.slot % 2 === 0 ? 0 : 30;
    const dtJ = dayjs(date).hour(h).minute(m).second(0).millisecond(0);
    const dtT = dtJ.add(deltaMinutes, 'minute');
    const dateStr = dtT.format('YYYY-MM-DD');
    if (!byDate[dateStr]) byDate[dateStr] = [];
    byDate[dateStr].push(dtT);
  });
  // 各日付で30分連結を検出
  let lines = [];
  Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).forEach(([dateStr, arr]) => {
    arr.sort((a, b) => a.valueOf() - b.valueOf());
    let ranges = [];
    let start = arr[0];
    let prev = arr[0];
    for (let i = 1; i <= arr.length; i++) {
      if (arr[i] && arr[i].diff(prev, 'minute') === 30) {
        prev = arr[i];
      } else {
        const end = prev.add(30, 'minute');
        ranges.push([start, end]);
        start = arr[i];
        prev = arr[i];
      }
    }
    const segs = ranges.map(([s, e]) => `${formatTimeFromDate(s, outputFormat)}-${formatTimeFromDate(e, outputFormat)}`);
    const d = dayjs(dateStr);
    if (outputFormat === 'JP') {
      lines.push(`${d.format('M/D(ddd)')} ${segs.join(', ')}`);
    } else {
      const month = d.toDate().toLocaleDateString('en-US', { month: 'long' });
      const dayNum = d.toDate().toLocaleDateString('en-US', { day: 'numeric' });
      const weekday = d.toDate().toLocaleDateString('en-US', { weekday: 'short' });
      const dateLabel = `${month} ${dayNum} (${weekday})`;
      lines.push(`${dateLabel} ${segs.join(', ')}`);
    }
  });
  return lines;
}
function formatSlotTime(s, e, format) {
  const start = slotToTime(s);
  const end = slotToTime(e + 1);
  if (format === 'JP') {
    return `${start}-${end}`;
  }
  return `${to12h(start)}–${to12h(end)}`;
}
function formatTimeFromDate(dt, format) {
  const h = dt.hour();
  const m = String(dt.minute()).padStart(2, '0');
  const t = `${h}:${m}`;
  return format === 'JP' ? t : to12h(t);
}
function slotToTime(idx) {
  const h = Math.floor(idx / 2);
  const m = idx % 2 === 0 ? '00' : '30';
  return `${h}:${m}`;
}
function to12h(t) {
  let [h, m] = t.split(':');
  h = +h;
  const ampm = h < 12 ? 'AM' : 'PM';
  h = h % 12 || 12;
  return `${h}:${m}${ampm}`;
}
function bindEvents() {
  document.getElementById('prevWeek').onclick = () => {
    baseMonday = baseMonday.subtract(7, 'day');
    renderAll();
  };
  document.getElementById('nextWeek').onclick = () => {
    baseMonday = baseMonday.add(7, 'day');
    renderAll();
  };
  document.getElementById('todayBtn').onclick = () => {
    baseMonday = getMonday(dayjs());
    renderAll();
  };
  document.getElementById('clearBtn').onclick = () => {
    if (selectedSlots.length === 0) return;
    const removed = selectedSlots.map(s => ({ ...s }));
    pushOperation({ added: [], removed });
    selectedSlots = [];
    renderAll();
  };
  document.getElementById('outputFormatToggle').onclick = () => {
    outputFormat = (outputFormat === 'JP') ? 'EN' : 'JP';
    localStorage.setItem('schedulepicker_output_format', outputFormat);
    renderOutputs();
    updateFormatToggleText();
  };
  const calEl = document.getElementById('calendar');
  calEl.onclick = onCalClick;
  calEl.onmousemove = onCalHover;
  calEl.onmouseleave = () => { if (!isDragging) { hoverCell = null; renderCalendar(); } };
  calEl.onmousedown = onCalMouseDown;
  document.addEventListener('mouseup', onDocMouseUp);
  document.getElementById('outputJST').onclick = () => onCopyById('outputJST');
  document.getElementById('outputTZ').onclick = () => onCopyById('outputTZ');
  const tzSel = document.getElementById('timezoneSelect');
  tzSel.onchange = () => {
    selectedTimezoneIndex = +tzSel.value;
    selectedTimezoneOffset = timezoneOptions[selectedTimezoneIndex].offset;
    renderOutputs();
  };
  window.onbeforeunload = () => {
    selectedSlots = [];
  };
  document.addEventListener('keydown', onKeyDown);
}
function onCalClick(e) {
  // 直前にドラッグ確定があればクリックを無視（ダブル適用防止）
  if (Date.now() - dragAppliedAt < 200) return;
  const cell = e.target.closest('.cell');
  if (!cell) return;
  const dayIdx = +cell.dataset.day;
  const slot = +cell.dataset.slot;
  const date = baseMonday.add(dayIdx, 'day').format('YYYY-MM-DD');
  const exists = selectedSlots.some(s => s.date === date && s.slot === slot);
  if (exists) {
    pushOperation({ added: [], removed: [{ date, slot }] });
    removeSelectedIfPresent(date, slot);
  } else {
    pushOperation({ added: [{ date, slot }], removed: [] });
    addSelectedIfAbsent(date, slot);
  }
  renderAll();
}
function onCalHover(e) {
  const cell = e.target.closest('.cell');
  if (cell) {
    hoverCell = { dayIdx: +cell.dataset.day, slotIdx: +cell.dataset.slot };
  } else {
    hoverCell = null;
  }
  if (isDragging) {
    dragCurrent = hoverCell ? { ...hoverCell } : dragCurrent;
  }
  renderCalendar();
}
function onCalMouseDown(e) {
  const cell = e.target.closest('.cell');
  if (!cell) return;
  const dayIdx = +cell.dataset.day;
  const slotIdx = +cell.dataset.slot;
  dragStart = { dayIdx, slotIdx };
  dragCurrent = { dayIdx, slotIdx };
  // 開始セルの選択状態でモード決定
  const date = baseMonday.add(dayIdx, 'day').format('YYYY-MM-DD');
  const isStartSelected = selectedSlots.some(s => s.date === date && s.slot === slotIdx);
  dragMode = isStartSelected ? 'deselect' : 'select';
  isDragging = true;
  e.preventDefault();
  renderCalendar();
}
function onDocMouseUp() {
  if (!isDragging || !dragStart || !dragCurrent) return;
  const [dayMin, dayMax] = [Math.min(dragStart.dayIdx, dragCurrent.dayIdx), Math.max(dragStart.dayIdx, dragCurrent.dayIdx)];
  const [slotMin, slotMax] = [Math.min(dragStart.slotIdx, dragCurrent.slotIdx), Math.max(dragStart.slotIdx, dragCurrent.slotIdx)];
  let added = [];
  let removed = [];
  if (dragMode === 'select') {
    for (let d = dayMin; d <= dayMax; d++) {
      const date = baseMonday.add(d, 'day').format('YYYY-MM-DD');
      for (let t = slotMin; t <= slotMax; t++) {
        if (!selectedSlots.some(s => s.date === date && s.slot === t)) {
          added.push({ date, slot: t });
        }
      }
    }
    added.forEach(({ date, slot }) => addSelectedIfAbsent(date, slot));
  } else {
    // deselect
    for (let d = dayMin; d <= dayMax; d++) {
      const date = baseMonday.add(d, 'day').format('YYYY-MM-DD');
      for (let t = slotMin; t <= slotMax; t++) {
        if (selectedSlots.some(s => s.date === date && s.slot === t)) {
          removed.push({ date, slot: t });
        }
      }
    }
    removed.forEach(({ date, slot }) => removeSelectedIfPresent(date, slot));
  }
  isDragging = false;
  dragStart = null;
  dragCurrent = null;
  dragAppliedAt = Date.now();
  if (added.length || removed.length) pushOperation({ added, removed });
  renderAll();
}
function isCellInCurrentRect(dayIdx, slotIdx) {
  if (!isDragging || !dragStart || !dragCurrent) return false;
  const dayMin = Math.min(dragStart.dayIdx, dragCurrent.dayIdx);
  const dayMax = Math.max(dragStart.dayIdx, dragCurrent.dayIdx);
  const slotMin = Math.min(dragStart.slotIdx, dragCurrent.slotIdx);
  const slotMax = Math.max(dragStart.slotIdx, dragCurrent.slotIdx);
  return dayIdx >= dayMin && dayIdx <= dayMax && slotIdx >= slotMin && slotIdx <= slotMax;
}
function addSelectedIfAbsent(date, slot) {
  if (!selectedSlots.some(s => s.date === date && s.slot === slot)) {
    selectedSlots.push({ date, slot });
  }
}
function removeSelectedIfPresent(date, slot) {
  const idx = selectedSlots.findIndex(s => s.date === date && s.slot === slot);
  if (idx >= 0) selectedSlots.splice(idx, 1);
}
function pushOperation(op) {
  // 正規化: 重複排除
  const key = (s) => `${s.date}:${s.slot}`;
  const uniq = (arr) => {
    const seen = new Set();
    const out = [];
    for (const s of arr) {
      const k = key(s);
      if (!seen.has(k)) {
        seen.add(k);
        out.push({ ...s });
      }
    }
    return out;
  };
  const added = uniq(op.added || []);
  const removed = uniq(op.removed || []);
  if (added.length === 0 && removed.length === 0) return;
  undoStack.push({ added, removed });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack.length = 0;
}
function onKeyDown(e) {
  const isCtrl = e.ctrlKey || e.metaKey; // Mac対策（meta）
  if (!isCtrl) return;
  const key = String(e.key).toLowerCase();
  if (key === 'z' && !e.shiftKey) {
    e.preventDefault();
    undoLast();
  } else if ((key === 'z' && e.shiftKey)) {
    e.preventDefault();
    redoLast();
  }
}
function undoLast() {
  if (undoStack.length === 0) return;
  const op = undoStack.pop();
  // 追加分を取り消し＝削除、削除分を取り消し＝追加
  op.added.forEach(({ date, slot }) => removeSelectedIfPresent(date, slot));
  op.removed.forEach(({ date, slot }) => addSelectedIfAbsent(date, slot));
  redoStack.push(op);
  if (redoStack.length > UNDO_LIMIT) redoStack.shift();
  renderAll();
}
function redoLast() {
  if (redoStack.length === 0) return;
  const op = redoStack.pop();
  // やり直し＝元の操作を再適用
  op.removed.forEach(({ date, slot }) => removeSelectedIfPresent(date, slot));
  op.added.forEach(({ date, slot }) => addSelectedIfAbsent(date, slot));
  undoStack.push(op);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  renderAll();
}
function onCopyById(id) {
  const out = document.getElementById(id);
  if (!out.textContent) return;
  navigator.clipboard.writeText(out.textContent);
  out.classList.add('copied');
  setTimeout(() => out.classList.remove('copied'), 800);
}
function updateFormatToggleText() {
  const toggle = document.getElementById('outputFormatToggle');
  toggle.textContent = outputFormat;
}
function scrollCalendarToSlot(slotIdx) {
  const wrapper = document.querySelector('.calendar-wrapper');
  const timeCell = document.querySelector(`.time[data-slot="${slotIdx}"]`);
  if (!wrapper || !timeCell) return;
  const header = document.querySelector('.calendar .header');
  const headerHeight = header ? header.offsetHeight : 0;
  const targetTop = Math.max(0, timeCell.offsetTop - headerHeight);
  wrapper.scrollTop = targetTop;
}
function parseTimezoneCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length && lines[0].toLowerCase().startsWith('utc_offset')) lines.shift();
  return lines.filter(Boolean).map(line => {
    const parts = line.split(',');
    if (parts.length < 3) return null;
    const [offStr, iana, ...labelParts] = parts;
    const label = labelParts.join(',').trim();
    const offset = parseFloat(offStr);
    return { offset, iana: iana.trim(), label };
  }).filter(x => x && !Number.isNaN(x.offset) && x.iana && x.label);
}

function isFrequentTimezone(iana) {
  const frequentIanas = new Set(['Asia/Tokyo', 'Europe/London', 'America/Los_Angeles']);
  return frequentIanas.has(iana);
}

async function loadTimezones() {
  let useEmbedded = location.protocol === 'file:';
  let text = '';
  if (!useEmbedded) {
    try {
      const res = await fetch('./timezone_list.csv');
      if (res.ok) {
        text = await res.text();
      } else {
        useEmbedded = true;
      }
    } catch (_) {
      useEmbedded = true;
    }
  }
  if (useEmbedded) text = EMBEDDED_TIMEZONE_CSV;
  timezoneOptions = parseTimezoneCsv(text);
  let idx = timezoneOptions.findIndex(t => t.iana === DEFAULT_TZ_IANA);
  if (idx < 0) idx = 0;
  selectedTimezoneIndex = idx;
  selectedTimezoneOffset = timezoneOptions[idx].offset;
  const sel = document.getElementById('timezoneSelect');
  sel.innerHTML = timezoneOptions.map((t, i) => {
    const frequentClass = isFrequentTimezone(t.iana) ? ' class="frequent-tz"' : '';
    return `<option value="${i}"${frequentClass}>${t.label}</option>`;
  }).join('');
  sel.value = String(selectedTimezoneIndex);
}

window.onload = async () => {
  selectedSlots = [];
  updateFormatToggleText();
  await loadTimezones();
  renderAll();
  scrollCalendarToSlot(DEFAULT_SCROLL_SLOT);
};
