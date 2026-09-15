const jwt = require('jsonwebtoken');
const db = require('../utils/db');

const JWT_SECRET = process.env.JWT_SECRET || 'sarrafi-demo-secret-key-change-in-production-32chars';

function signUserToken(user) {
  return jwt.sign(
    { id: user.id, user_code: user.user_code, type: 'user' },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function signAdminToken(username) {
  return jwt.sign(
    { username, type: 'admin' },
    JWT_SECRET,
    { expiresIn: '1d' }
  );
}

function requireUser(req, res, next) {
  try {
    const token = req.cookies?.token || (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) {
      return res.redirect('/login');
    }
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.type !== 'user') {
      return res.redirect('/login');
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
    if (!user) {
      return res.redirect('/login');
    }
    req.user = user;
    next();
  } catch (e) {
    return res.redirect('/login');
  }
}

function requireAdmin(req, res, next) {
  try {
    const token = req.cookies?.admin_token || (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) {
      return res.redirect('/admin/login');
    }
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.type !== 'admin') {
      return res.redirect('/admin/login');
    }
    const u1 = process.env.ADMIN1_USERNAME || 'admin1';
    const u2 = process.env.ADMIN2_USERNAME || 'admin2';
    if (payload.username !== u1 && payload.username !== u2) {
      return res.redirect('/admin/login');
    }
    req.admin = { username: payload.username };
    next();
  } catch (e) {
    return res.redirect('/admin/login');
  }
}

module.exports = {
  signUserToken,
  signAdminToken,
  requireUser,
  requireAdmin,
  JWT_SECRET
};
