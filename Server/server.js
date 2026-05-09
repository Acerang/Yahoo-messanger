const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const dbModule = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const JWT_SECRET = process.env.JWT_SECRET || 'yahoo-messenger-secret-2024';
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

// Initialize database and start server
(async () => {
  await dbModule.init();
  const db = dbModule;

  // Routes
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/chat', require('./routes/chat'));

  // Serve main pages
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  });

  app.get('/chat', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/chat.html'));
  });

  // ─────────────── SOCKET.IO ───────────────
  const onlineUsers = new Map(); // userId -> { socketId, username, displayName, status }

  // Socket auth middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.headers.cookie?.match(/token=([^;]+)/)?.[1];

    if (!token) return next(new Error('Neautentificat'));

    try {
      socket.user = jwt.verify(token, JWT_SECRET);
      next();
    } catch (e) {
      next(new Error('Token invalid'));
    }
  });

  io.on('connection', (socket) => {
    const { id: userId, username } = socket.user;

    // Get user info from DB
    const userInfo = db.prepare('SELECT display_name, avatar, status FROM users WHERE id = ?').get(userId);
    if (!userInfo) return socket.disconnect();

    // Register user as online
    onlineUsers.set(userId, {
      socketId: socket.id,
      username,
      displayName: userInfo.display_name,
      avatar: userInfo.avatar,
      status: userInfo.status || 'online'
    });

    // Update DB status
    db.prepare('UPDATE users SET status = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?').run('online', userId);

    // Notify contacts that this user is online
    const contacts = db.prepare(`
      SELECT contact_id FROM contacts WHERE user_id = ? AND status = 'accepted'
    `).all(userId);

    contacts.forEach(({ contact_id }) => {
      const contactSocket = onlineUsers.get(contact_id);
      if (contactSocket) {
        io.to(contactSocket.socketId).emit('contact_status', {
          userId,
          status: 'online',
          displayName: userInfo.display_name
        });
      }
    });

    console.log(`✅ ${username} connected (${socket.id})`);

    // ── PRIVATE MESSAGES ──
    socket.on('private_message', ({ toUserId, content }) => {
      if (!content || !toUserId) return;

      const msg = db.prepare(`
        INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)
      `).run(userId, toUserId, content);

      const fullMsg = {
        id: msg.lastInsertRowid,
        sender_id: userId,
        receiver_id: toUserId,
        content,
        sender_name: userInfo.display_name,
        sender_avatar: userInfo.avatar,
        created_at: new Date().toISOString()
      };

      // Send to receiver if online
      const receiverSocket = onlineUsers.get(parseInt(toUserId));
      if (receiverSocket) {
        io.to(receiverSocket.socketId).emit('private_message', fullMsg);
      }

      // Echo back to sender
      socket.emit('message_sent', fullMsg);
    });

    // ── TYPING INDICATOR ──
    socket.on('typing_start', ({ toUserId }) => {
      const receiverSocket = onlineUsers.get(parseInt(toUserId));
      if (receiverSocket) {
        io.to(receiverSocket.socketId).emit('typing_start', { fromUserId: userId, fromName: userInfo.display_name });
      }
    });

    socket.on('typing_stop', ({ toUserId }) => {
      const receiverSocket = onlineUsers.get(parseInt(toUserId));
      if (receiverSocket) {
        io.to(receiverSocket.socketId).emit('typing_stop', { fromUserId: userId });
      }
    });

    // ── CHAT ROOMS ──
    socket.on('join_room', ({ roomId }) => {
      socket.join(`room_${roomId}`);
      db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES (?, ?)').run(roomId, userId);

      const memberCount = db.prepare('SELECT COUNT(*) as count FROM room_members WHERE room_id = ?').get(roomId).count;

      io.to(`room_${roomId}`).emit('room_user_joined', {
        roomId,
        userId,
        displayName: userInfo.display_name,
        memberCount
      });
    });

    socket.on('leave_room', ({ roomId }) => {
      socket.leave(`room_${roomId}`);
      db.prepare('DELETE FROM room_members WHERE room_id = ? AND user_id = ?').run(roomId, userId);

      io.to(`room_${roomId}`).emit('room_user_left', {
        roomId,
        userId,
        displayName: userInfo.display_name
      });
    });

    socket.on('room_message', ({ roomId, content }) => {
      if (!content || !roomId) return;

      const msg = db.prepare(`
        INSERT INTO room_messages (room_id, user_id, content) VALUES (?, ?, ?)
      `).run(roomId, userId, content);

      const fullMsg = {
        id: msg.lastInsertRowid,
        room_id: roomId,
        user_id: userId,
        display_name: userInfo.display_name,
        username,
        avatar: userInfo.avatar,
        content,
        created_at: new Date().toISOString()
      };

      io.to(`room_${roomId}`).emit('room_message', fullMsg);
    });

    // ── STATUS CHANGE ──
    socket.on('change_status', ({ status, statusMessage }) => {
      const validStatuses = ['online', 'away', 'busy', 'offline'];
      if (!validStatuses.includes(status)) return;

      onlineUsers.get(userId).status = status;
      db.prepare('UPDATE users SET status = ?, status_message = ? WHERE id = ?').run(status, statusMessage || '', userId);

      // Notify contacts
      contacts.forEach(({ contact_id }) => {
        const contactSocket = onlineUsers.get(contact_id);
        if (contactSocket) {
          io.to(contactSocket.socketId).emit('contact_status', { userId, status, statusMessage });
        }
      });
    });

    // ── DISCONNECT ──
    socket.on('disconnect', () => {
      onlineUsers.delete(userId);
      db.prepare('UPDATE users SET status = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?').run('offline', userId);

      contacts.forEach(({ contact_id }) => {
        const contactSocket = onlineUsers.get(contact_id);
        if (contactSocket) {
          io.to(contactSocket.socketId).emit('contact_status', { userId, status: 'offline' });
        }
      });

      console.log(`❌ ${username} disconnected`);
    });
  });

  server.listen(PORT, () => {
    console.log(`\n🚀 Yahoo! Messenger Server pornit pe http://localhost:${PORT}\n`);
  });
})();
