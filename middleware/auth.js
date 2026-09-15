const jwt = require('jsonwebtoken');
const db = require('../utils/db');

const JWT_SECRET = process.env.JWT_SECRET || 'sarrafi-demo-secret-key-change-in-production-32chars';

function authUser(req, res, next) {
  try {
    const token = req.cookies?.token || (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.redirect('/login');
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
    if (!user) return res.redirect('/login');
    req.user = user;
    next();
  } catch (e) {
    return res.redirect('/login');
  }
}

function optionalUser(req, res, next) {
  try {
    const token = req.cookies?.token || (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) {
      req.user = null;
      return next();
    }
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
    req.user = user || null;
    next();
  } catch (e) {
    req.user = null;
    next();
  }
}

function authAdmin(req, res, next) {
  try {
    const token = req.cookies?.admin_token || (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.redirect('/admin/login');
    const payload = jwt.verify(token, JWT_SECRET);
    const u1 = process.env.ADMIN1_USERNAME || 'admin1';
    const u2 = process.env.ADMIN2_USERNAME || 'admin2';
    if (payload.role !== 'admin' && payload.type !== 'admin') {
      return res.redirect('/admin/login');
    }
    if (payload.username && payload.username !== u1 && payload.username !== u2) {
      return res.redirect('/admin/login');
    }
    req.admin = { username: payload.username || payload.id || 'admin' };
    next();
  } catch (e) {
    return res.redirect('/admin/login');
  }
}

module.exports = {
  authUser,
  authAdmin,
  optionalUser
};
