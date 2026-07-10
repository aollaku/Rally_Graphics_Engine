const axios = require('axios');
const cheerio = require('cheerio');

const BASE = 'https://results.djames.org.uk/results';
const cache = new Map();
const carMakes = ['Ford','Škoda','Skoda','VW','Volkswagen','Subaru','Mitsubishi','Citroën','Citroen','Vauxhall','Opel','BMW','Nissan','Lada','Toyota','Peugeot','Renault','Hyundai','Mini','Porsche','Honda','Mazda','Seat','MG','Audi','Volvo','Datsun'];
const classValues = ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','H1','H2','H3','H4','H5','H6','H7','R2','BRC','J1000'];

function clean(s) { return String(s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(); }
function isTime(s) { return /^\d+:\d{2}:\d{2}(?:\.\d+)?$|^\d+:\d{2}(?:\.\d+)?$/.test(s); }
function isClass(s) { return classValues.includes(String(s).trim()); }
function startsCar(s) { return carMakes.some(m => s === m || s.startsWith(m + ' ')); }
function urlOverall(eventId, stageId = 0) {
  const sid = Number(stageId || 0);
  // DJames/BTRDA stage selection is driven by ls=. Keep StageID too for compatibility,
  // but ls is the parameter that changes the stage data on the results website.
  return `${BASE}/overall.php?LeaderBoards=Leader+Boards&LeaderBoard=Overall+Leader+Board&EventID=${eventId}&StageID=${sid}&e=${eventId}&ls=${sid}&simple=1&selection=all`;
}
function urlStage(eventId, stageId) {
  const sid = Number(stageId || 0);
  // DJames has used several URL styles across events.  This one is kept as the
  // primary display URL; getStage() below tries fallbacks and keeps the page that
  // returns real Stage Classification rows.
  return `${BASE}/overall.php?EventID=${eventId}&StageID=${sid}&e=${eventId}&m=0&ls=${sid}&simple=1&selection=all`;
}
function urlStageCandidates(eventId, stageId) {
  const sid = Number(stageId || 0);
  // IMPORTANT: Stage Results/Stage Times must come from DJames combined.php,
  // because it exposes the LEFT Stage Classification table with crew + vehicle.
  // overall.php is only a fallback; it can omit co-drivers/vehicles and can show
  // only partial rows for stages other than SS1.
  return [
    `${BASE}/combined.php?EventID=${eventId}&StageID=${sid}&e=${eventId}&ls=0&m=0&selection=groups&show_codrivers=1&show_vehicles=1`,
    `${BASE}/combined.php?EventID=${eventId}&StageID=${sid}&e=${eventId}&ls=${sid}&m=0&selection=groups&show_codrivers=1&show_vehicles=1`,
    `${BASE}/combined.php?EventID=${eventId}&StageID=${sid}&e=${eventId}&selection=all&show_codrivers=1&show_vehicles=1`,
    `${BASE}/overall.php?LeaderBoards=Leader+Boards&EventID=${eventId}&StageID=${sid}&e=${eventId}&ls=${sid}&simple=1&selection=all`,
    `${BASE}/overall.php?EventID=${eventId}&StageID=${sid}&e=${eventId}&m=0&ls=${sid}&simple=1&selection=all`
  ].filter((v,i,a)=>a.indexOf(v)===i);
}
function urlEntry(eventId) { return `${BASE}/entry.php?EntryList=Entry+List&EventID=${eventId}&e=${eventId}`; }
function urlIndex(eventId) { return `${BASE}/index.php?EventID=${eventId}`; }

async function fetchHtml(url, ttl) {
  const now = Date.now();
  const item = cache.get(url);
  if (item && now - item.time < ttl) return item.html;
  const res = await axios.get(url, { timeout: 15000, maxRedirects: 5, headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36 RallyGraphics/1.0', 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language':'en-GB,en;q=0.9' } });
  cache.set(url, { time: now, html: res.data });
  return res.data;
}

function pageMeta(html, url) {
  const $ = cheerio.load(html);
  const title = clean($('h1').first().text()) || 'Rally Results';
  const date = clean($('h2').first().text());
  const subtitle = clean($('h2').eq(1).text()) || clean($('title').text());
  return { sourceUrl: url, eventTitle: title, eventDate: date, subtitle };
}

function parseResultTables(html, url, limit = 10) {
  const $ = cheerio.load(html);
  const meta = pageMeta(html, url);
  const rows = [];
  $('table tr').each((_, tr) => {
    const cells = $(tr).find('td,th').map((__, td) => clean($(td).text())).get();
    const parsed = parseResultCells(cells);
    if (parsed) rows.push(parsed);
  });
  if (!rows.length) parseResultText($('body').text()).forEach(r => rows.push(r));
  return { ...meta, rows: rows.slice(0, limit), totalRows: rows.length, fetchedAt: new Date().toISOString() };
}

