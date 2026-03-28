const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Database
const adapter = new FileSync(path.join(__dirname, 'db.json'));
const db = low(adapter);
db.defaults({ users: [], messages: [] }).write();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Track online users: socketId -> username
const onlineUsers = new Map();
// Last seen: username -> timestamp
const lastSeen = {};

// REST API
app.post('/api/register', (req, res) => {
  const { username } = req.body;
  if (!username || username.trim().length < 1) {
    return res.status(400).json({ error: 'Имя не может быть пустым' });
  }
  const name = username.trim();
  const existing = db.get('users').find({ username: name }).value();
  if (existing) {
    return res.json({ user: existing });
  }
  const user = {
    id: Date.now().toString(),
    username: name,
    createdAt: new Date().toISOString()
  };
  db.get('users').push(user).write();
  return res.json({ user });
});

app.get('/api/users', (req, res) => {
  const { me } = req.query;
  const users = db.get('users').value();
  const online = [...onlineUsers.values()];
  const allMessages = db.get('messages').value();

  const result = users
    .filter(u => u.username !== me)
    .map(u => {
      // Find last message between me and this user
      const convMsgs = allMessages.filter(m =>
        (m.from === me && m.to === u.username) ||
        (m.from === u.username && m.to === me)
      );
      const lastMsg = convMsgs.length > 0
        ? convMsgs.reduce((a, b) => a.timestamp > b.timestamp ? a : b)
        : null;
      // Count unread
      const unread = convMsgs.filter(m => m.from === u.username && !m.read).length;

      return {
        ...u,
        online: online.includes(u.username),
        lastSeen: lastSeen[u.username] || null,
        lastMessage: lastMsg ? { text: lastMsg.text, timestamp: lastMsg.timestamp, from: lastMsg.from } : null,
        unread
      };
    })
    .sort((a, b) => {
      const ta = a.lastMessage ? a.lastMessage.timestamp : 0;
      const tb = b.lastMessage ? b.lastMessage.timestamp : 0;
      return tb - ta;
    });

  res.json(result);
});

app.get('/api/messages', (req, res) => {
  const { user1, user2 } = req.query;
  if (!user1 || !user2) return res.status(400).json({ error: 'Missing params' });
  const messages = db.get('messages')
    .filter(m =>
      (m.from === user1 && m.to === user2) ||
      (m.from === user2 && m.to === user1)
    )
    .sortBy('timestamp')
    .value();

  // Mark as read
  db.get('messages')
    .filter(m => m.from === user2 && m.to === user1 && !m.read)
    .each(m => { m.read = true; })
    .write();

  res.json(messages);
});

// Socket.io
io.on('connection', (socket) => {
  socket.on('go-online', (username) => {
    onlineUsers.set(socket.id, username);
    io.emit('users-update', getOnlineList());
  });

  socket.on('send-message', (data) => {
    const msg = {
      id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
      from: data.from,
      to: data.to,
      text: data.text,
      timestamp: Date.now(),
      read: false
    };
    db.get('messages').push(msg).write();

    for (const [sid, uname] of onlineUsers) {
      if (uname === data.to || uname === data.from) {
        io.to(sid).emit('new-message', msg);
      }
    }
  });

  socket.on('typing', (data) => {
    for (const [sid, uname] of onlineUsers) {
      if (uname === data.to) {
        io.to(sid).emit('user-typing', { from: data.from });
      }
    }
  });

  socket.on('mark-read', (data) => {
    db.get('messages')
      .filter(m => m.from === data.from && m.to === data.me && !m.read)
      .each(m => { m.read = true; })
      .write();
  });

  socket.on('disconnect', () => {
    const username = onlineUsers.get(socket.id);
    if (username) lastSeen[username] = Date.now();
    onlineUsers.delete(socket.id);
    io.emit('users-update', getOnlineList());
  });
});

function getOnlineList() {
  return [...new Set(onlineUsers.values())];
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Tisc running on http://localhost:${PORT}`);
});
