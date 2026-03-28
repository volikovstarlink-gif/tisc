const socket = io();
const api = (path) => path;

// ===== STATE =====
let me = null;
let chatWith = null;
let allUsers = [];
let typingTimer = null;

// ===== DOM =====
const $ = id => document.getElementById(id);
const loginScreen = $('login-screen');
const chatsScreen = $('chats-screen');
const chatScreen  = $('chat-screen');

// ===== AVATAR HELPERS =====
const AV_COLORS = ['av-red','av-orange','av-violet','av-green','av-cyan','av-blue','av-pink','av-teal'];
function avColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AV_COLORS[Math.abs(h) % AV_COLORS.length];
}
function avLetter(name) { return name.charAt(0).toUpperCase(); }

// ===== SCREENS =====
function showScreen(scr) {
  [loginScreen, chatsScreen, chatScreen].forEach(s => s.classList.remove('active'));
  scr.classList.add('active');
}

// ===== LOGIN =====
async function login(username) {
  try {
    const url = api('/api/register');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    const data = await res.json();
    if (data.error) { alert('Error: ' + data.error); return; }

    me = data.user.username;
    localStorage.setItem('tisc_user', me);
    $('sidebar-name').textContent = me;
    $('sidebar-avatar').textContent = avLetter(me);
    $('sidebar-avatar').className = 'sidebar-avatar ' + avColor(me);
    socket.emit('go-online', me);
    showScreen(chatsScreen);
    loadChats();
  } catch (e) {
    alert('Ошибка подключения: ' + e.message + '\nСервер: ' + SERVER);
  }
}

const saved = localStorage.getItem('tisc_user');
if (saved) login(saved);

$('login-btn').onclick = () => {
  const v = $('username-input').value.trim();
  if (v) login(v);
};
$('username-input').onkeydown = e => { if (e.key === 'Enter') $('login-btn').click(); };

// ===== SIDEBAR =====
$('menu-btn').onclick = () => {
  $('sidebar').classList.add('open');
  $('sidebar-overlay').classList.add('open');
};
function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('sidebar-overlay').classList.remove('open');
}
$('sidebar-overlay').onclick = closeSidebar;

$('sidebar-logout').onclick = () => {
  closeSidebar();
  localStorage.removeItem('tisc_user');
  me = null; chatWith = null;
  showScreen(loginScreen);
  $('username-input').value = '';
};

$('sidebar-share').onclick = () => {
  closeSidebar();
  if (navigator.share) {
    navigator.share({ title: 'Tisc Messenger', url: location.href });
  } else {
    navigator.clipboard.writeText(location.href);
    alert('Ссылка скопирована!');
  }
};

// ===== CHATS LIST =====
async function loadChats() {
  try {
    const res = await fetch(api('/api/users?me=' + encodeURIComponent(me)));
    allUsers = await res.json();
    renderChats();
  } catch (e) { console.error('loadChats error:', e); }
}

function renderChats() {
  const list = $('chats-list');
  if (allUsers.length === 0) {
    list.innerHTML = `
      <div class="empty-chats">
        <svg width="80" height="80" viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>
        <p>Пока нет пользователей</p>
        <p style="font-size:0.85rem">Поделись ссылкой с друзьями!</p>
      </div>`;
    return;
  }

  list.innerHTML = allUsers.map(u => {
    const color = avColor(u.username);
    const letter = avLetter(u.username);
    let timeStr = '';
    let preview = '';
    if (u.lastMessage) {
      const d = new Date(u.lastMessage.timestamp);
      const now = new Date();
      if (d.toDateString() === now.toDateString()) {
        timeStr = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      } else {
        timeStr = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
      }
      const prefix = u.lastMessage.from === me ? '<span class="you">Вы: </span>' : '';
      preview = prefix + esc(u.lastMessage.text);
    }
    const badge = u.unread > 0 ? `<div class="chat-badge">${u.unread}</div>` : '';
    const onlineDot = u.online ? '<div class="online-dot"></div>' : '';

    return `
      <div class="chat-item" onclick="openChat('${u.username.replace(/'/g, "\\'")}')">
        <div class="chat-avatar ${color}">${letter}</div>
        ${onlineDot}
        <div class="chat-body">
          <div class="chat-top">
            <div class="chat-name">${esc(u.username)}</div>
            <div class="chat-time">${timeStr}</div>
          </div>
          <div class="chat-bottom">
            <div class="chat-preview">${preview || 'Нет сообщений'}</div>
            ${badge}
          </div>
        </div>
      </div>`;
  }).join('');
}

