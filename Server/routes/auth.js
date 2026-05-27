const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database');
const JWT_SECRET = 'yahoo-messenger-secret-2024';

router.post('/register', (req, res) => {
  const { username, email, password, displayName } = req.body;
  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO users (username, email, password, display_name) VALUES (?, ?, ?, ?)').run(username.toLowerCase(), email.toLowerCase(), hash, displayName);
    const token = jwt.sign({ id: result.lastInsertRowid, username }, JWT_SECRET);
    res.cookie('token', token, { httpOnly: true }).json({ success: true });
  } catch (e) { res.status(400).json({ error: 'Eroare la inregistrare' }); }
});

router.post('/login', (req, res) => {
  const { username, password, remember } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username.toLowerCase(), username.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Date incorecte' });

<<<<<<< HEAD
  // Obțin IP-ul clientului
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  
  // Verific dacă utilizatorul e deja conectat de pe alt IP
  if (user.current_session_ip && user.current_session_ip !== clientIp) {
    return res.status(403).json({ error: 'User already logged in from another location' });
  }

  // Actualizez IP-ul sesiunii
  user.current_session_ip = clientIp;
  db.save();

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
  const opt = { httpOnly: true };
  if (remember) opt.maxAge = 7 * 24 * 60 * 60 * 1000;

=======
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
  const opt = { httpOnly: true };
  if (remember) opt.maxAge = 7 * 24 * 60 * 60 * 1000;

>>>>>>> 18b913a957e33bee26b4d6b87a56b22aa12e7ba7
  res.cookie('token', token, opt).json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      status: 'online'
    }
  });
});

router.get('/me', (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).send();
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.id);
    if (!user) return res.status(401).send();
    res.json({ user });
  } catch (e) { res.status(401).send(); }
});

router.post('/logout', (req, res) => res.clearCookie('token').json({ success: true }));

module.exports = router;