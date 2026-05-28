const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cookieParser = require('cookie-parser');
const path = require('path');
const jwt = require('jsonwebtoken');
const db = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const JWT_SECRET = 'yahoo-messenger-secret-2024';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../Public')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/chat', require('./routes/chat'));

app.set('io', io);

app.get('/chat', (req, res) => res.sendFile(path.join(__dirname, '../Public/chat.html')));

io.use((socket, next) => {
  const token = socket.handshake.headers.cookie?.match(/token=([^;]+)/)?.[1];
  if (!token) return next(new Error('Auth error'));
  try { socket.user = jwt.verify(token, JWT_SECRET); next(); } catch (e) { next(new Error('Auth error')); }
});

io.on('connection', (socket) => {
  const userId = socket.user.id;
  socket.join(`user_${userId}`);

  const data = db.getRawData();
  const user = data.users.find(u => u.id === userId);
  if (user) {
    user.status = 'online';
    db.save();
    io.emit('status_change', { userId, status: 'online' });
  }

  socket.on('private_message', ({ toUserId, content }) => {
    const msg = {
      id: Date.now(),
      sender_id: userId,
      receiver_id: toUserId,
      content,
      created_at: new Date().toISOString()
    };
    data.messages.push(msg);
    db.save();
    // Trimite DOAR catre destinatar, nu inapoi la sender
    io.to(`user_${toUserId}`).emit('private_message', msg);
    // Confirmare catre sender (separat, cu acelasi mesaj)
    socket.emit('message_sent', msg);
  });

  socket.on('change_status', (s) => {
    if (user) {
      user.status = s.status;
      if (s.statusMessage !== undefined) user.status_message = s.statusMessage;
      db.save();
      io.emit('status_change', { userId, status: user.status, statusMessage: user.status_message });
    }
  });

  socket.on('change_avatar', (s) => {
    if (user) {
      user.avatar = s.avatar;
      db.save();
      io.emit('avatar_change', { userId, avatar: s.avatar });
    }
  });

  socket.on('disconnect', () => {
    if (user) {
      user.status = 'offline';
      user.current_session_ip = null;
      db.save();
      io.emit('status_change', { userId, status: 'offline' });
    }
  });
});

// Asculta pe toate interfetele (0.0.0.0) ca sa fie accesibil din retea locala
server.listen(3000, '0.0.0.0', () => {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  let localIP = 'localhost';
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) { localIP = net.address; break; }
    }
  }
  console.log(`🚀 Server pornit!`);
  console.log(`   Local:   http://localhost:3000`);
  console.log(`   Retea:   http://${localIP}:3000`);
});