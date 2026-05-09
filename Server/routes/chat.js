const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../database');
const JWT_SECRET = 'yahoo-messenger-secret-2024';

const auth = (req, res, next) => {
  try { req.user = jwt.verify(req.cookies.token, JWT_SECRET); next(); } catch (e) { res.status(401).send(); }
};

router.get('/contacts', auth, (req, res) => {
  const data = db.getRawData();
  const contacts = data.contacts
    .filter(c => c.user_id === req.user.id && c.status === 'accepted')
    .map(c => {
      const u = data.users.find(x => x.id === c.contact_id);
      return u ? { ...u } : null;
    }).filter(Boolean);
  res.json({ contacts });
});

router.get('/requests', auth, (req, res) => {
  const data = db.getRawData();
  const reqs = data.contacts
    .filter(c => c.user_id === req.user.id && c.status === 'pending_received')
    .map(c => {
      const u = data.users.find(x => x.id === c.contact_id);
      return u ? { id: u.id, username: u.username, display_name: u.display_name, avatar: u.avatar } : null;
    }).filter(Boolean);
  res.json({ requests: reqs });
});

router.post('/contacts/add', auth, (req, res) => {
  const data = db.getRawData();
  const targetName = (req.body.username || '').toLowerCase();
  const target = data.users.find(u => (u.username || '').toLowerCase() === targetName);

  if (!target || target.id === req.user.id) return res.status(400).json({ error: 'User invalid' });
  if (data.contacts.find(c => c.user_id === req.user.id && c.contact_id === target.id)) return res.status(400).json({ error: 'Exista deja' });

  data.contacts.push({ user_id: req.user.id, contact_id: target.id, status: 'pending_sent' });
  data.contacts.push({ user_id: target.id, contact_id: req.user.id, status: 'pending_received' });
  db.save();
  res.json({ success: true });
});

router.post('/contacts/accept', auth, (req, res) => {
  const data = db.getRawData();
  const contactId = req.body.contactId;
  data.contacts.forEach(c => {
    if ((c.user_id === req.user.id && c.contact_id === contactId) || (c.user_id === contactId && c.contact_id === req.user.id)) c.status = 'accepted';
  });
  db.save();
  res.json({ success: true });
});

router.get('/messages/:userId', auth, (req, res) => {
  const data = db.getRawData();
  const uId = parseInt(req.params.userId);
  const msgs = data.messages.filter(m => (m.sender_id === req.user.id && m.receiver_id === uId) || (m.sender_id === uId && m.receiver_id === req.user.id));
  res.json({ messages: msgs });
});

module.exports = router;