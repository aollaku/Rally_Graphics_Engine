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
  // Do not leave ls=0: that forced every stage selector button to load the first stage/page.
  return `${BASE}/overall.php?EventID=${eventId}&StageID=${sid}&e=${eventId}&m=0&ls=${sid}&simple=1&selection=all`;
}
function urlEntry(eventId) { return `${BASE}/entry.php?EntryList=Entry+List&EventID=${eventId}&e=${eventId}`; }
function urlIndex(eventId) { return `${BASE}/index.php?EventID=${eventId}`; }

async function fetchHtml(url, ttl) {
  const now = Date.now();
  const item = cache.get(url);
  if (item && now - item.time < ttl) return item.html;
  const res = await axios.get(url, { timeout: 12000, headers: { 'User-Agent': 'RallyGraphics/1.0 (+tablet graphics app)' } });
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
    return {
      position,
      number,
      driver,
      codriver,
      car: c[carIdx] || '',
      class: className,
      totalTime: timeValues[0] || '',
      diffPrev: timeValues[1] || '',
      diffFirst: timeValues[2] || ''
    };
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
  return { position: nonEmpty[posIdx].replace('=',''), number, driver: split.driver, codriver: split.codriver, car, class: className, totalTime: nonEmpty[totalIdx], diffPrev: after[0] || '', diffFirst: after[1] || '' };
}

function stripNoise(text){
  return clean(text).replace(/^(?:\d+|H\d+|B\/b|B|b)\s+/,'');
}

function stripTrailingTown(name, town){
  const n = stripNoise(name);
  const t = clean(town);
  if(!n || !t) return n;
  if(n.toLowerCase().endsWith((' '+t).toLowerCase())) return clean(n.slice(0, -t.length));
  return n;
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
    out.push({ position, number, driver: split.driver, codriver: split.codriver, car: carTokens.join(' '), class: className, totalTime: total, diffPrev, diffFirst });
  }
  return out;
}

function parseEntries(html, url, limit = 999) {
  const $ = cheerio.load(html);
  const meta = pageMeta(html, url);
  const rows = [];
  $('table tr').each((_, tr) => {
    const cells = $(tr).find('td,th').map((__, td) => clean($(td).text())).get();
    const parsed = parseEntryCells(cells);
    if (parsed) rows.push(parsed);
  });
  if (!rows.length) parseEntryText($('body').text()).forEach(r => rows.push(r));
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
  const c = cells.map(clean);
  const number = c[0] && /^\d+[A-Za-z]?$/.test(c[0]) ? c[0] : c.find(x => /^\d+[A-Za-z]?$/.test(x));
  if (!number) return null;

  // DJames entry table usually:
  // 0 No, 1 Entrant/Sponsor, 2 BTRDA, 3 Driver, 4 Nat, 5 Town,
  // 6 Co-Driver, 7 Nat, 8 Town, 9 Car, 10 Class, 11+ Championships/notes
  if (c.length >= 10 && c[3] && c[6]) {
    const champText = inferChampionships(c);
    return {
      number,
      driver: stripTrailingTown(c[3], c[5]),
      codriver: stripTrailingTown(c[6], c[8]),
      car: c[9] || '',
      class: c[10] || '',
      championship: champText,
      championshipText: champText
    };
  }

  const idx = c.indexOf(number);
  const rest = c.slice(idx + 1).filter(Boolean);
  const className = [...rest].reverse().find(isClass) || '';
  const carIdx = rest.findIndex(startsCar);
  const car = carIdx >= 0 ? rest.slice(carIdx, className ? rest.lastIndexOf(className) : rest.length).join(' ') : '';
  const champ = inferChampionships(c);
  const nameText = rest.slice(0, carIdx >= 0 ? carIdx : rest.length)
    .filter(x => !isClass(x))
    .filter(x => !/^B\/b$|^B$|^[A-Z]{2,3}$/.test(x)).join(' ');
  const split = splitNames(nameText);
  return { number, driver: split.driver, codriver: split.codriver, car, class: className, championship: champ, championshipText: champ };
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
    rows.push({ number, driver: split.driver, codriver: split.codriver, car: carTokens.join(' '), class: className, championship: champ, championshipText: champ });
  }
  return rows;
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
async function getStage(eventId, stageId, limit, ttl) { const url = urlStage(eventId, stageId); return parseResultTables(await fetchHtml(url, ttl), url, limit); }
async function getEntries(eventId, limit, ttl) { const url = urlEntry(eventId); return parseEntries(await fetchHtml(url, ttl), url, limit); }

module.exports = { getEventInfo, getOverall, getStage, getEntries };
