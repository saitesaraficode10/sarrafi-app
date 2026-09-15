require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const db = require('./utils/db');
const { updateRatesFromApi, getAllRates, getRate, setManualRate } = require('./utils/rates');
const { authUser, authAdmin, optionalUser } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure upload dirs
['passports', 'receipts'].forEach(dir => {
  const p = path.join(__dirname, 'public', 'uploads', dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Rate limit
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300 });
app.use(limiter);

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

// Multer
const storagePassport = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'public', 'uploads', 'passports')),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random()*1e9) + path.extname(file.originalname))
});
const storageReceipt = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'public', 'uploads', 'receipts')),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random()*1e9) + path.extname(file.originalname))
});
const uploadPassport = multer({ storage: storagePassport, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
  if (/\.(jpg|jpeg|png|webp|pdf)$/i.test(file.originalname)) cb(null, true);
  else cb(new Error('فقط تصویر یا PDF مجاز است'));
}});
const uploadReceipt = multer({ storage: storageReceipt, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
  if (/\.(jpg|jpeg|png|webp|pdf)$/i.test(file.originalname)) cb(null, true);
  else cb(new Error('فقط تصویر یا PDF مجاز است'));
}});

// i18n simple
const translations = {
  fa: require('./locales/fa.json'),
  en: require('./locales/en.json'),
  ru: require('./locales/ru.json'),
  hy: require('./locales/hy.json')
};

function t(lang, key) {
  return (translations[lang] && translations[lang][key]) || (translations.fa[key]) || key;
}

app.use((req, res, next) => {
  const lang = req.cookies.lang || 'fa';
  res.locals.lang = lang;
  res.locals.t = (key) => t(lang, key);
  res.locals.dir = (lang === 'fa' || lang === 'hy') ? 'rtl' : 'ltr';
  next();
});

// ========== PUBLIC ROUTES ==========
app.get('/', optionalUser, (req, res) => {
  const rates = getAllRates();
  res.render('index', { user: req.user, rates, title: 'صرافی آنلاین' });
});

app.get('/set-lang/:lang', (req, res) => {
  const lang = ['fa', 'en', 'ru', 'hy'].includes(req.params.lang) ? req.params.lang : 'fa';
  res.cookie('lang', lang, { maxAge: 365 * 24 * 60 * 60 * 1000 });
  res.redirect(req.get('Referer') || '/');
});

app.get('/register', (req, res) => {
  res.render('register', { error: null, title: 'ثبت‌نام' });
});

