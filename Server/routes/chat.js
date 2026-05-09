const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../database');
const { JWT_SECRET } = require('./auth');

// Auth middleware
function authMiddleware(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Neautentificat' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: 'Token invalid' });
  }
}

// Get contacts list
router.get('/contacts', authMiddleware, (req, res) => {
  const contacts = db.prepare(`
    SELECT 
      u.id, u.username, u.display_name, u.avatar, u.status, u.status_message, u.last_seen,
      c.nickname, c.group_name, c.status as contact_status
    FROM contacts c
    JOIN users u ON u.id = c.contact_id
    WHERE c.user_id = ? AND c.status = 'accepted'
    ORDER BY u.status DESC, u.display_name ASC
  `).all(req.user.id);

  res.json({ contacts });
});

// Add contact
router.post('/contacts/add', authMiddleware, (req, res) => {
  const { username } = req.body;

  const contact = db.prepare('SELECT id, username, display_name, avatar, status FROM users WHERE username = ?')
    .get(username.toLowerCase());

  if (!contact) return res.status(404).json({ error: 'Userul nu a fost găsit' });
  if (contact.id === req.user.id) return res.status(400).json({ error: 'Nu te poți adăuga pe tine însuți' });

  try {
    // Add both directions
    db.prepare(`INSERT OR IGNORE INTO contacts (user_id, contact_id, status) VALUES (?, ?, 'accepted')`).run(req.user.id, contact.id);
    db.prepare(`INSERT OR IGNORE INTO contacts (user_id, contact_id, status) VALUES (?, ?, 'accepted')`).run(contact.id, req.user.id);

    res.json({ success: true, contact });
  } catch (err) {
    res.status(500).json({ error: 'Eroare la adăugare' });
  }
});

// Remove contact
router.delete('/contacts/:contactId', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM contacts WHERE user_id = ? AND contact_id = ?')
    .run(req.user.id, req.params.contactId);
  res.json({ success: true });
});

// Get conversation with a user
router.get('/messages/:userId', authMiddleware, (req, res) => {
  const { userId } = req.params;
  const { before, limit = 50 } = req.query;

  let query = `
    SELECT m.*, 
      s.display_name as sender_name, s.avatar as sender_avatar,
      r.display_name as receiver_name
    FROM messages m
    JOIN users s ON s.id = m.sender_id
    JOIN users r ON r.id = m.receiver_id
    WHERE (m.sender_id = ? AND m.receiver_id = ?)
       OR (m.sender_id = ? AND m.receiver_id = ?)
  `;
  const params = [req.user.id, userId, userId, req.user.id];

  if (before) {
    query += ' AND m.id < ?';
    params.push(before);
  }

  query += ' ORDER BY m.created_at DESC LIMIT ?';
  params.push(parseInt(limit));

  const messages = db.prepare(query).all(...params).reverse();

  // Mark messages as read
  db.prepare(`
    UPDATE messages SET read_at = CURRENT_TIMESTAMP 
    WHERE sender_id = ? AND receiver_id = ? AND read_at IS NULL
  `).run(userId, req.user.id);

  res.json({ messages });
});

// Get unread counts
router.get('/unread', authMiddleware, (req, res) => {
  const counts = db.prepare(`
    SELECT sender_id, COUNT(*) as count
    FROM messages
    WHERE receiver_id = ? AND read_at IS NULL
    GROUP BY sender_id
  `).all(req.user.id);

  res.json({ counts });
});

// Get chat rooms
router.get('/rooms', authMiddleware, (req, res) => {
  const rooms = db.prepare(`
    SELECT cr.*, 
      COUNT(DISTINCT rm.user_id) as member_count
    FROM chat_rooms cr
    LEFT JOIN room_members rm ON rm.room_id = cr.id
    GROUP BY cr.id
    ORDER BY cr.name ASC
  `).all();

  res.json({ rooms });
});

// Get room messages
router.get('/rooms/:roomId/messages', authMiddleware, (req, res) => {
  const messages = db.prepare(`
    SELECT rm.*, u.display_name, u.avatar, u.username
    FROM room_messages rm
    JOIN users u ON u.id = rm.user_id
    WHERE rm.room_id = ?
    ORDER BY rm.created_at DESC LIMIT 100
  `).all(req.params.roomId).reverse();

  res.json({ messages });
});

// Search users
router.get('/search', authMiddleware, (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json({ users: [] });

  const users = db.prepare(`
    SELECT id, username, display_name, avatar, status
    FROM users
    WHERE (username LIKE ? OR display_name LIKE ?) AND id != ?
    LIMIT 10
  `).all(`%${q}%`, `%${q}%`, req.user.id);

  res.json({ users });
});

// Update status
router.put('/status', authMiddleware, (req, res) => {
  const { status, statusMessage } = req.body;
  const validStatuses = ['online', 'away', 'busy', 'offline'];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Status invalid' });
  }

  db.prepare('UPDATE users SET status = ?, status_message = ? WHERE id = ?')
    .run(status, statusMessage || '', req.user.id);

  res.json({ success: true });
});

// Update profile
router.put('/profile', authMiddleware, (req, res) => {
  const { displayName, statusMessage, avatar } = req.body;

  db.prepare('UPDATE users SET display_name = ?, status_message = ?, avatar = ? WHERE id = ?')
    .run(displayName, statusMessage, avatar, req.user.id);

  const user = db.prepare('SELECT id, username, display_name, email, avatar, status, status_message FROM users WHERE id = ?')
    .get(req.user.id);

  res.json({ success: true, user });
});

module.exports = router;
module.exports.authMiddleware = authMiddleware;