function parseResultCells(cells) {
  // Robust DJames result parser.
  // The site sometimes omits empty cells visually, so fixed indexes are risky.
  // We anchor on the car column and the first time value after it.
  const c = cells.map(clean);
  if (!/^\d+=?$/.test(c[0] || '')) return null;

  const carIdx = c.findIndex((x, i) => i > 3 && startsCar(x));
  if (carIdx > 0) {
    const beforeCar = c.slice(0, carIdx);
    const afterCar = c.slice(carIdx + 1);
    const timeValues = afterCar.filter(isTime);
    if (!timeValues.length) return null;

    // Position and competition number.
    const position = (c[0] || '').replace('=', '');
    const numericBefore = [];
    beforeCar.forEach((x, i) => { if (/^\d+[A-Za-z]?$/.test(x)) numericBefore.push({ value:x, index:i }); });
    // DJames: first numeric is O/A pos, second can be class pos, last before names is car number.
    const noItem = numericBefore.length >= 3 ? numericBefore[numericBefore.length - 1] : numericBefore[numericBefore.length - 1];
    const number = noItem ? noItem.value : '';

    // Names live between the car number and the car column. Remove flags, BTRDA markers and noise.
    const nameCells = beforeCar.slice(noItem ? noItem.index + 1 : 1)
      .map(stripNoise)
      .filter(Boolean)
      .filter(x => !/^B\/b$|^B$|^b$/i.test(x))
      .filter(x => !/^(GBR|IRL|GB-WLS|GB-ENG|GB-SCT|ISL|NZL|IMN)$/.test(x))
      .filter(x => !isClass(x));
    let driver = nameCells[0] || '';
    let codriver = nameCells[1] || '';
    if (!codriver && nameCells.length > 2) {
      const split = splitNames(nameCells.join(' '));
      driver = split.driver;
      codriver = split.codriver;
    }

    const className = afterCar.find(x => isClass(x)) || '';
    return normalizeCrewFields({
      position,
      number,
      driver,
      codriver,
      car: c[carIdx] || '',
      class: className,
      totalTime: timeValues[0] || '',
      diffPrev: timeValues[1] || '',
      diffFirst: timeValues[2] || ''
    });
  }

  // Fallback for text-only extraction.
  const nonEmpty = c.filter(Boolean);
  const posIdx = nonEmpty.findIndex(x => /^\d+=?$/.test(x));
  if (posIdx < 0) return null;
  let totalIdx = nonEmpty.findIndex(x => isTime(x));
  if (totalIdx < 0) return null;
  const before = nonEmpty.slice(posIdx, totalIdx);
  const after = nonEmpty.slice(totalIdx + 1).filter(isTime);
  const numberIdx = before.findIndex((x, i) => i > 0 && /^\d+[A-Za-z]?$/.test(x));
  const number = numberIdx >= 0 ? before[numberIdx] : '';
  const className = [...before].reverse().find(isClass) || '';
  let carIdx2 = before.findIndex(startsCar);
  if (carIdx2 < 0 && className) carIdx2 = before.lastIndexOf(className) - 1;
  const car = carIdx2 >= 0 ? before.slice(carIdx2, className ? before.lastIndexOf(className) : before.length).join(' ') : '';
  const nameParts = before.slice(numberIdx + 1, carIdx2 >= 0 ? carIdx2 : before.length)
    .filter(x => !isClass(x))
    .filter(x => !/^(B|b|B\/b|[A-Z]{2,3}|GBR|IRL|GB-WLS|GB-ENG|GB-SCT|ISL|NZL|IMN)$/.test(x));
  const split = splitNames(nameParts.join(' '));
  return normalizeCrewFields({ position: nonEmpty[posIdx].replace('=',''), number, driver: split.driver, codriver: split.codriver, car, class: className, totalTime: nonEmpty[totalIdx], diffPrev: after[0] || '', diffFirst: after[1] || '' });
}

function stripNoise(text){
  return clean(text).replace(/^(?:\d+|H\d+|B\/b|B|b)\s+/,'').replace(/^(?:B\/b|B|b)$/i,'');
}

// v34: Some DJames rows can leak the competition number into the crew-name
// fields, e.g. "116 Dale Glover" or "84 Julian Birley".  Keep
// competition numbers only in the POS/No. columns and never in Driver or
// Co-driver display fields.  This is a field-cleanup step only; it does not
// change table selection, pagination, stage logic, or data parsing flow.
function cleanCrewDisplayName(text){
  let value = stripNoise(text);
  // Remove one or more leading car/competition numbers accidentally prefixed
  // to a person name.  Do not remove numbers that are part of the middle/end
  // of a legitimate name.
  value = value.replace(/^(?:\d{1,4}[A-Za-z]?\s+)+(?=[A-ZÀ-Þ])/u, '');
  return clean(value);
}
function normalizeCrewFields(row){
  if (!row || typeof row !== 'object') return row;
  if ('driver' in row) row.driver = cleanCrewDisplayName(row.driver);
  if ('codriver' in row) row.codriver = cleanCrewDisplayName(row.codriver);
  if (row.car) {
    row.driver = removeEmbeddedCarFromName(row.driver, row.car);
    row.codriver = removeEmbeddedCarFromName(row.codriver, row.car);
  }
  return row;
}

function isNoiseCell(x){
  const v = clean(x);
  return !v || /^[-–—+=]+$/.test(v) || /^B\/b$|^B$|^b$/i.test(v) || /^(GBR|IRL|GB-WLS|GB-ENG|GB-SCT|ISL|NZL|IMN|WLS|ENG|SCT|WAL)$/i.test(v);
}
function looksLikePersonName(x){
  const v = clean(x);
  if (isNoiseCell(v) || isTime(v) || isClass(v) || /^\d+[A-Za-z]?$/.test(v) || startsCar(v)) return false;
  return /[A-Za-zÀ-ž]/.test(v);
}

function looksLikeCrewName(x){
  const v = clean(x);
  if (!looksLikePersonName(v)) return false;
  // Towns such as Woking, Bala, Dolgellau often appear in DJames entry cells.
  // Real crew names are normally two or more words/initials.
  return v.split(' ').filter(Boolean).length >= 2;
}

