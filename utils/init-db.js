const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'db', 'sarrafi.db');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);

db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_code TEXT UNIQUE NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    phone_am TEXT NOT NULL,
    whatsapp TEXT,
    passport_path TEXT,
    password_hash TEXT,
    is_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
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

  CREATE TABLE IF NOT EXISTS payment_info (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bank_name TEXT NOT NULL,
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
    pair TEXT NOT NULL,
    from_currency TEXT NOT NULL,
    to_currency TEXT NOT NULL,
    amount_from REAL NOT NULL,
    amount_to REAL NOT NULL,
    rate_used REAL NOT NULL,
    bank_name TEXT,
    receipt_path TEXT,
    status TEXT DEFAULT 'pending_payment',
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
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS rate_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pair TEXT NOT NULL,
    buy_rate REAL,
    sell_rate REAL,
    source TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Seed default rates
const defaultRates = [
  { pair: 'USD_AMD', buy: 390, sell: 395 },
  { pair: 'AMD_USD', buy: 0.00253, sell: 0.00256 },
  { pair: 'AMD_IRR', buy: 3700, sell: 3800 },
  { pair: 'IRR_AMD', buy: 0.000263, sell: 0.000270 },
  { pair: 'USDT_AMD', buy: 388, sell: 393 },
  { pair: 'AMD_USDT', buy: 0.00254, sell: 0.00258 },
  { pair: 'RUB_AMD', buy: 4.1, sell: 4.3 },
  { pair: 'AMD_RUB', buy: 0.232, sell: 0.244 }
];

const insertRate = db.prepare(`
  INSERT OR IGNORE INTO rates (pair, buy_rate, sell_rate, source, is_manual)
  VALUES (?, ?, ?, 'default', 0)
`);

defaultRates.forEach(r => insertRate.run(r.pair, r.buy, r.sell));

// Seed payment banks (example Iranian banks)
const banks = [
  { name: 'بانک ملی ایران', card: '6037-XXXX-XXXX-XXXX', shaba: 'IR00-0000-0000-0000-0000-0000-00', holder: 'نام صاحب حساب' },
  { name: 'بانک ملت', card: '6104-XXXX-XXXX-XXXX', shaba: 'IR00-0000-0000-0000-0000-0000-00', holder: 'نام صاحب حساب' },
  { name: 'بانک صادرات', card: '6037-XXXX-XXXX-XXXX', shaba: 'IR00-0000-0000-0000-0000-0000-00', holder: 'نام صاحب حساب' },
  { name: 'بانک پاسارگاد', card: '5022-XXXX-XXXX-XXXX', shaba: 'IR00-0000-0000-0000-0000-0000-00', holder: 'نام صاحب حساب' },
  { name: 'بانک سامان', card: '6219-XXXX-XXXX-XXXX', shaba: 'IR00-0000-0000-0000-0000-0000-00', holder: 'نام صاحب حساب' }
];

const insertBank = db.prepare(`
  INSERT OR IGNORE INTO payment_info (bank_name, card_number, shaba, account_holder, sort_order)
  VALUES (?, ?, ?, ?, ?)
`);

banks.forEach((b, i) => insertBank.run(b.name, b.card, b.shaba, b.holder, i));

console.log('Database initialized successfully at', dbPath);
db.close();

// Table for AMD cash delivery → IRR bank transfer orders
db.exec(`
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

console.log('cash_in_orders table ensured');
