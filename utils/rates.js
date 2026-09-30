const axios = require('axios');
const db = require('./db');

/**
 * One direction only (no reverse pairs clutter).
 * Admin sets buy + sell for each.
 * Example:
 *   IRR_AMD  buy 215  sell 200
 *   USD_AMD  buy 355  sell 360
 */
const PAIRS = [
  'USD_AMD',
  'USDT_AMD',
  'IRR_AMD',
  'RUB_AMD'
];

const PAIR_LABELS = {
  USD_AMD: 'دلار → درام',
  USDT_AMD: 'تتر → درام',
  IRR_AMD: 'تومان/ریال → درام',
  RUB_AMD: 'روبل → درام'
};

async function fetchFromErApi() {
  try {
    const res = await axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 8000 });
    if (res.data && res.data.rates) return res.data.rates;
  } catch (e) {
    console.error('er-api error:', e.message);
  }
  return null;
}

async function fetchCrypto() {
  try {
    const res = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=usd',
      { timeout: 8000 }
    );
    return res.data?.tether?.usd || 1;
  } catch (e) {
    return 1;
  }
}

async function updateRatesFromApi() {
  const rates = await fetchFromErApi();
  if (!rates) return false;

  const usdAmd = rates.AMD || null;
  const usdIrr = rates.IRR || null;
  const usdRub = rates.RUB || null;
  const usdtUsd = await fetchCrypto();
  const updates = [];

  if (usdAmd) {
    updates.push({ pair: 'USD_AMD', buy: usdAmd * 0.995, sell: usdAmd * 1.005 });
  }
  if (usdAmd && usdtUsd) {
    const usdtAmd = usdAmd * usdtUsd;
    updates.push({ pair: 'USDT_AMD', buy: usdtAmd * 0.995, sell: usdtAmd * 1.005 });
  }
  if (usdAmd && usdIrr) {
    // AMD per 1 IRR unit (very small) — admin usually sets manually for toman
    const irrAmd = usdAmd / usdIrr;
    updates.push({ pair: 'IRR_AMD', buy: irrAmd * 0.99, sell: irrAmd * 1.01 });
  }
  if (usdAmd && usdRub) {
    const rubAmd = usdAmd / usdRub;
    updates.push({ pair: 'RUB_AMD', buy: rubAmd * 0.99, sell: rubAmd * 1.01 });
  }

  const stmt = db.prepare(`
    UPDATE rates SET buy_rate = ?, sell_rate = ?, source = 'api', is_manual = 0, updated_at = datetime('now')
    WHERE pair = ? AND is_manual = 0
  `);
  const insertHistory = db.prepare(
    `INSERT INTO rate_history (pair, buy_rate, sell_rate, source) VALUES (?, ?, ?, 'api')`
  );

  for (const u of updates) {
    try {
      const info = stmt.run(u.buy, u.sell, u.pair);
      if (info.changes === 0) {
        db.prepare(`
          INSERT OR IGNORE INTO rates (pair, buy_rate, sell_rate, source, is_manual)
          VALUES (?, ?, ?, 'api', 0)
        `).run(u.pair, u.buy, u.sell);
        stmt.run(u.buy, u.sell, u.pair);
      }
      insertHistory.run(u.pair, u.buy, u.sell);
    } catch (e) {
      console.error('rate update', u.pair, e.message);
    }
  }

  // Remove reverse / old clutter pairs
  try {
    db.prepare(`
      DELETE FROM rates WHERE pair NOT IN (${PAIRS.map(() => '?').join(',')})
    `).run(...PAIRS);
  } catch (e) {}

  console.log('Rates updated from API at', new Date().toISOString());
  return true;
}

function getAllRates() {
  try {
    ensureActivePairs();
    const rows = db.prepare('SELECT * FROM rates ORDER BY pair').all();
    return rows
      .filter((r) => PAIRS.includes(r.pair))
      .sort((a, b) => PAIRS.indexOf(a.pair) - PAIRS.indexOf(b.pair));
  } catch (e) {
    console.error('getAllRates', e.message);
    return [];
  }
}

function getRate(pair) {
  return db.prepare('SELECT * FROM rates WHERE pair = ?').get(pair);
}

function setManualRate(pair, buy, sell) {
  if (!PAIRS.includes(pair)) return false;
  const existing = db.prepare('SELECT pair FROM rates WHERE pair = ?').get(pair);
  if (existing) {
    db.prepare(`
      UPDATE rates SET buy_rate = ?, sell_rate = ?, source = 'manual', is_manual = 1, updated_at = datetime('now')
      WHERE pair = ?
    `).run(buy, sell, pair);
  } else {
    db.prepare(`
      INSERT INTO rates (pair, buy_rate, sell_rate, source, is_manual, updated_at)
      VALUES (?, ?, ?, 'manual', 1, datetime('now'))
    `).run(pair, buy, sell);
  }
  try {
    db.prepare(
      `INSERT INTO rate_history (pair, buy_rate, sell_rate, source) VALUES (?, ?, ?, 'manual')`
    ).run(pair, buy, sell);
  } catch (e) {}
  return true;
}

function ensureActivePairs() {
  // Your example defaults (admin can change anytime)
  const defaults = {
    USD_AMD: { buy: 355, sell: 360 },
    USDT_AMD: { buy: 350, sell: 358 },
    IRR_AMD: { buy: 215, sell: 200 },
    RUB_AMD: { buy: 4.1, sell: 4.3 }
  };

  try {
    db.prepare(`
      DELETE FROM rates WHERE pair NOT IN (${PAIRS.map(() => '?').join(',')})
    `).run(...PAIRS);
  } catch (e) {}

  for (const pair of PAIRS) {
    const row = db.prepare('SELECT pair FROM rates WHERE pair = ?').get(pair);
    if (!row) {
      const d = defaults[pair] || { buy: 1, sell: 1 };
      db.prepare(
        `INSERT INTO rates (pair, buy_rate, sell_rate, source, is_manual) VALUES (?, ?, ?, 'default', 0)`
      ).run(pair, d.buy, d.sell);
    }
  }
}

module.exports = {
  updateRatesFromApi,
  getAllRates,
  getRate,
  setManualRate,
  ensureActivePairs,
  PAIRS,
  PAIR_LABELS
};