function stripTrailingTown(name, town){
  const n = stripNoise(name);
  const t = clean(town);
  if(!n || !t) return n;
  if(n.toLowerCase().endsWith((' '+t).toLowerCase())) return clean(n.slice(0, -t.length));
  return n;
}

function splitEmbeddedCar(text){
  const value = clean(text);
  if (!value) return { name: '', car: '' };
  const idx = findCarStartIndex(value);
  if (idx > 0) return { name: clean(value.slice(0, idx)), car: clean(value.slice(idx)) };
  return { name: value, car: idx === 0 ? value : '' };
}
function removeEmbeddedCarFromName(name, knownCar=''){
  let value = clean(name);
  const car = clean(knownCar);
  if (car && value.toLowerCase().endsWith(car.toLowerCase())) {
    value = clean(value.slice(0, -car.length));
  }
  const split = splitEmbeddedCar(value);
  return split.car ? split.name : value;
}


function splitNames(text) {
  const words = clean(text).split(' ').filter(Boolean);
  const filtered = words.filter(w => !['B','b','B/b','GBR','IRL','GB-WLS','GB-ENG','GB-SCT','ISL','NZL','IMN'].includes(w));
  if (filtered.length <= 2) return { driver: filtered.join(' '), codriver: '' };
  const mid = Math.ceil(filtered.length / 2);
  return { driver: filtered.slice(0, mid).join(' '), codriver: filtered.slice(mid).join(' ') };
}

function parseResultText(text) {
  const lines = text.split(/\n/).map(clean).filter(Boolean);
  const out = [];
  for (const line of lines) {
    if (!/^\d+=?\s/.test(line)) continue;
    const times = line.match(/\d+:\d{2}:\d{2}|\d+:\d{2}/g) || [];
    if (!times.length) continue;
    const total = times[0], diffPrev = times[1] || '', diffFirst = times[2] || '';
    const head = clean(line.split(total)[0]);
    const tokens = head.split(' ');
    const position = tokens.shift();
    tokens.shift(); // class position/change noise
    const numberIdx = tokens.findIndex(t => /^\d+[A-Za-z]?$/.test(t));
    const number = numberIdx >= 0 ? tokens[numberIdx] : '';
    const rest = tokens.slice(numberIdx + 1);
    const className = [...rest].reverse().find(isClass) || '';
    const carIdx = rest.findIndex((_, i) => startsCar(rest.slice(i).join(' ')));
    const carTokens = carIdx >= 0 ? rest.slice(carIdx, className ? rest.lastIndexOf(className) : rest.length) : [];
    const nameText = rest.slice(0, carIdx >= 0 ? carIdx : rest.length).join(' ');
    const split = splitNames(nameText);
    out.push(normalizeCrewFields({ position, number, driver: split.driver, codriver: split.codriver, car: carTokens.join(' '), class: className, totalTime: total, diffPrev, diffFirst }));
  }
  return out;
}

function firstTimeIn(arr) { return (arr || []).find(isTime) || ''; }
function parseTimeToSeconds(value){
  const parts = String(value || '').replace(/^\+/,'').split(':').map(Number);
  if (!parts.every(Number.isFinite)) return null;
  if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2];
  if (parts.length === 2) return parts[0]*60 + parts[1];
  return null;
}
function formatGap(seconds){
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '';
  const h = Math.floor(seconds/3600);
  const m = Math.floor((seconds%3600)/60);
  const sec = Math.round(seconds%60);
  if (h) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${m}:${String(sec).padStart(2,'0')}`;
}
function normNameKey(s){ return clean(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim(); }
function buildEntryMap(entriesData){
  const map = new Map();
  for (const r of (entriesData?.rows || [])) {
    const no = String(r.number || '').trim();
    if (no) map.set(no, r);
    const dk = normNameKey(r.driver || '');
    if (dk) map.set('driver:' + dk, r);
  }
  return map;
}

function isLikelyOverallRow(c){
  const times = c.filter(isTime);
  // Overall Classification rows normally have several time fields and many columns.
  // Stage Classification rows have only the stage time (plus optional +/- text).
  return c.length >= 9 && times.length >= 2;
}

function parseStageClassificationTables(html, url, limit = 10, entryMap = new Map()) {
  const $ = cheerio.load(html);
  const meta = pageMeta(html, url);
  let rows = [];

  // DJames puts Stage Classification and Overall Classification side-by-side.
  // In the DOM that can appear as ONE wide table row.  For Stage Results and
  // Stage Times we must parse only the LEFT side of each row, ending at the
  // first Stage Time cell. Do not use the overall parser here.
  $('tr').each((_, tr) => {
    const cells = $(tr).children('td,th').map((__, td) => clean($(td).text())).get();
    const parsed = parseStageClassificationCells(cells, entryMap);
    if (parsed) rows.push(parsed);
  });

  // Some layouts are nested. If direct-child parsing found nothing, inspect all
  // cells inside each row. Still use the left/stage segment only.
  if (!rows.length) {
    $('tr').each((_, tr) => {
      const cells = $(tr).find('td,th').map((__, td) => clean($(td).text())).get();
      const parsed = parseStageClassificationCells(cells, entryMap);
      if (parsed) rows.push(parsed);
    });
  }

  // De-duplicate by competition number + stage time + position, while keeping
  // all competitors. This prevents wrapper-table duplicates but does not collapse
  // different competitors with the same stage time.
  const seen = new Set();
  rows = rows.filter(r => {
    const key = `${r.position}|${r.number}|${r.driver}|${r.totalTime}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const leaderSeconds = rows.length ? parseTimeToSeconds(rows[0].totalTime) : null;
  for (const r of rows) {
    if (!r.diffPrev && leaderSeconds != null) {
      const t = parseTimeToSeconds(r.totalTime);
      r.diffPrev = t == null ? '' : formatGap(t - leaderSeconds);
      r.diffFirst = r.diffPrev;
    }
  }

  return { ...meta, sourceTable: 'stage-classification-left-table', rows: rows.slice(0, limit), totalRows: rows.length, fetchedAt: new Date().toISOString() };
}


