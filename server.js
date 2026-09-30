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
const { updateRatesFromApi, getAllRates, getRate, setManualRate, ensureActivePairs } = require('./utils/rates');
const { sendOtp, generateOtp } = require('./utils/sms');
const { authUser, authAdmin, optionalUser } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

function normalizePhone(p) {
  return String(p || '').replace(/[\s\-()]/g, '').trim();
}

function getSettings() {
  try {
    const rows = db.prepare('SELECT key, value FROM site_settings').all();
    const o = {};
    rows.forEach(r => o[r.key] = r.value);
    return {
      phone: o.phone || '+37400000000',
      whatsapp: o.whatsapp || '+37400000000',
      address: o.address || 'Yerevan, Armenia',
      map_url: o.map_url || 'https://maps.google.com',
      office_note: o.office_note || ''
    };
  } catch (e) {
    return { phone:'+37400000000', whatsapp:'+37400000000', address:'Yerevan', map_url:'#', office_note:'' };
  }
}

function statusLabel(st) {
  const m = {
    pending_payment: 'در انتظار واریز',
    pending_declaration: 'در انتظار اعلامیه',
    pending_review: 'در انتظار بررسی ادمین',
    ready_pickup: 'آماده حضور در دفتر',
    completed: 'تکمیل شده',
    rejected: 'رسید رد شده'
  };
  return m[st] || st;
}



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
  res.locals.settings = getSettings();
  res.locals.statusLabel = statusLabel;
  next();
});

// ========== PUBLIC ROUTES ==========
app.get('/', optionalUser, (req, res) => {
  try {
    let rates = [];
    try { rates = getAllRates() || []; } catch (e) { console.error('rates:', e.message); rates = []; }
    let userCount = 0;
    try { userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c; } catch (e) {}
    res.render('index', { user: req.user, rates, userCount, title: 'صرافی آنلاین' });
  } catch (e) {
    console.error('home error:', e.message);
    res.status(500).send('خطای سرور: ' + e.message);
  }
});

app.get('/set-lang/:lang', (req, res) => {
  const lang = ['fa', 'en', 'ru', 'hy'].includes(req.params.lang) ? req.params.lang : 'fa';
  res.cookie('lang', lang, { maxAge: 365 * 24 * 60 * 60 * 1000 });
  res.redirect(req.get('Referer') || '/');
});

app.get('/register', (req, res) => {
  const a = Math.floor(Math.random() * 8) + 2;
  const b = Math.floor(Math.random() * 8) + 2;
  const token = require('crypto').randomBytes(8).toString('hex');
  try {
    db.prepare("INSERT INTO otp_codes (phone, code, purpose, expires_at) VALUES (?, ?, 'captcha', ?)").run(
      token, String(a + b), new Date(Date.now() + 15 * 60 * 1000).toISOString()
    );
  } catch (e) {}
  res.render('register', {
    error: null,
    captchaToken: token,
    captchaQuestion: `${a} + ${b}`,
    title: 'ثبت‌نام'
  });
});

app.post('/register', async (req, res) => {
  const makeCaptcha = () => {
    const a = Math.floor(Math.random() * 8) + 2;
    const b = Math.floor(Math.random() * 8) + 2;
    const token = require('crypto').randomBytes(8).toString('hex');
    try {
      db.prepare("INSERT INTO otp_codes (phone, code, purpose, expires_at) VALUES (?, ?, 'captcha', ?)").run(
        token, String(a + b), new Date(Date.now() + 15 * 60 * 1000).toISOString()
      );
    } catch (e) {}
    return { captchaToken: token, captchaQuestion: `${a} + ${b}` };
  };
  try {
    const first_name = String(req.body.first_name || '').trim();
    const last_name = String(req.body.last_name || '').trim();
    const phone_am = normalizePhone(req.body.phone_am);
    const whatsapp = normalizePhone(req.body.whatsapp);
    const password = String(req.body.password || '');
    const captchaToken = String(req.body.captcha_token || '');
    const captchaAnswer = String(req.body.captcha_answer || '').trim();

    const fail = (msg) => {
      const c = makeCaptcha();
      return res.render('register', { error: msg, title: 'ثبت‌نام', ...c });
    };

    if (!first_name || !last_name || !phone_am || password.length < 6) {
      return fail('نام، شماره تماس و رمز (حداقل ۶ کاراکتر) الزامی است');
    }
    if (!whatsapp || whatsapp.length < 8) {
      return fail('شماره واتساپ اجباری است');
    }
    if (!phone_am.includes('374') && !phone_am.startsWith('0')) {
      return fail('لطفاً شماره تماس ارمنی معتبر وارد کنید (مثلاً +374XXXXXXXX)');
    }

    const cap = db.prepare("SELECT * FROM otp_codes WHERE phone = ? AND purpose = 'captcha' AND used = 0 ORDER BY id DESC LIMIT 1").get(captchaToken);
    if (!cap || cap.code !== captchaAnswer) {
      return fail('کد امنیتی (کپچا) اشتباه است');
    }
    if (Date.parse(cap.expires_at) < Date.now()) {
      return fail('کپچا منقضی شده. دوباره تلاش کنید');
    }
    db.prepare('UPDATE otp_codes SET used = 1 WHERE id = ?').run(cap.id);

    const user_code = 'U' + Date.now().toString().slice(-8) + Math.floor(Math.random() * 90 + 10);
    const password_hash = await bcrypt.hash(password, 12);
    db.prepare(`
      INSERT INTO users (user_code, first_name, last_name, phone_am, whatsapp, passport_path, password_hash)
      VALUES (?, ?, ?, ?, ?, NULL, ?)
    `).run(user_code, first_name, last_name, phone_am, whatsapp, password_hash);

    res.render('register-success', { user_code, title: 'ثبت‌نام موفق' });
  } catch (e) {
    console.error(e);
    const c = makeCaptcha();
    res.render('register', { error: 'خطا در ثبت‌نام. این شماره قبلاً ثبت شده یا مشکل سرور.', title: 'ثبت‌نام', ...c });
  }
});



