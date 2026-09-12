const jwt = require('jsonwebtoken');
const db = require('../utils/db');

function authUser(req, res, next) {
  const token = req.cookies.token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) {
    return res.redirect('/login');
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'user') throw new Error('not user');
    const user = db.prepare('SELECT id, user_code, first_name, last_name, phone_am FROM users WHERE id = ?').get(decoded.id);
    if (!user) throw new Error('user not found');
    req.user = user;
    next();
  } catch (e) {
    res.clearCookie('token');
    return res.redirect('/login');
  }
}

function authAdmin(req, res, next) {
  const token = req.cookies.admin_token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) {
    return res.redirect('/admin/login');
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'admin') throw new Error('not admin');
    req.admin = { id: decoded.id, username: decoded.username };
    next();
  } catch (e) {
    res.clearCookie('admin_token');
    return res.redirect('/admin/login');
  }
}

function optionalUser(req, res, next) {
  const token = req.cookies.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.role === 'user') {
        req.user = db.prepare('SELECT id, user_code, first_name, last_name FROM users WHERE id = ?').get(decoded.id);
      }
    } catch (e) {}
  }
  next();
}

module.exports = { authUser, authAdmin, optionalUser };