function stripStageNoiseText(s){
  return clean(s)
    .replace(/Image:\s*[^\n]+?(?:flag|change|Up|Down)/gi, ' ')
    .replace(/\b(?:No change|Moved Up|Moved Down|national flag)\b/gi, ' ')
    .replace(/\b(?:GBR|IRL|GB-WLS|GB-ENG|GB-SCT|WLS|ENG|SCT|ISL|NZL|IMN|BEL|USA)\b(?:\s+national\s+flag)?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function findCarStartIndex(text){
  const t = String(text || '');
  let best = -1;
  for (const make of carMakes) {
    const re = new RegExp('(^|\\s)'+make.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(\\s|$)', 'i');
    const m = t.match(re);
    if (m) {
      const idx = m.index + (m[1] ? m[1].length : 0);
      if (best < 0 || idx < best) best = idx;
    }
  }
  return best;
}
function parseCrewVehicleFromCells(cells){
  const cleaned = (cells || []).map(stripStageNoiseText).filter(Boolean)
    .filter(x => !isClass(x) && !isTime(x) && !/^\d+[A-Za-z]?$/.test(x));
  if (!cleaned.length) return { driver:'', codriver:'', car:'' };

  let car = '';
  let crewCells = [...cleaned];
  const carCellIdx = cleaned.findIndex(x => startsCar(x) || findCarStartIndex(x) === 0);
  if (carCellIdx >= 0) {
    car = cleaned[carCellIdx];
    crewCells = cleaned.slice(0, carCellIdx);
  }

  let crewText = crewCells.join(' ');
  if (!car) {
    const carIdx = findCarStartIndex(crewText);
    if (carIdx >= 0) {
      car = clean(crewText.slice(carIdx));
      crewText = clean(crewText.slice(0, carIdx));
    }
  }

  let driver = '', codriver = '';
  if (crewText.includes('/')) {
    const parts = crewText.split('/');
    driver = clean(parts.shift());
    codriver = clean(parts.join('/'));
  } else {
    const names = crewText.split(/\s{2,}|\|/).map(clean).filter(Boolean);
    if (names.length >= 2) { driver = names[0]; codriver = names[1]; }
    else {
      const split = splitNames(crewText);
      driver = split.driver; codriver = split.codriver;
    }
  }
  return { driver: stripNoise(driver), codriver: stripNoise(codriver), car: clean(car) };
}
function buildOverallDriverMapFromHtml(html, url){
  const map = new Map();
  try {
    const overall = parseResultTables(html, url, 999);
    for (const r of overall.rows || []) {
      const dk = normNameKey(r.driver || '');
      if (dk && (r.codriver || r.car)) map.set(dk, r);
    }
  } catch (_) {}
  return map;
}

function parseStageClassificationCells(cells, entryMap = new Map()) {
  const raw = cells.map(clean).filter(x => x !== '');
  if (!raw.length) return null;

  // Locate the stage-classification time. On DJames combined.php this is the
  // first time value in each row. Everything after it belongs to Overall
  // Classification and must be ignored for Stage Results/Times.
  const timeIdx = raw.findIndex(isTime);
  if (timeIdx < 0) return null;

  // Find the stage position before the first time.
  const posIdx = raw.findIndex((x, i) => i < timeIdx && /^\d+=?$/.test(x));
  if (posIdx < 0) return null;
  const position = raw[posIdx].replace('=', '');

  const left = raw.slice(posIdx, timeIdx + 1);
  const beforeTime = left.slice(1, -1);
  const time = left[left.length - 1];

  // Find the competitor number from the actual Stage Classification columns.
  // DJames left table is: Stg Pos | +/- | No. | Driver | Nat | Class | Stage Time.
  // The +/- column can itself be numeric (for example "1" or "3"), so do NOT
  // take the first numeric cell after position.  Use the numeric cell immediately
  // before the first real driver/person cell.  This prevents Stage Times drifting
  // to entry no. 1/3/etc. when the movement column contains a number.
  let numberIdx = -1;
  const firstPersonIdx = beforeTime.findIndex(looksLikePersonName);
  if (firstPersonIdx > 0) {
    for (let i = firstPersonIdx - 1; i >= 0; i--) {
      if (/^\d+[A-Za-z]?$/.test(beforeTime[i])) { numberIdx = i; break; }
    }
  }
  if (numberIdx < 0) {
    // Fallback for unusual markup: choose the last numeric before a car/name cell,
    // but never choose the final class column next to the time.
    for (let i = 0; i < beforeTime.length - 1; i++) {
      if (/^\d+[A-Za-z]?$/.test(beforeTime[i]) && beforeTime.slice(i + 1).some(looksLikePersonName)) numberIdx = i;
    }
  }
  if (numberIdx < 0) return null;

  const number = beforeTime[numberIdx];
  const detailCells = beforeTime.slice(numberIdx + 1);
  const className = [...detailCells].reverse().find(isClass) || '';
  const crewCar = parseCrewVehicleFromCells(detailCells);
  let driver = crewCar.driver;
  let codriver = crewCar.codriver;
  let car = crewCar.car;

  // Enrich only missing fields. Prefer the actual combined.php row data first;
  // then use entry/overall maps keyed by driver and finally by car number.
  const dk = normNameKey(driver);
  let entry = (number ? entryMap.get(String(number).trim()) : null) || (dk && entryMap.get('driver:' + dk)) || null;

  // For Stage Results/Stage Times, the DJames stage table sometimes emits the
  // co-driver and vehicle text as one concatenated string, for example
  // "Patrick WalshFord Fiesta Rally2".  The Entry List is the authoritative
  // crew/vehicle map by competition number, so prefer it when available and use
  // it to keep the co-driver and car fields separated.
  if (entry) {
    driver = entry.driver || driver || '';
    codriver = entry.codriver || codriver || '';
    car = entry.car || car || '';
  }

  if (car) {
    driver = removeEmbeddedCarFromName(driver, car);
    codriver = removeEmbeddedCarFromName(codriver, car);
  } else {
    const embedded = splitEmbeddedCar(codriver);
    if (embedded.car) { codriver = embedded.name; car = embedded.car; }
  }

  if (!driver || !time) return null;
  return normalizeCrewFields({
    position,
    number,
    driver,
    codriver,
    car,
    class: className || entry?.class || '',
    totalTime: time,
    diffPrev: '',
    diffFirst: ''
  });
}

function parseEntries(html, url, limit = 999) {
  const $ = cheerio.load(html);
  const meta = pageMeta(html, url);
  let rows = [];

  // Parse entry lists by table headers and direct child cells only.  This avoids
  // DJames nationality/town columns being pulled into Driver / Co-driver / Car.
  $('table').each((_, table) => {
    const trs = $(table).find('tr').toArray();
    if (!trs.length) return;
    let headerIdx = -1;
    let headerCells = [];
    for (let i = 0; i < Math.min(trs.length, 6); i++) {
      const h = $(trs[i]).children('td,th').map((__, td) => clean($(td).text())).get();
      const ht = h.join(' ').toLowerCase();
      if (/\bdriver\b/.test(ht) && /co[-\s]?driver/.test(ht) && /\bcar\b/.test(ht)) {
        headerIdx = i;
        headerCells = h;
        break;
      }
    }
    if (headerIdx < 0) return;

    const lower = headerCells.map(x => clean(x).toLowerCase());
    const findCol = (...patterns) => lower.findIndex(x => patterns.some(p => p.test(x)));
    const noIdx = findCol(/^no\.?$/, /^entry$/, /^car\s*no/);
    const driverIdx = lower.findIndex(x => x === 'driver');
    const codriverIdx = findCol(/^co[-\s]?driver$/);
    const carIdx = lower.findIndex(x => x === 'car' || x === 'vehicle');
    const classIdx = lower.findIndex(x => x === 'class' || x === 'cls');
    const champsIdx = findCol(/champ/, /series/);

    if (noIdx < 0 || driverIdx < 0 || codriverIdx < 0 || carIdx < 0) return;

    for (let i = headerIdx + 1; i < trs.length; i++) {
      const raw = $(trs[i]).children('td,th').map((__, td) => clean($(td).text())).get();
      if (!raw.length || !/^\d+[A-Za-z]?$/.test(raw[noIdx] || '')) continue;
      const champRaw = champsIdx >= 0 ? raw[champsIdx] : '';
      const champText = clean(champRaw) || inferChampionships(raw);
      let driver = stripNoise(raw[driverIdx] || '');
      let codriver = stripNoise(raw[codriverIdx] || '');
      let car = clean(raw[carIdx] || '');

      // If a browser/source row has still merged neighbouring text, separate it
      // defensively without changing the output layout.
      if (!car) {
        let split = splitEmbeddedCar(codriver);
        if (split.car) { codriver = split.name; car = split.car; }
        else {
          split = splitEmbeddedCar(driver);
          if (split.car) { driver = split.name; car = split.car; }
        }
      }
      driver = removeEmbeddedCarFromName(driver, car);
      codriver = removeEmbeddedCarFromName(codriver, car);

      rows.push(normalizeCrewFields({
        number: raw[noIdx],
        driver,
        codriver,
        car,
        class: classIdx >= 0 ? clean(raw[classIdx] || '') : '',
        championship: "",
        championshipText: ""
      }));
    }
  });

  if (!rows.length) {
    $('table tr').each((_, tr) => {
      const cells = $(tr).children('td,th').map((__, td) => clean($(td).text())).get();
      const parsed = parseEntryCells(cells);
      if (parsed) rows.push(parsed);
    });
  }
  if (!rows.length) parseEntryText($('body').text()).forEach(r => rows.push(r));

  const seen = new Set();
  rows = rows.filter(r => {
    const key = String(r.number || '').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { ...meta, rows: rows.slice(0, limit), totalRows: rows.length, fetchedAt: new Date().toISOString() };
}


function inferChampionships(cells){
  const c = cells.map(clean);
  const text = c.join(' ');
  const out = [];

  // Keep the CHAMPS field readable for the supplied broadcast template.
  // DJames commonly exposes abbreviated championship flags, so translate the
  // known flags into the full labels that the graphic is expected to show.
  const btrdaFlag = c.some(x => /^B\/b$|^B$|^b$|BTRDA/i.test(x));
  if (btrdaFlag) out.push('BTRDA Rally Series');
  if (/Winner\s+Garage|Skoda/i.test(text)) out.push('Winner Garage Skoda Championship');
  if (/Pirelli|Welsh/i.test(text)) out.push('UK Pirelli Welsh National');
  if (/Kingfisher/i.test(text)) out.push('Kingfisher');

  // Some DJames entry lists only expose the BTRDA flag although the template
  // expects the public championship package name. Keep this as readable text,
  // but do not invent a value for rows with no championship flag at all.
  if (btrdaFlag && out.length === 1) {
    out.push('Winner Garage Skoda Championship', 'UK Pirelli Welsh National', 'Kingfisher');
  }
  return [...new Set(out)].join(', ');
}

function parseEntryCells(cells) {
  // Keep empty cells for DJames Entry List. The table is column-based and many
  // rows have blank Entrant/Sponsor or championship cells; removing empties shifts
  // Driver / Co-driver / Car into the wrong columns.
  const raw = cells.map(clean);
  const c = raw.filter(x => x !== '');
  if (!c.length) return null;

  // DJames final entry list layout:
  // No | Entrant/Sponsor | BTRDA | Driver | Nat | Town | Co-Driver | Nat | Town | Car | Class
  // Parse this fixed layout first so sponsor names are never used as drivers.
  if (/^\d+[A-Za-z]?$/.test(raw[0] || '') && raw.length >= 10) {
    const carIdx = raw.findIndex((x, i) => i >= 8 && startsCar(x));
    if (carIdx >= 0) {
      const className = raw.slice(carIdx + 1).find(isClass) || '';
      const champText = inferChampionships(raw);
      return normalizeCrewFields({
        number: raw[0],
        driver: stripNoise(raw[3] || ''),
        codriver: removeEmbeddedCarFromName(stripNoise(raw[6] || ''), raw[carIdx] || ''),
        car: raw[carIdx] || '',
        class: className,
        championship: "",
        championshipText: ""
      });
    }
  }

  // Entry lists vary between DJames events. Prefer a structural parse based on the
  // car column instead of fixed indexes, otherwise championship flags like B/b can
  // be mistaken for the driver.
  const numberIdx = c.findIndex(x => /^\d+[A-Za-z]?$/.test(x));
  if (numberIdx < 0) return null;
  const number = c[numberIdx];
  const rest = c.slice(numberIdx + 1);
  const carIdxRel = rest.findIndex(startsCar);

  if (carIdxRel >= 0) {
    const beforeCar = rest.slice(0, carIdxRel);
    const afterCar = rest.slice(carIdxRel + 1);
    const className = afterCar.find(isClass) || '';
    const champText = inferChampionships(c);
    const names = beforeCar
      .map(stripNoise)
      .filter(looksLikePersonName)
      .filter(x => !isClass(x));

    // DJames full entry tables can include towns between the crew names:
    // Driver, Driver town, Co-driver, Co-driver town.  Do not let a town such as
    // Woking become the co-driver. Prefer cells that look like full crew names.
    let driver = '', codriver = '';
    const crewNames = names.filter(looksLikeCrewName);
    if (crewNames.length >= 2) {
      driver = crewNames[0] || '';
      codriver = crewNames[1] || '';
    } else if (names.length >= 4) {
      driver = names[0] || '';
      codriver = names[2] || '';
    } else if (names.length >= 2) {
      driver = names[0] || '';
      codriver = names[1] || '';
    } else if (names.length === 1) {
      driver = names[0];
    }
    return normalizeCrewFields({
      number,
      driver,
      codriver: removeEmbeddedCarFromName(codriver, rest[carIdxRel] || ''),
      car: rest[carIdxRel] || '',
      class: className,
      championship: "",
      championshipText: ""
    });
  }

  // Fallback for older/simple pages.
  const idx = numberIdx;
  const tail = c.slice(idx + 1).filter(Boolean);
  const className = [...tail].reverse().find(isClass) || '';
  const champ = inferChampionships(c);
  const nameText = tail
    .map(stripNoise)
    .filter(looksLikePersonName)
    .filter(x => !isClass(x))
    .join(' ');
  const split = splitNames(nameText);
  return normalizeCrewFields({ number, driver: split.driver, codriver: split.codriver, car:'', class: className, championship: "", championshipText: "" });
}

function parseEntryText(text) {
  const lines = text.split(/\n/).map(clean).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    if (!/^\d+[A-Za-z]?\s/.test(line)) continue;
    const tokens = line.split(' ');
    const number = tokens.shift();
    const className = [...tokens].reverse().find(isClass) || '';
    const carIdx = tokens.findIndex((_, i) => startsCar(tokens.slice(i).join(' ')));
    const carTokens = carIdx >= 0 ? tokens.slice(carIdx, className ? tokens.lastIndexOf(className) : tokens.length) : [];
    const champ = line.match(/\bB\/b\b|\bB\b|\bb\b|BTRDA/i) ? 'BTRDA' : '';
    const nameText = tokens.slice(0, carIdx >= 0 ? carIdx : tokens.length).filter(t => !/^[A-Z]{2,3}$|^B\/b$|^B$/.test(t)).join(' ');
    const split = splitNames(nameText);
    rows.push(normalizeCrewFields({ number, driver: split.driver, codriver: split.codriver, car: carTokens.join(' '), class: className, championship: "", championshipText: "" }));
  }
  return rows;
}


const CHAMPIONSHIP_CODE_MAP = Object.freeze({
  GS: 'FUCHS Lubricants BTRDA® Gold Star Championship',
  SS: 'Protyre BTRDA® Silver Star Championship',
  BS: 'FUCHS Lubricants BTRDA Bronze Star® 1400 Rally Championship',
  H: 'BTRDA® Historic Cup',
  RF: 'BTRDA® Rally First Cup',
  R2: 'BTRDA® Rallye R2 Cup',
  W: 'Motorsport UK Pirelli Welsh Rally Championship',
  KF: 'Kingfisher Insurance Motorsport UK English Rally Championship',
  TCS: 'TCS Plant Rally Challenge hosting the Celtic Micra Challenge',
  NW: 'ANWCC Forest Stage Championship',
  HRCR: 'The West Wales Rally Spares HRCR Stage Masters Challenge 2026',
  CAT1: 'HRCR Category 1 Stage Rally Championship'
});

function isAllowedRalliesInfoUrl(value) {
  try {
    const u = new URL(String(value || '').trim());
    const host = u.hostname.toLowerCase();
    return u.protocol === 'https:' && (host === 'rallies.info' || host === 'www.rallies.info') && /\/webentry\//i.test(u.pathname) && /\/entries\/?$/i.test(u.pathname);
  } catch (_) { return false; }
}

function championshipCodes(value) {
  const found = [];
  const tokens = clean(value).toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  for (const token of tokens) if (Object.prototype.hasOwnProperty.call(CHAMPIONSHIP_CODE_MAP, token) && !found.includes(token)) found.push(token);
  return found;
}

function championshipTextFromCodes(codes) {
  return [...new Set(codes || [])].map(code => CHAMPIONSHIP_CODE_MAP[code] || code).filter(Boolean).join(', ');
}

function parseRalliesInfoChampionships(html, url='') {
  const $ = cheerio.load(html);
  const byNumber = new Map();

  $('table').each((_, table) => {
    const trs = $(table).find('tr').toArray();
    if (!trs.length) return;
    let headerIndex = -1;
    let headers = [];
    for (let i=0; i<Math.min(12, trs.length); i++) {
      const row = $(trs[i]).children('th,td').map((__, cell) => clean($(cell).text())).get();
      const joined = row.join(' ').toLowerCase();
      if (/\bdriver\b/.test(joined) && /co[-\s]?driver/.test(joined) && /\b(make|car|vehicle)\b/.test(joined)) {
        headerIndex = i; headers = row; break;
      }
    }

    const lower = headers.map(x => clean(x).toLowerCase());
    const findExact = (...names) => lower.findIndex(x => names.includes(x));
    let noIdx = lower.findIndex(x => /^(no\.?|number|entry|car\s*no\.?)$/.test(x));
    let driverIdx = findExact('driver');
    let codriverIdx = lower.findIndex(x => /^co[-\s]?driver$/.test(x));
    const champIndexes = lower.map((x,i) => /champ/.test(x) ? i : -1).filter(i => i >= 0);
    let driverChampIdx = champIndexes.find(i => i > driverIdx && (codriverIdx < 0 || i < codriverIdx));
    let codriverChampIdx = champIndexes.find(i => codriverIdx >= 0 && i > codriverIdx);

    // Known Rallies.info seeded-entry structure fallback:
    // No | Driver | Club | Champs | Co-driver | Club | Champs | Make | Model | CC | Class | Sponsor
    if (headerIndex < 0) {
      headerIndex = -1; noIdx=0; driverIdx=1; driverChampIdx=3; codriverIdx=4; codriverChampIdx=6;
    }

    for (let i=headerIndex+1; i<trs.length; i++) {
      const cells = $(trs[i]).children('td,th').map((__, cell) => clean($(cell).text())).get();
      if (!cells.length) continue;
      const number = clean(cells[noIdx] || '').replace(/[^0-9A-Za-z]/g, '');
      if (!/^\d+[A-Za-z]?$/.test(number)) continue;
      const driver = clean(cells[driverIdx] || '');
      const codriver = clean(cells[codriverIdx] || '');
      if (!driver) continue;
      const codes = [
        ...championshipCodes(cells[driverChampIdx] || ''),
        ...championshipCodes(cells[codriverChampIdx] || '')
      ];
      byNumber.set(number, {
        number,
        driver,
        codriver,
        codes: [...new Set(codes)],
        championshipText: championshipTextFromCodes(codes),
        sourceUrl: url
      });
    }
  });
  return byNumber;
}

async function fetchRalliesInfoChampionships(url, ttl) {
  if (!url) return { map:new Map(), error:'Rallies.info URL not configured' };
  if (!isAllowedRalliesInfoUrl(url)) return { map:new Map(), error:'Invalid Rallies.info URL' };

  try {
    // The public /entries page is only a Vue shell. The actual entry data is
    // supplied by entries_get.php as JSON. Build that endpoint from the
    // operator-provided event URL so this remains event-independent.
    const pageUrl = new URL(url);
    const apiUrl = new URL('entries_get.php', pageUrl);
    apiUrl.searchParams.set('type', pageUrl.searchParams.get('type') || 's');
    apiUrl.searchParams.set('combined', '0');
    apiUrl.searchParams.set('mixed', '0');

    const cacheKey = apiUrl.toString();
    const now = Date.now();
    const cached = cache.get(cacheKey);
    let rows;
    if (cached && now - cached.time < ttl) {
      rows = cached.json;
    } else {
      const response = await axios.get(cacheKey, {
        timeout: 15000,
        maxRedirects: 5,
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36 RallyGraphics/1.0',
          'Accept': 'application/json,text/plain,*/*',
          'Referer': pageUrl.toString(),
          'Accept-Language': 'en-GB,en;q=0.9'
        }
      });
      rows = response.data;
      cache.set(cacheKey, { time: now, json: rows });
    }

    if (!Array.isArray(rows)) {
      return { map:new Map(), error:'Rallies.info entries_get.php did not return a JSON array' };
    }

    const byNumber = new Map();
    for (const row of rows) {
      const number = clean(row?.no).replace(/[^0-9A-Za-z]/g, '');
      if (!/^\d+[A-Za-z]?$/.test(number)) continue;

      const codes = [
        ...championshipCodes(row?.champ_d || ''),
        ...championshipCodes(row?.champ_n || '')
      ];
      const uniqueCodes = [...new Set(codes)];

      byNumber.set(number, {
        number,
        driver: clean(row?.pe_name_d || ''),
        codriver: clean(row?.pe_name_n || ''),
        car: clean([row?.ca_make, row?.ca_model].filter(Boolean).join(' ')),
        class: clean(row?.ca_class || ''),
        codes: uniqueCodes,
        championshipText: championshipTextFromCodes(uniqueCodes),
        sourceUrl: cacheKey
      });
    }

    return {
      map: byNumber,
      error: byNumber.size ? '' : 'No Rallies.info entry rows were parsed from entries_get.php'
    };
  } catch (err) {
    const detail = err?.response?.data;
    const suffix = typeof detail === 'string' ? `: ${detail.slice(0, 200)}` : '';
    return { map:new Map(), error: `${err.message}${suffix}` };
  }
}

async function getEventInfo(eventId, ttl) {
  const url = urlIndex(eventId);
  const html = await fetchHtml(url, ttl);
  const info = pageMeta(html, url);
  // Some events expose only a generic index title such as "Results on the Web".
  // In that case, use the overall-results page subtitle because it often contains
  // the real rally/stage name, e.g. "... - LLANGOWER 1".
  const generic = /^(results\s+on\s+the\s+web|rally\s+results|results)$/i;
  if (generic.test(info.eventTitle || '') || generic.test(info.subtitle || '')) {
    try {
      const overallHtml = await fetchHtml(urlOverall(eventId), ttl);
      const overall = pageMeta(overallHtml, urlOverall(eventId));
      if (overall.subtitle) info.subtitle = overall.subtitle;
      if (!generic.test(overall.eventTitle || '')) info.eventTitle = overall.eventTitle;
    } catch (_) {}
  }
  return { ...info, eventId, urls: { overall: urlOverall(eventId), entries: urlEntry(eventId) }, maxStageProbe: 20, fetchedAt: new Date().toISOString() };
}
async function getOverall(eventId, limit, ttl, stageId = 0) { const url = urlOverall(eventId, stageId); return parseResultTables(await fetchHtml(url, ttl), url, limit); }
async function getStage(eventId, stageId, limit, ttl) {
  let entryMap = new Map();
  try {
    const entries = parseEntries(await fetchHtml(urlEntry(eventId), ttl), urlEntry(eventId), 999);
    entryMap = buildEntryMap(entries);
  } catch (_) {}

  let best = null;
  for (const url of urlStageCandidates(eventId, stageId)) {
    try {
      const html = await fetchHtml(url, ttl);
      // Use the same page's Overall Classification as an enrichment source only.
      const overallMap = buildOverallDriverMapFromHtml(html, url);
      const combinedMap = new Map(entryMap);
      for (const [k, v] of overallMap.entries()) combinedMap.set('driver:' + k, v);
      const parsed = parseStageClassificationTables(html, url, limit, combinedMap);
      if (!best || Number(parsed.totalRows || 0) > Number(best.totalRows || 0)) best = parsed;
      // combined.php is the correct source. If it gives a full page of stage rows,
      // stop looking so later overall.php fallbacks cannot replace it.
      if (/combined\.php/i.test(url) && Number(parsed.totalRows || 0) >= 10) break;
    } catch (_) {}
  }
  if (best) return best;
  const url = urlStage(eventId, stageId);
  return parseStageClassificationTables(await fetchHtml(url, ttl), url, limit, entryMap);
}
async function getEntries(eventId, limit, ttl, ralliesInfoUrl='') {
  const url = urlEntry(eventId);
  const data = parseEntries(await fetchHtml(url, ttl), url, limit);
  // The DJames entry list remains authoritative for entry number, crew, car and class.
  // Champs comes ONLY from the configured Rallies.info seeded entry list, matched by entry number.
  const rallies = await fetchRalliesInfoChampionships(ralliesInfoUrl, ttl);
  let matched = 0;
  data.rows = data.rows.map(row => {
    const match = rallies.map.get(String(row.number || '').trim());
    if (match) matched += 1;
    return { ...row, championship:'', championshipText: match?.championshipText || '' };
  });
  return {
    ...data,
    ralliesInfoUrl: ralliesInfoUrl || '',
    champsSource: ralliesInfoUrl ? 'rallies.info' : 'not-configured',
    champsRowsParsed: rallies.map.size,
    champsRowsMatched: matched,
    champsError: rallies.error || ''
  };
}

module.exports = { getEventInfo, getOverall, getStage, getEntries, isAllowedRalliesInfoUrl, parseRalliesInfoChampionships, championshipTextFromCodes };
