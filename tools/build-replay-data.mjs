// Builds compact price files for the Replay Space.
//   cd tools && npm i dukascopy-node && node build-replay-data.mjs
// Output (public/replay-data): <inst>_h1.bin (2003→now), <inst>_m5_<year>.bin (one file per year since M5_FROM_YEAR), meta.json
// Binary layout (little endian): int32 count, int32 scale, int32 0, int32 0, then columns t(sec), o, h, l, c as int32 (price*scale).
import { getHistoricalRates } from 'dukascopy-node';
import fs from 'fs';
import path from 'path';
const OUT = path.resolve('../public/replay-data');
fs.mkdirSync(OUT, { recursive: true });
const M5_FROM_YEAR = 2013;
const INST = {
  XAUUSD: { duka: 'xauusd', scale: 1000, dp: 2 },
  EURUSD: { duka: 'eurusd', scale: 100000, dp: 5 },
  GBPUSD: { duka: 'gbpusd', scale: 100000, dp: 5 },
  GER40:  { duka: 'deuidxeur', scale: 1000, dp: 1 },
};
const now = new Date();
async function grab(duka, tf, from, to) {
  for (let a = 0; a < 4; a++) {
    try { return await getHistoricalRates({ instrument: duka, dates: { from, to }, timeframe: tf, format: 'json', priceType: 'bid', useCache: false }); }
    catch (e) { if (a === 3) { console.error('FAIL', duka, tf, from.toISOString().slice(0, 10), e.message); return []; } }
  }
}
function write(file, rows, scale) {
  rows.sort((a, b) => a.timestamp - b.timestamp);
  const uniq = rows.filter((r, i) => i === 0 || r.timestamp !== rows[i - 1].timestamp);
  const n = uniq.length, buf = new Int32Array(4 + n * 5);
  buf[0] = n; buf[1] = scale;
  uniq.forEach((r, i) => {
    buf[4 + i] = Math.round(r.timestamp / 1000);
    buf[4 + n + i] = Math.round(r.open * scale); buf[4 + 2 * n + i] = Math.round(r.high * scale);
    buf[4 + 3 * n + i] = Math.round(r.low * scale); buf[4 + 4 * n + i] = Math.round(r.close * scale);
  });
  fs.writeFileSync(path.join(OUT, file), Buffer.from(buf.buffer));
  return { n, first: uniq[0]?.timestamp / 1000, last: uniq[n - 1]?.timestamp / 1000 };
}
const meta = { generated: now.toISOString(), instruments: {} };
await Promise.all(Object.entries(INST).map(async ([name, cfg]) => {
  const h1 = [];
  for (let y = 2003; y <= now.getUTCFullYear(); y++) {
    const rows = await grab(cfg.duka, 'h1', new Date(Date.UTC(y, 0, 1)), new Date(Math.min(Date.UTC(y + 1, 0, 1), now.getTime())));
    h1.push(...rows);
  }
  const a = write(`${name.toLowerCase()}_h1.bin`, h1, cfg.scale);
  const m5Years = [];
  let m5First = null, m5Count = 0;
  for (let y = M5_FROM_YEAR; y <= now.getUTCFullYear(); y++) {
    const rows = [];
    for (let m = 0; m < 12; m++) {
      const from = new Date(Date.UTC(y, m, 1)); if (from > now) break;
      const to = new Date(Math.min(Date.UTC(y, m + 1, 1), now.getTime()));
      rows.push(...await grab(cfg.duka, 'm5', from, to));
    }
    if (!rows.length) continue;
    const b = write(`${name.toLowerCase()}_m5_${y}.bin`, rows, cfg.scale);
    m5Years.push(y); m5Count += b.n; if (m5First == null) m5First = b.first;
  }
  meta.instruments[name] = { scale: cfg.scale, dp: cfg.dp, h1: a, m5Years, m5First, m5Count };
  console.log(name, 'h1', a.n, 'm5 years', m5Years.join(','), 'm5 bars', m5Count);
}));
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 1));
console.log('done');
