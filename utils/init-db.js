const db = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_code TEXT UNIQUE NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  whatsapp TEXT,
  password_hash TEXT NOT NULL,
  passport_path TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pair TEXT UNIQUE NOT NULL,
  buy_rate REAL NOT NULL,
  sell_rate REAL NOT NULL,
  manual_buy REAL,
  manual_sell REAL,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payment_info (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_name TEXT,
  card_number TEXT,
  sheba TEXT,
  account_name TEXT,
  is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_code TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL,
  pair TEXT,
  amount_from REAL,
  amount_to REAL,
  status TEXT DEFAULT 'pending_payment',
  receipt_path TEXT,
  pickup_time TEXT,
  national_id TEXT,
  tracking_number TEXT,
  declaration_filled INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS cash_in_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL,
  amd_amount REAL,
  irr_amount REAL,
  bank_name TEXT,
  sheba_or_card TEXT,
  account_name TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

const count = db.prepare('SELECT COUNT(*) AS c FROM rates').get().c;
if (count === 0) {
  const insert = db.prepare('INSERT INTO rates (pair, buy_rate, sell_rate) VALUES (?, ?, ?)');
  insert.run('USD_AMD', 390, 395);
  insert.run('AMD_IRR', 3700, 3800);
  insert.run('USDT_AMD', 388, 393);
  insert.run('RUB_AMD', 4.1, 4.3);
}

console.log('Database initialized successfully');