app.get('/login', (req, res) => {
  res.render('login', { error: null, title: 'ورود' });
});

app.post('/login', loginLimiter, async (req, res) => {
  const phone_am = normalizePhone(req.body.phone_am);
  const password = String(req.body.password || '');
  // try exact match, then with/without +
  let user = db.prepare('SELECT * FROM users WHERE phone_am = ?').get(phone_am);
  if (!user && phone_am.startsWith('+')) {
    user = db.prepare('SELECT * FROM users WHERE phone_am = ?').get(phone_am.slice(1));
  }
  if (!user && !phone_am.startsWith('+')) {
    user = db.prepare('SELECT * FROM users WHERE phone_am = ?').get('+' + phone_am);
  }
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.render('login', { error: 'شماره ارمنی یا رمز اشتباه است', title: 'ورود' });
  }
  const token = jwt.sign({ id: user.id, role: 'user' }, process.env.JWT_SECRET || 'change-me', { expiresIn: '7d' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
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
  uploadPassport.single('passport')(req, res, (err) => {
    if (err) {
      const rates = getAllRates();
      const banks = db.prepare('SELECT * FROM payment_info WHERE is_active = 1 ORDER BY sort_order').all();
      return res.render('user/new-order', { user: req.user, rates, banks, error: err.message || 'خطا در آپلود', title: 'سفارش جدید' });
    }
    const { pair, amount_from, bank_name } = req.body;
    const rateRow = getRate(pair);
    if (!rateRow) return res.redirect('/new-order');

    const [from_currency, to_currency] = pair.split('_');
    const amount = parseFloat(amount_from);
    const rates = getAllRates();
    const banks = db.prepare('SELECT * FROM payment_info WHERE is_active = 1 ORDER BY sort_order').all();
    if (!amount || amount <= 0) {
      return res.render('user/new-order', { user: req.user, rates, banks, error: 'مبلغ نامعتبر', title: 'سفارش جدید' });
    }

    // Passport required on first transaction if not already on profile
    if (!req.user.passport_path && !req.file) {
      return res.render('user/new-order', {
        user: req.user, rates, banks,
        error: 'برای ثبت سفارش، آپلود پاسپورت یا کارت اقامت ارمنستان الزامی است',
        title: 'سفارش جدید'
      });
    }
    if (req.file) {
      const passport_path = '/uploads/passports/' + req.file.filename;
      db.prepare('UPDATE users SET passport_path = ? WHERE id = ?').run(passport_path, req.user.id);
      req.user.passport_path = passport_path;
    }

    const rate_used = rateRow.sell_rate;
    const amount_to = amount * rate_used;
    const transaction_code = 'TX' + Date.now().toString().slice(-10);

    db.prepare(`
      INSERT INTO transactions (transaction_code, user_id, pair, from_currency, to_currency, amount_from, amount_to, rate_used, bank_name, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment')
    `).run(transaction_code, req.user.id, pair, from_currency, to_currency, amount, amount_to, rate_used, bank_name);

    res.redirect('/order/' + transaction_code);
  });
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

  const declarant_name = String(req.body.declarant_name || '').trim();
  const national_id = String(req.body.national_id || '').trim();
  const deposit_date = String(req.body.deposit_date || '').trim();
  const from_account_name = String(req.body.from_account_name || '').trim();
  const from_bank = String(req.body.from_bank || '').trim();
  const to_card_or_sheba = String(req.body.to_card_or_sheba || '').trim();
  const to_account_name = String(req.body.to_account_name || '').trim();
  const to_bank = String(req.body.to_bank || '').trim();
  const tracking_number = String(req.body.tracking_number || '').trim();
  const receive_date = String(req.body.receive_date || '').trim();
  const depositor_name_date = String(req.body.depositor_name_date || '').trim() || declarant_name;

  const bank = db.prepare('SELECT * FROM payment_info WHERE bank_name = ?').get(tx.bank_name);
  if (!declarant_name || !national_id || !deposit_date || !from_account_name || !from_bank ||
      !to_card_or_sheba || !to_account_name || !to_bank) {
    return res.render('user/declaration', {
      user: req.user, tx, bank,
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
      from_bank = ?,
      to_card_or_sheba = ?,
      to_account_name = ?,
      to_bank = ?,
      declarant_name = ?,
      declaration_filled = 1,
      status = 'pending_review',
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    national_id, deposit_date, from_account_name,
    tracking_number || null, receive_date || null, depositor_name_date,
    from_bank, to_card_or_sheba, to_account_name, to_bank, declarant_name,
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
    users = db.prepare('SELECT * FROM users ORDER BY COALESCE(last_seen, created_at) DESC LIMIT 100').all();
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
  const { status, pickup_time, admin_note, office_address, office_date, office_time, receiver_name, receive_sign_date, tracking_bank } = req.body;
  const tx = db.prepare('SELECT * FROM transactions WHERE transaction_code = ?').get(req.params.code);
  if (!tx) return res.redirect('/admin/transactions');

  db.prepare(`
    UPDATE transactions SET
      status = ?,
      pickup_time = ?,
      admin_note = ?,
      office_address = ?,
      office_date = ?,
      office_time = ?,
      receiver_name = ?,
      receive_sign_date = ?,
      tracking_number = COALESCE(?, tracking_number),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    status || tx.status,
    pickup_time || tx.pickup_time || null,
    admin_note || tx.admin_note || null,
    office_address || tx.office_address || null,
    office_date || tx.office_date || null,
    office_time || tx.office_time || null,
    receiver_name || tx.receiver_name || null,
    receive_sign_date || tx.receive_sign_date || null,
    tracking_bank || null,
    tx.id
  );

  res.redirect('/admin/transaction/' + req.params.code);
});



app.get('/admin/transaction/:code/print-declaration', authAdmin, (req, res) => {
  const tx = db.prepare(`
    SELECT t.*, u.first_name, u.last_name FROM transactions t
    JOIN users u ON t.user_id = u.id WHERE t.transaction_code = ?
  `).get(req.params.code);
  if (!tx) return res.status(404).send('یافت نشد');
  const bank = db.prepare('SELECT * FROM payment_info WHERE bank_name = ?').get(tx.bank_name);
  res.render('user/declaration-receipt', { user: null, tx, bank, title: 'چاپ اعلامیه' });
});

app.get('/admin/rates', authAdmin, (req, res) => {
  try { ensureActivePairs(); } catch (e) {}
  const rates = getAllRates();
  res.render('admin/rates', { admin: req.admin, rates, ok: req.query.ok, title: 'نرخ‌ها' });
});

// If someone opens update URL in browser (GET) — don't crash
app.get('/admin/rates/update', authAdmin, (req, res) => {
  res.redirect('/admin/rates');
});

app.post('/admin/rates/update', authAdmin, (req, res) => {
  try {
    const pair = String(req.body.pair || '').trim();
    const buy = parseFloat(req.body.buy_rate);
    const sell = parseFloat(req.body.sell_rate);
    if (pair && Number.isFinite(buy) && Number.isFinite(sell)) {
      setManualRate(pair, buy, sell);
    }
  } catch (e) {
    console.error('manual rate', e.message);
  }
  res.redirect('/admin/rates?ok=1');
});

app.post('/admin/rates/refresh', authAdmin, async (req, res) => {
  try {
    await updateRatesFromApi();
    ensureActivePairs();
  } catch (e) {
    console.error('refresh rates', e.message);
  }
  res.redirect('/admin/rates?ok=1');
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

// ========== HEARTBEAT / CONTACT / TOOLS ==========
app.post('/api/heartbeat', optionalUser, (req, res) => {
  if (req.user) {
    try { db.prepare("UPDATE users SET last_seen = datetime('now') WHERE id = ?").run(req.user.id); } catch (e) {}
  }
  res.json({ ok: true });
});

app.get('/contact', (req, res) => {
  res.render('contact', { title: 'ارتباط با ما', settings: getSettings() });
});

app.get('/tools/date', (req, res) => {
  res.render('tools-date', { title: 'تبدیل تاریخ' });
});

app.get('/track', (req, res) => {
  res.render('track', { title: 'پیگیری سفارش', result: null, code: '' });
});

app.post('/track', (req, res) => {
  const code = String(req.body.code || '').trim();
  let result = null;
  if (code) {
    result = db.prepare('SELECT transaction_code as code, status, pickup_time, office_address, office_date, office_time, pair, amount_from, amount_to, from_currency, to_currency FROM transactions WHERE transaction_code = ?').get(code);
    if (!result) {
      result = db.prepare('SELECT order_code as code, status, amount_amd, amount_toman, delivery_date, delivery_time FROM cash_in_orders WHERE order_code = ?').get(code);
      if (result) result.kind = 'cash_in';
    } else result.kind = 'tx';
  }
  res.render('track', { title: 'پیگیری سفارش', result, code });
});

app.get('/admin/settings', authAdmin, (req, res) => {
  res.render('admin/settings', { admin: req.admin, settings: getSettings(), title: 'تنظیمات دفتر' });
});

app.post('/admin/settings', authAdmin, (req, res) => {
  const keys = ['phone','whatsapp','address','map_url','office_note'];
  const upsert = db.prepare('INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  keys.forEach(k => upsert.run(k, String(req.body[k] || '').trim()));
  res.redirect('/admin/settings?ok=1');
});


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


app.post('/admin/user/:code/delete', authAdmin, (req, res) => {
  try {
    const user = db.prepare('SELECT id FROM users WHERE user_code = ?').get(req.params.code);
    if (user) {
      db.prepare('DELETE FROM favorites WHERE user_id = ?').run(user.id);
      try { db.prepare('DELETE FROM cash_in_orders WHERE user_id = ?').run(user.id); } catch (e) {}
      // keep transactions history but null user link if needed - or delete
      try { db.prepare('DELETE FROM transactions WHERE user_id = ?').run(user.id); } catch (e) {}
      db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    }
  } catch (e) { console.error('delete user', e.message); }
  res.redirect('/admin/users');
});

// Seed admins on start if needed
function seedAdmins() {
  try {
    const count = db.prepare('SELECT COUNT(*) as c FROM admins').get().c;
    if (count === 0) {
      // Login uses env credentials; DB table may stay empty
    }
  } catch (e) {
    console.log('seedAdmins skip:', e.message);
  }
}

// Start
async function start() {
  // Always create/ensure all base tables
  try {
    require('./utils/init-db');
  } catch (e) {
    console.log('init-db:', e.message);
  }
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS otp_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      code TEXT NOT NULL,
      purpose TEXT DEFAULT 'register',
      expires_at TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
  } catch (e) { console.log('otp table:', e.message); }

  // Extra tables / columns (safe)
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
  } catch (e) {
    console.log('cash_in migrate:', e.message);
  }

  try {
    const cols = db.prepare('PRAGMA table_info(transactions)').all().map(c => c.name);
    const addCol = (name, type) => {
      if (!cols.includes(name)) db.exec(`ALTER TABLE transactions ADD COLUMN ${name} ${type}`);
    };
    addCol('national_id', 'TEXT');
    addCol('deposit_date', 'TEXT');
    addCol('from_account_name', 'TEXT');
    addCol('tracking_number', 'TEXT');
    addCol('receive_date', 'TEXT');
    addCol('depositor_name_date', 'TEXT');
    addCol('declaration_filled', 'INTEGER DEFAULT 0');
    addCol('from_bank', 'TEXT');
    addCol('to_card_or_sheba', 'TEXT');
    addCol('to_account_name', 'TEXT');
    addCol('to_bank', 'TEXT');
    addCol('declarant_name', 'TEXT');
    addCol('office_address', 'TEXT');
    addCol('office_date', 'TEXT');
    addCol('office_time', 'TEXT');
    addCol('receiver_name', 'TEXT');
    addCol('receive_sign_date', 'TEXT');
    addCol('tracking_number', 'TEXT');
  } catch (e) {
    console.log('transactions migrate:', e.message);
  }

  seedAdmins();
  try { ensureActivePairs(); } catch (e) { console.log('ensure pairs', e.message); }
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )`);
    db.exec(`ALTER TABLE users ADD COLUMN last_seen TEXT`);
  } catch (e) {}
  try {
    const n = db.prepare('SELECT COUNT(*) as c FROM site_settings').get().c;
    if (n === 0) {
      const ins = db.prepare('INSERT OR IGNORE INTO site_settings (key,value) VALUES (?,?)');
      [['phone','+374XXXXXXXX'],['whatsapp','+374XXXXXXXX'],['address','Yerevan, Armenia'],['map_url','https://maps.google.com'],['office_note','']].forEach(x=>ins.run(x[0],x[1]));
    }
  } catch (e) {}
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