// ===== CHAT =====
async function openChat(username) {
  chatWith = username;
  const color = avColor(username);
  $('chat-avatar').textContent = avLetter(username);
  $('chat-avatar').className = 'chat-toolbar-avatar ' + color;
  $('chat-name').textContent = username;

  const user = allUsers.find(u => u.username === username);
  updateChatStatus(user?.online);

  showScreen(chatScreen);
  socket.emit('mark-read', { from: username, me });
  await loadMessages();
  $('msg-input').focus();
}

function updateChatStatus(online) {
  const el = $('chat-status');
  if (online) {
    el.textContent = 'в сети';
    el.className = 'chat-toolbar-status online';
  } else {
    el.textContent = 'не в сети';
    el.className = 'chat-toolbar-status';
  }
}

async function loadMessages() {
  const res = await fetch(api(`/api/messages?user1=${encodeURIComponent(me)}&user2=${encodeURIComponent(chatWith)}`));
  const msgs = await res.json();
  renderMessages(msgs);
}

function renderMessages(msgs) {
  const area = $('messages');
  if (msgs.length === 0) {
    area.innerHTML = '<div class="empty-msgs"><p>Нет сообщений</p><p style="font-size:0.85rem;opacity:0.5">Напиши первым!</p></div>';
    return;
  }

  let html = '';
  let lastDate = '';
  msgs.forEach(m => {
    const d = new Date(m.timestamp);
    const dateStr = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    if (dateStr !== lastDate) {
      lastDate = dateStr;
      html += `<div class="date-sep">${dateStr}</div>`;
    }
    const isMine = m.from === me;
    const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const check = isMine ? (m.read ? '<span class="check">&#10003;&#10003;</span>' : '<span class="check">&#10003;</span>') : '';

    html += `
      <div class="msg-row ${isMine ? 'sent' : 'received'}">
        <div class="msg-bubble">
          <span class="msg-text">${esc(m.text)}</span>
          <span class="msg-meta">${time} ${check}</span>
        </div>
      </div>`;
  });
  area.innerHTML = html;
  area.scrollTop = area.scrollHeight;
}

// ===== SEND =====
function sendMessage() {
  const text = $('msg-input').value.trim();
  if (!text || !chatWith) return;
  socket.emit('send-message', { from: me, to: chatWith, text });
  $('msg-input').value = '';
  $('msg-input').focus();
}

$('send-btn').onclick = sendMessage;
$('msg-input').onkeydown = e => { if (e.key === 'Enter') sendMessage(); };

$('msg-input').oninput = () => {
  if (chatWith) socket.emit('typing', { from: me, to: chatWith });
};

// ===== BACK =====
$('back-btn').onclick = () => {
  chatWith = null;
  showScreen(chatsScreen);
  loadChats();
};

// ===== SOCKET EVENTS =====
function setupSocketEvents() {
  socket.on('new-message', msg => {
    if (chatWith && ((msg.from === chatWith && msg.to === me) || (msg.from === me && msg.to === chatWith))) {
      const area = $('messages');
      const empty = area.querySelector('.empty-msgs');
      if (empty) empty.remove();

      const d = new Date(msg.timestamp);
      const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      const isMine = msg.from === me;
      const check = isMine ? '<span class="check">&#10003;</span>' : '';

      const div = document.createElement('div');
      div.className = `msg-row ${isMine ? 'sent' : 'received'}`;
      div.innerHTML = `
        <div class="msg-bubble">
          <span class="msg-text">${esc(msg.text)}</span>
          <span class="msg-meta">${time} ${check}</span>
        </div>`;
      area.appendChild(div);
      area.scrollTop = area.scrollHeight;
      if (!isMine) socket.emit('mark-read', { from: chatWith, me });
    }
    if (chatsScreen.classList.contains('active')) loadChats();
  });

  socket.on('users-update', onlineList => {
    allUsers.forEach(u => { u.online = onlineList.includes(u.username); });
    if (chatsScreen.classList.contains('active')) renderChats();
    if (chatWith) updateChatStatus(onlineList.includes(chatWith));
  });

  socket.on('user-typing', data => {
    if (data.from === chatWith) {
      const bar = $('typing-bar');
      $('typing-text').textContent = `${data.from} печатает...`;
      bar.classList.remove('hidden');
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => bar.classList.add('hidden'), 2500);
    }
  });

  socket.on('connect', () => { if (me) socket.emit('go-online', me); });
}

// Refresh chats periodically
setInterval(() => {
  if (me && chatsScreen.classList.contains('active')) loadChats();
}, 15000);

// ===== UTILS =====
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// Init socket events
setupSocketEvents();

// PWA
let deferredPrompt;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; });
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
