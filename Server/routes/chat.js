const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../database');
const JWT_SECRET = 'yahoo-messenger-secret-2024';

const auth = (req, res, next) => {
  try { req.user = jwt.verify(req.cookies.token, JWT_SECRET); next(); }
  catch (e) { res.status(401).send(); }
};

router.get('/contacts', auth, (req, res) => {
  const data = db.getRawData();
  const myId = req.user.id;
  const contacts = data.contacts
    .filter(c => c.user_id === myId && c.status === 'accepted')
    .map(c => {
      const u = data.users.find(x => x.id === c.contact_id);
      return u ? {
        id: u.id,
        username: u.username,
        display_name: u.display_name,
        avatar: u.avatar,
        status: u.status,
        status_message: u.status_message
      } : null;
    }).filter(Boolean);
  res.json({ contacts });
});

router.get('/requests', auth, (req, res) => {
  const data = db.getRawData();
  const myId = req.user.id;
  // Cereri in care EU sunt destinatarul (contact_id = eu) si status = pending
  const reqs = data.contacts
    .filter(c => c.contact_id === myId && c.status === 'pending')
    .map(c => {
      const u = data.users.find(x => x.id === c.user_id);
      return u ? {
        id: u.id,
        username: u.username,
        display_name: u.display_name,
        avatar: u.avatar
      } : null;
    }).filter(Boolean);
  res.json({ requests: reqs });
});

router.post('/contacts/add', auth, (req, res) => {
  const data = db.getRawData();
  const io = req.app.get('io');
  const myId = req.user.id;
  const targetName = (req.body.username || '').toLowerCase();
  const target = data.users.find(u => (u.username || '').toLowerCase() === targetName);

  if (!target) return res.status(400).json({ error: 'Utilizatorul nu exista' });
  if (target.id === myId) return res.status(400).json({ error: 'Nu poti adauga propria persoana' });

  // Verifica daca exista deja orice relatie intre cei doi
  const existing = data.contacts.find(c =>
    (c.user_id === myId && c.contact_id === target.id) ||
    (c.user_id === target.id && c.contact_id === myId)
  );
  if (existing) return res.status(400).json({ error: 'Cerere sau contact exista deja' });

  // O singura intrare: sender -> receiver cu status pending
  data.contacts.push({ user_id: myId, contact_id: target.id, status: 'pending' });
  db.save();

  // Notifica destinatarul in timp real
  const sender = data.users.find(u => u.id === myId);
  io.to(`user_${target.id}`).emit('friend_request', {
    id: sender.id,
    username: sender.username,
    display_name: sender.display_name,
    avatar: sender.avatar
  });

  res.json({ success: true });
});

router.post('/contacts/accept', auth, (req, res) => {
  const data = db.getRawData();
  const io = req.app.get('io');
  const myId = req.user.id;
  const senderId = parseInt(req.body.contactId);

  // Gaseste cererea originala: sender -> eu, pending
  const pendingEntry = data.contacts.find(c =>
    c.user_id === senderId && c.contact_id === myId && c.status === 'pending'
  );
  if (!pendingEntry) return res.status(400).json({ error: 'Cerere negasita' });

  // Accepta cererea originala
  pendingEntry.status = 'accepted';

  // Adauga relatia inversa: eu -> sender, accepted
  // (verificam sa nu existe deja)
  const alreadyReverse = data.contacts.find(c =>
    c.user_id === myId && c.contact_id === senderId
  );
  if (!alreadyReverse) {
    data.contacts.push({ user_id: myId, contact_id: senderId, status: 'accepted' });
  } else {
    alreadyReverse.status = 'accepted';
  }

  db.save();

  // Notifica ambii useri
  io.to(`user_${senderId}`).emit('friend_accepted', { by: myId });
  io.to(`user_${myId}`).emit('friend_accepted', { by: senderId });

  res.json({ success: true });
});

router.post('/contacts/reject', auth, (req, res) => {
  const data = db.getRawData();
  const myId = req.user.id;
  const senderId = parseInt(req.body.contactId);
  const idx = data.contacts.findIndex(c =>
    c.user_id === senderId && c.contact_id === myId && c.status === 'pending'
  );
  if (idx !== -1) { data.contacts.splice(idx, 1); db.save(); }
  res.json({ success: true });
});

router.get('/search', auth, (req, res) => {
  const data = db.getRawData();
  const myId = req.user.id;
  const q = (req.query.q || '').toLowerCase();
  if (q.length < 2) return res.json({ users: [] });
  const users = data.users
    .filter(u => u.id !== myId && (
      (u.username || '').toLowerCase().includes(q) ||
      (u.display_name || '').toLowerCase().includes(q)
    ))
    .map(u => ({
      id: u.id,
      username: u.username,
      display_name: u.display_name,
      avatar: u.avatar,
      status: u.status
    }));
  res.json({ users });
});

router.get('/messages/:userId', auth, (req, res) => {
  const data = db.getRawData();
  const myId = req.user.id;
  const otherId = parseInt(req.params.userId);
  const msgs = data.messages.filter(m =>
    (m.sender_id === myId && m.receiver_id === otherId) ||
    (m.sender_id === otherId && m.receiver_id === myId)
  );
  res.json({ messages: msgs });
});

module.exports = router;