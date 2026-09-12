const axios = require('axios');
const db = require('./db');

const PAIRS = [
  'USD_AMD', 'AMD_USD',
  'AMD_IRR', 'IRR_AMD',
  'USDT_AMD', 'AMD_USDT',
  'RUB_AMD', 'AMD_RUB'
];

async function fetchFromErApi() {
  try {
    const res = await axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 8000 });
    if (res.data && res.data.rates) {
      return res.data.rates;
    }
  } catch (e) {
    console.error('er-api error:', e.message);
  }
  return null;
}

async function fetchCrypto() {
  try {
    // CoinGecko free for USDT
    const res = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=usd', { timeout: 8000 });
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
    // USD -> AMD
    updates.push({ pair: 'USD_AMD', buy: usdAmd * 0.995, sell: usdAmd * 1.005 });
    updates.push({ pair: 'AMD_USD', buy: (1 / usdAmd) * 0.995, sell: (1 / usdAmd) * 1.005 });
  }

  if (usdAmd && usdIrr) {
    // Cross AMD/IRR via USD
    const amdIrr = usdIrr / usdAmd;
    updates.push({ pair: 'AMD_IRR', buy: amdIrr * 0.99, sell: amdIrr * 1.01 });
    updates.push({ pair: 'IRR_AMD', buy: (1 / amdIrr) * 0.99, sell: (1 / amdIrr) * 1.01 });
  }

  if (usdAmd && usdtUsd) {
    const usdtAmd = usdAmd * usdtUsd;
    updates.push({ pair: 'USDT_AMD', buy: usdtAmd * 0.995, sell: usdtAmd * 1.005 });
    updates.push({ pair: 'AMD_USDT', buy: (1 / usdtAmd) * 0.995, sell: (1 / usdtAmd) * 1.005 });
  }

  if (usdAmd && usdRub) {
    const rubAmd = usdAmd / usdRub;
    updates.push({ pair: 'RUB_AMD', buy: rubAmd * 0.99, sell: rubAmd * 1.01 });
    updates.push({ pair: 'AMD_RUB', buy: (1 / rubAmd) * 0.99, sell: (1 / rubAmd) * 1.01 });
  }

  const stmt = db.prepare(`
    UPDATE rates SET buy_rate = ?, sell_rate = ?, source = 'api', is_manual = 0, updated_at = datetime('now')
    WHERE pair = ? AND is_manual = 0
  `);

  const insertHistory = db.prepare(`
    INSERT INTO rate_history (pair, buy_rate, sell_rate, source) VALUES (?, ?, ?, 'api')
  `);

  for (const u of updates) {
    stmt.run(u.buy, u.sell, u.pair);
    insertHistory.run(u.pair, u.buy, u.sell);
  }

  console.log('Rates updated from API at', new Date().toISOString());
  return true;
}

function getAllRates() {
  return db.prepare('SELECT * FROM rates ORDER BY pair').all();
}

function getRate(pair) {
  return db.prepare('SELECT * FROM rates WHERE pair = ?').get(pair);
}

function setManualRate(pair, buy, sell) {
  db.prepare(`
    UPDATE rates SET buy_rate = ?, sell_rate = ?, source = 'manual', is_manual = 1, updated_at = datetime('now')
    WHERE pair = ?
  `).run(buy, sell, pair);

  db.prepare(`
    INSERT INTO rate_history (pair, buy_rate, sell_rate, source) VALUES (?, ?, ?, 'manual')
  `).run(pair, buy, sell);
}

module.exports = {
  updateRatesFromApi,
  getAllRates,
  getRate,
  setManualRate,
  PAIRS
};
