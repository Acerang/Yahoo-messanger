const fs = require('fs');
const path = require('path');
const dbPath = path.join(__dirname, '../database.json');

let data = {
  users: [], contacts: [], messages: [],
  chat_rooms: [{ id: 1, name: 'Romania General' }],
  room_messages: [], room_members: []
};

if (fs.existsSync(dbPath)) {
  try { data = JSON.parse(fs.readFileSync(dbPath, 'utf8')); } catch (e) { console.error("Eroare JSON"); }
}

const save = () => fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));

module.exports = {
  getRawData: () => data,
  save: save,
  init: async () => { save(); },
  prepare: (sql) => {
    const s = sql.toLowerCase();
    return {
      get: (...p) => {
        const param = (p[0] || '').toString().toLowerCase();
        if (s.includes('from users where id =')) return data.users.find(u => u.id === p[0]) || null;
        if (s.includes('from users where username =')) return data.users.find(u => (u.username || '').toLowerCase() === param) || null;
        return null;
      },
      run: (...p) => {
        if (s.includes('insert into users')) {
          const n = { id: data.users.length + 1, username: p[0], email: p[1], password: p[2], display_name: p[3], avatar: 'default', status: 'online', status_message: 'Hello!', created_at: new Date().toISOString(), current_session_ip: null };
          data.users.push(n);
        } else if (s.includes('update users set status =')) {
          const u = data.users.find(x => x.id === p[p.length - 1]);
          if (u) { u.status = p[0]; if (s.includes('status_message')) u.status_message = p[1]; }
        }
        save();
        return { lastInsertRowid: Date.now() };
      }
    };
  }
};