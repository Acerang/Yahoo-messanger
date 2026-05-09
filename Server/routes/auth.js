const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database');

const JWT_SECRET = process.env.JWT_SECRET || 'yahoo-messenger-secret-2024';

// Register
router.post('/register', (req, res) => {
  const { username, email, password, displayName } = req.body;

  if (!username || !email || !password || !displayName) {
    return res.status(400).json({ error: 'Toate câmpurile sunt obligatorii' });
  }

  if (username.length < 3) {
    return res.status(400).json({ error: 'Username-ul trebuie să aibă minim 3 caractere' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Parola trebuie să aibă minim 6 caractere' });
  }

  try {
    const hashedPassword = bcrypt.hashSync(password, 10);

    const stmt = db.prepare(`
      INSERT INTO users (username, email, password, display_name)
      VALUES (?, ?, ?, ?)
    `);

    const result = stmt.run(username.toLowerCase(), email.toLowerCase(), hashedPassword, displayName);

    const token = jwt.sign(
      { id: result.lastInsertRowid, username: username.toLowerCase() },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.json({
      success: true,
      user: {
        id: result.lastInsertRowid,
        username: username.toLowerCase(),
        displayName,
        email: email.toLowerCase(),
        avatar: 'default',
        status: 'online',
        statusMessage: 'Hello!'
      }
    });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      if (err.message.includes('username')) {
        return res.status(400).json({ error: 'Username-ul este deja folosit' });
      }
      if (err.message.includes('email')) {
        return res.status(400).json({ error: 'Email-ul este deja înregistrat' });
      }
    }
    console.error('Register error:', err);
    res.status(500).json({ error: 'Eroare server' });
  }
});

// Login
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username și parola sunt obligatorii' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?')
      .get(username.toLowerCase(), username.toLowerCase());

    if (!user) {
      return res.status(401).json({ error: 'Username sau parolă incorectă' });
    }

    const validPassword = bcrypt.compareSync(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Username sau parolă incorectă' });
    }

    // Update last seen and status
    db.prepare('UPDATE users SET last_seen = CURRENT_TIMESTAMP, status = ? WHERE id = ?')
      .run('online', user.id);

    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        email: user.email,
        avatar: user.avatar,
        status: user.status,
        statusMessage: user.status_message
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Eroare server' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  const token = req.cookies.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      db.prepare('UPDATE users SET status = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?')
        .run('offline', decoded.id);
    } catch (e) {}
  }
  res.clearCookie('token');
  res.json({ success: true });
});

// Verify token middleware
router.get('/me', (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Neautentificat' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, username, display_name, email, avatar, status, status_message FROM users WHERE id = ?')
      .get(decoded.id);

    if (!user) return res.status(401).json({ error: 'User inexistent' });

    res.json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        email: user.email,
        avatar: user.avatar,
        status: user.status,
        statusMessage: user.status_message
      }
    });
  } catch (err) {
    res.status(401).json({ error: 'Token invalid' });
  }
});

module.exports = router;
module.exports.JWT_SECRET = JWT_SECRET;
