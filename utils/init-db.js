const db = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_code TEXT UNIQUE NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone_am TEXT UNIQUE NOT NULL,
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
  source TEXT DEFAULT 'manual',
  is_manual INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rate_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pair TEXT NOT NULL,
  buy_rate REAL,
  sell_rate REAL,
  source TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payment_info (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_name TEXT,
  card_number TEXT,
  shaba TEXT,
  account_holder TEXT,
  is_active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_code TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL,
  pair TEXT,
  from_currency TEXT,
  to_currency TEXT,
  amount_from REAL,
  amount_to REAL,
  rate_used REAL,
  bank_name TEXT,
  status TEXT DEFAULT 'pending_payment',
  receipt_path TEXT,
  pickup_time TEXT,
  admin_note TEXT,
  national_id TEXT,
  deposit_date TEXT,
  from_account_name TEXT,
  tracking_number TEXT,
  receive_date TEXT,
  depositor_name_date TEXT,
  declaration_filled INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS cash_in_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL,
  amount_amd REAL NOT NULL,
  amount_toman REAL NOT NULL,
  delivery_date TEXT NOT NULL,
  delivery_time TEXT NOT NULL,
  iran_bank_name TEXT NOT NULL,
  iran_account_holder TEXT NOT NULL,
  iran_card_or_sheba TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  admin_note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
`);

const rateCount = db.prepare('SELECT COUNT(*) AS c FROM rates').get().c;
if (rateCount === 0) {
  const insert = db.prepare(
    'INSERT INTO rates (pair, buy_rate, sell_rate, source, is_manual) VALUES (?, ?, ?, ?, ?)'
  );
  insert.run('USD_AMD', 390, 395, 'manual', 0);
  insert.run('AMD_USD', 0.0025, 0.0026, 'manual', 0);
  insert.run('AMD_IRR', 3700, 3800, 'manual', 0);
  insert.run('IRR_AMD', 0.00026, 0.00027, 'manual', 0);
  insert.run('USDT_AMD', 388, 393, 'manual', 0);
  insert.run('AMD_USDT', 0.0025, 0.0026, 'manual', 0);
  insert.run('RUB_AMD', 4.1, 4.3, 'manual', 0);
  insert.run('AMD_RUB', 0.23, 0.25, 'manual', 0);
}

const bankCount = db.prepare('SELECT COUNT(*) AS c FROM payment_info').get().c;
if (bankCount === 0) {
  const ins = db.prepare(
    'INSERT INTO payment_info (bank_name, card_number, shaba, account_holder, is_active, sort_order) VALUES (?, ?, ?, ?, 1, ?)'
  );
  ins.run('ملت', '6037-****-****-1234', 'IR000000000000000000000001', 'صرافی', 1);
  ins.run('ملی', '6037-****-****-5678', 'IR000000000000000000000002', 'صرافی', 2);
  ins.run('سامان', '6219-****-****-9012', 'IR000000000000000000000003', 'صرافی', 3);
}

console.log('Database initialized successfully at', require('path').join(__dirname, '..', 'db', 'sarrafi.db'));