app.post('/register', uploadPassport.single('passport'), async (req, res) => {
  try {
    const { first_name, last_name, phone_am, whatsapp, password } = req.body;
    if (!first_name || !last_name || !phone_am || !password) {
      return res.render('register', { error: 'همه فیلدهای اجباری را پر کنید', title: 'ثبت‌نام' });
    }
    if (!req.file) {
      return res.render('register', { error: 'آپلود پاسپورت یا کارت اقامت الزامی است', title: 'ثبت‌نام' });
    }

    const user_code = 'U' + Date.now().toString().slice(-8) + Math.floor(Math.random()*90+10);
    const password_hash = await bcrypt.hash(password, 12);
    const passport_path = '/uploads/passports/' + req.file.filename;

    db.prepare(`
      INSERT INTO users (user_code, first_name, last_name, phone_am, whatsapp, passport_path, password_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(user_code, first_name, last_name, phone_am, whatsapp || null, passport_path, password_hash);

    res.render('register-success', { user_code, title: 'ثبت‌نام موفق' });
  } catch (e) {
    console.error(e);
    res.render('register', { error: 'خطا در ثبت‌نام. شماره تکراری یا مشکل سرور.', title: 'ثبت‌نام' });
  }
});

app.get('/login', (req, res) => {
  res.render('login', { error: null, title: 'ورود' });
});

app.post('/login', loginLimiter, async (req, res) => {
  const { phone_am, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE phone_am = ?').get(phone_am);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.render('login', { error: 'شماره یا رمز اشتباه است', title: 'ورود' });
  }
  const token = jwt.sign({ id: user.id, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
  res.redirect('/dashboard');
});

app.get('/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/');
});

// ========== USER DASHBOARD ==========
app.get('/dashboard', authUser, (req, res) => {
  const txs = db.prepare(`
    SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC
  `).all(req.user.id);
  const cashIns = db.prepare(`
    SELECT * FROM cash_in_orders WHERE user_id = ? ORDER BY created_at DESC
  `).all(req.user.id);
  res.render('user/dashboard', { user: req.user, txs, cashIns, title: 'داشبورد من' });
});

app.get('/new-order', authUser, (req, res) => {
  const rates = getAllRates();
  const banks = db.prepare('SELECT * FROM payment_info WHERE is_active = 1 ORDER BY sort_order').all();
  res.render('user/new-order', { user: req.user, rates, banks, error: null, title: 'سفارش جدید' });
});

app.post('/new-order', authUser, (req, res) => {
  const { pair, amount_from, bank_name } = req.body;
  const rateRow = getRate(pair);
  if (!rateRow) return res.redirect('/new-order');

  const [from_currency, to_currency] = pair.split('_');
  const amount = parseFloat(amount_from);
  if (!amount || amount <= 0) {
    const rates = getAllRates();
    const banks = db.prepare('SELECT * FROM payment_info WHERE is_active = 1 ORDER BY sort_order').all();
    return res.render('user/new-order', { user: req.user, rates, banks, error: 'مبلغ نامعتبر', title: 'سفارش جدید' });
  }

  // Use sell rate for user buying the to_currency (simplified)
  const rate_used = rateRow.sell_rate;
  const amount_to = amount * rate_used;
  const transaction_code = 'TX' + Date.now().toString().slice(-10);

  db.prepare(`
    INSERT INTO transactions (transaction_code, user_id, pair, from_currency, to_currency, amount_from, amount_to, rate_used, bank_name, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment')
  `).run(transaction_code, req.user.id, pair, from_currency, to_currency, amount, amount_to, rate_used, bank_name);

  res.redirect('/order/' + transaction_code);
});

app.get('/order/:code', authUser, (req, res) => {
  const tx = db.prepare('SELECT * FROM transactions WHERE transaction_code = ? AND user_id = ?').get(req.params.code, req.user.id);
  if (!tx) return res.status(404).send('سفارش یافت نشد');
  const bank = db.prepare('SELECT * FROM payment_info WHERE bank_name = ?').get(tx.bank_name);
  res.render('user/order', { user: req.user, tx, bank, title: 'جزئیات سفارش' });
});

app.post('/order/:code/upload-receipt', authUser, uploadReceipt.single('receipt'), (req, res) => {
  const tx = db.prepare('SELECT * FROM transactions WHERE transaction_code = ? AND user_id = ?').get(req.params.code, req.user.id);
  if (!tx || tx.status !== 'pending_payment') return res.redirect('/dashboard');
  if (!req.file) return res.redirect('/order/' + req.params.code);

  const receipt_path = '/uploads/receipts/' + req.file.filename;
  db.prepare(`
    UPDATE transactions SET receipt_path = ?, status = 'pending_declaration', updated_at = datetime('now')
    WHERE id = ?
  `).run(receipt_path, tx.id);

  res.redirect('/order/' + req.params.code + '/declaration');
});

// فرم اعلامیه پس از آپلود رسید
app.get('/order/:code/declaration', authUser, (req, res) => {
  const tx = db.prepare('SELECT * FROM transactions WHERE transaction_code = ? AND user_id = ?').get(req.params.code, req.user.id);
  if (!tx) return res.status(404).send('سفارش یافت نشد');
  if (!tx.receipt_path) return res.redirect('/order/' + req.params.code);
  const bank = db.prepare('SELECT * FROM payment_info WHERE bank_name = ?').get(tx.bank_name);
  res.render('user/declaration', {
    user: req.user,
    tx,
    bank,
    error: null,
    title: 'اعلامیه دریافت درام'
  });
});

app.post('/order/:code/declaration', authUser, (req, res) => {
  const tx = db.prepare('SELECT * FROM transactions WHERE transaction_code = ? AND user_id = ?').get(req.params.code, req.user.id);
  if (!tx || !tx.receipt_path) return res.redirect('/dashboard');

  const {
    national_id,
    deposit_date,
    from_account_name,
    tracking_number,
    receive_date,
    depositor_name_date
  } = req.body;

  if (!national_id || !deposit_date || !from_account_name || !tracking_number || !receive_date || !depositor_name_date) {
    const bank = db.prepare('SELECT * FROM payment_info WHERE bank_name = ?').get(tx.bank_name);
    return res.render('user/declaration', {
      user: req.user,
      tx,
      bank,
      error: 'لطفاً تمام فیلدهای اعلامیه را تکمیل کنید',
      title: 'اعلامیه دریافت درام'
    });
  }

  db.prepare(`
    UPDATE transactions SET
      national_id = ?,
      deposit_date = ?,
      from_account_name = ?,
      tracking_number = ?,
      receive_date = ?,
      depositor_name_date = ?,
      declaration_filled = 1,
      status = 'pending_review',
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    national_id,
    deposit_date,
    from_account_name,
    tracking_number,
    receive_date,
    depositor_name_date,
    tx.id
  );

  res.redirect('/order/' + req.params.code + '/declaration-receipt');
});

app.get('/order/:code/declaration-receipt', authUser, (req, res) => {
  const tx = db.prepare(`
    SELECT t.*, u.first_name, u.last_name, u.user_code
    FROM transactions t JOIN users u ON t.user_id = u.id
    WHERE t.transaction_code = ? AND t.user_id = ?
  `).get(req.params.code, req.user.id);
  if (!tx || !tx.declaration_filled) return res.redirect('/order/' + req.params.code);
  const bank = db.prepare('SELECT * FROM payment_info WHERE bank_name = ?').get(tx.bank_name);
  res.render('user/declaration-receipt', {
    user: req.user,
    tx,
    bank,
    title: 'رسید اعلامیه'
  });
});



// ========== CASH-IN (تحویل درام نقدی → واریز ریال به ایران) ==========
app.get('/cash-in', authUser, (req, res) => {
  const rate = getRate('AMD_IRR');
  res.render('user/cash-in', {
    user: req.user,
    rate,
    error: null,
    title: 'تحویل درام نقدی'
  });
});

app.post('/cash-in', authUser, (req, res) => {
  const {
    amount_amd,
    amount_toman,
    delivery_date,
    delivery_time,
    iran_bank_name,
    iran_account_holder,
    iran_card_or_sheba
  } = req.body;

  if (!amount_amd || !amount_toman || !delivery_date || !delivery_time ||
      !iran_bank_name || !iran_account_holder || !iran_card_or_sheba) {
    const rate = getRate('AMD_IRR');
    return res.render('user/cash-in', {
      user: req.user,
      rate,
      error: 'لطفاً تمام فیلدها را پر کنید',
      title: 'تحویل درام نقدی'
    });
  }

  const order_code = 'CI' + Date.now().toString().slice(-10);
  db.prepare(`
    INSERT INTO cash_in_orders
    (order_code, user_id, amount_amd, amount_toman, delivery_date, delivery_time,
     iran_bank_name, iran_account_holder, iran_card_or_sheba, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(
    order_code,
    req.user.id,
    parseFloat(amount_amd),
    parseFloat(amount_toman),
    delivery_date,
    delivery_time,
    iran_bank_name,
    iran_account_holder,
    iran_card_or_sheba
  );

  res.redirect('/cash-in/receipt/' + order_code);
});

app.get('/cash-in/receipt/:code', authUser, (req, res) => {
  const order = db.prepare(`
    SELECT c.*, u.first_name, u.last_name, u.whatsapp, u.phone_am, u.user_code
    FROM cash_in_orders c
    JOIN users u ON c.user_id = u.id
    WHERE c.order_code = ? AND c.user_id = ?
  `).get(req.params.code, req.user.id);

  if (!order) return res.status(404).send('رسید یافت نشد');
  res.render('user/cash-in-receipt', { user: req.user, order, title: 'رسید تحویل درام' });
});

// ========== ADMIN ==========
app.get('/admin/login', (req, res) => {
  res.render('admin/login', { error: null, title: 'ورود ادمین' });
});

app.post('/admin/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  // Check against env first (for initial), then DB
  let valid = false;
  let adminId = 0;
  if (username === process.env.ADMIN1_USERNAME && password === process.env.ADMIN1_PASSWORD) {
    valid = true; adminId = 1;
  } else if (username === process.env.ADMIN2_USERNAME && password === process.env.ADMIN2_PASSWORD) {
    valid = true; adminId = 2;
  } else {
    const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
    if (admin && await bcrypt.compare(password, admin.password_hash)) {
      valid = true; adminId = admin.id;
    }
  }
  if (!valid) {
    return res.render('admin/login', { error: 'نام کاربری یا رمز اشتباه', title: 'ورود ادمین' });
  }
  const token = jwt.sign({ id: adminId, username, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '12h' });
  res.cookie('admin_token', token, { httpOnly: true, maxAge: 12 * 60 * 60 * 1000 });
  res.redirect('/admin');
});

app.get('/admin/logout', (req, res) => {
  res.clearCookie('admin_token');
  res.redirect('/admin/login');
});

app.get('/admin', authAdmin, (req, res) => {
  const stats = {
    users: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
    pending: db.prepare("SELECT COUNT(*) as c FROM transactions WHERE status IN ('pending_payment','pending_declaration','pending_review')").get().c,
    completed: db.prepare("SELECT COUNT(*) as c FROM transactions WHERE status = 'completed'").get().c
  };
  const recentTx = db.prepare(`
    SELECT t.*, u.first_name, u.last_name, u.user_code
    FROM transactions t JOIN users u ON t.user_id = u.id
    ORDER BY t.created_at DESC LIMIT 10
  `).all();
  res.render('admin/dashboard', { admin: req.admin, stats, recentTx, title: 'پنل ادمین' });
});

app.get('/admin/users', authAdmin, (req, res) => {
  const q = req.query.q || '';
  let users;
  if (q) {
    users = db.prepare(`
      SELECT * FROM users WHERE user_code LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR phone_am LIKE ?
      ORDER BY created_at DESC
    `).all(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  } else {
    users = db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT 100').all();
  }
  res.render('admin/users', { admin: req.admin, users, q, title: 'کاربران' });
});

app.get('/admin/user/:code', authAdmin, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE user_code = ?').get(req.params.code);
  if (!user) return res.status(404).send('کاربر یافت نشد');
  const txs = db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
  res.render('admin/user-detail', { admin: req.admin, user, txs, title: 'جزئیات کاربر' });
});

app.get('/admin/transactions', authAdmin, (req, res) => {
  const status = req.query.status || '';
  let txs;
  if (status) {
    txs = db.prepare(`
      SELECT t.*, u.first_name, u.last_name, u.user_code
      FROM transactions t JOIN users u ON t.user_id = u.id
      WHERE t.status = ? ORDER BY t.created_at DESC
    `).all(status);
  } else {
    txs = db.prepare(`
      SELECT t.*, u.first_name, u.last_name, u.user_code
      FROM transactions t JOIN users u ON t.user_id = u.id
      ORDER BY t.created_at DESC LIMIT 100
    `).all();
  }
  res.render('admin/transactions', { admin: req.admin, txs, status, title: 'تراکنش‌ها' });
});

app.get('/admin/transaction/:code', authAdmin, (req, res) => {
  const tx = db.prepare(`
    SELECT t.*, u.first_name, u.last_name, u.user_code, u.phone_am, u.whatsapp
    FROM transactions t JOIN users u ON t.user_id = u.id
    WHERE t.transaction_code = ?
  `).get(req.params.code);
  if (!tx) return res.status(404).send('یافت نشد');
  res.render('admin/transaction-detail', { admin: req.admin, tx, title: 'جزئیات تراکنش' });
});

app.post('/admin/transaction/:code/update', authAdmin, (req, res) => {
  const { status, pickup_time, admin_note } = req.body;
  const tx = db.prepare('SELECT * FROM transactions WHERE transaction_code = ?').get(req.params.code);
  if (!tx) return res.redirect('/admin/transactions');

  db.prepare(`
    UPDATE transactions SET status = ?, pickup_time = ?, admin_note = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(status || tx.status, pickup_time || tx.pickup_time, admin_note || tx.admin_note, tx.id);

  res.redirect('/admin/transaction/' + req.params.code);
});

app.get('/admin/rates', authAdmin, (req, res) => {
  const rates = getAllRates();
  res.render('admin/rates', { admin: req.admin, rates, title: 'نرخ‌ها' });
});

app.post('/admin/rates/update', authAdmin, (req, res) => {
  const { pair, buy_rate, sell_rate } = req.body;
  if (pair && buy_rate && sell_rate) {
    setManualRate(pair, parseFloat(buy_rate), parseFloat(sell_rate));
  }
  res.redirect('/admin/rates');
});

app.post('/admin/rates/refresh', authAdmin, async (req, res) => {
  await updateRatesFromApi();
  res.redirect('/admin/rates');
});

app.get('/admin/payments', authAdmin, (req, res) => {
  const banks = db.prepare('SELECT * FROM payment_info ORDER BY sort_order').all();
  res.render('admin/payments', { admin: req.admin, banks, title: 'اطلاعات واریز' });
});

app.post('/admin/payments/update', authAdmin, (req, res) => {
  const { id, card_number, shaba, account_holder, is_active } = req.body;
  db.prepare(`
    UPDATE payment_info SET card_number = ?, shaba = ?, account_holder = ?, is_active = ?
    WHERE id = ?
  `).run(card_number, shaba, account_holder, is_active ? 1 : 0, id);
  res.redirect('/admin/payments');
});


// ========== ADMIN CASH-IN ORDERS ==========
app.get('/admin/cash-in', authAdmin, (req, res) => {
  const status = req.query.status || '';
  let orders;
  if (status) {
    orders = db.prepare(`
      SELECT c.*, u.first_name, u.last_name, u.user_code, u.whatsapp, u.phone_am
      FROM cash_in_orders c JOIN users u ON c.user_id = u.id
      WHERE c.status = ? ORDER BY c.created_at DESC
    `).all(status);
  } else {
    orders = db.prepare(`
      SELECT c.*, u.first_name, u.last_name, u.user_code, u.whatsapp, u.phone_am
      FROM cash_in_orders c JOIN users u ON c.user_id = u.id
      ORDER BY c.created_at DESC LIMIT 100
    `).all();
  }
  res.render('admin/cash-in', { admin: req.admin, orders, status, title: 'سفارش‌های تحویل درام' });
});

app.get('/admin/cash-in/:code', authAdmin, (req, res) => {
  const order = db.prepare(`
    SELECT c.*, u.first_name, u.last_name, u.user_code, u.whatsapp, u.phone_am
    FROM cash_in_orders c JOIN users u ON c.user_id = u.id
    WHERE c.order_code = ?
  `).get(req.params.code);
  if (!order) return res.status(404).send('یافت نشد');
  res.render('admin/cash-in-detail', { admin: req.admin, order, title: 'جزئیات سفارش تحویل درام' });
});

app.post('/admin/cash-in/:code/update', authAdmin, (req, res) => {
  const { status, admin_note } = req.body;
  const order = db.prepare('SELECT * FROM cash_in_orders WHERE order_code = ?').get(req.params.code);
  if (!order) return res.redirect('/admin/cash-in');
  db.prepare(`
    UPDATE cash_in_orders SET status = ?, admin_note = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(status || order.status, admin_note || order.admin_note, order.id);
  res.redirect('/admin/cash-in/' + req.params.code);
});

// Seed admins on start if needed
function seedAdmins() {
  const count = db.prepare('SELECT COUNT(*) as c FROM admins').get().c;
  if (count === 0) {
    // Already using env for login, optional DB seed
  }
}

// Start
async function start() {
  // Init / migrate DB
  if (!fs.existsSync(path.join(__dirname, 'db', 'sarrafi.db'))) {
    require('./utils/init-db');
  } else {
    // Ensure new tables exist
    try {
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
      // declaration columns for transactions
      const cols = db.prepare("PRAGMA table_info(transactions)").all().map(c => c.name);
      const addCol = (name, type) => {
        if (!cols.includes(name)) {
          db.exec(`ALTER TABLE transactions ADD COLUMN ${name} ${type}`);
        }
      };
      addCol('national_id', 'TEXT');
      addCol('deposit_date', 'TEXT');
      addCol('from_account_name', 'TEXT');
      addCol('tracking_number', 'TEXT');
      addCol('receive_date', 'TEXT');
      addCol('depositor_name_date', 'TEXT');
      addCol('declaration_filled', 'INTEGER DEFAULT 0');
    } catch (e) { console.log('migrate:', e.message); }
  }
    try { require('./utils/init-db'); } catch (e) { console.log(e.message); }
  seedAdmins();
  // Initial rates fetch
  try {
    await updateRatesFromApi();
  } catch (e) {
    console.log('Initial rate fetch failed, using defaults');
  }
  // Refresh rates every 30 min
  setInterval(() => updateRatesFromApi().catch(() => {}), 30 * 60 * 1000);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 سرور صرافی روی پورت ${PORT} در حال اجراست`);
    console.log(`ادمین ۱: ${process.env.ADMIN1_USERNAME} / ${process.env.ADMIN1_PASSWORD}`);
    console.log(`ادمین ۲: ${process.env.ADMIN2_USERNAME} / ${process.env.ADMIN2_PASSWORD}`);
  });
}

start();
