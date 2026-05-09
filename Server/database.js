const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '../messenger.db');
let db = null;
let SQL = null;
let initialized = false;

const dbWrapper = {
  prepare: (sql) => {
    if (!db) throw new Error('Database not initialized');
    return {
      run(...params) {
        db.run(sql, params);
        saveDb();
        return { changes: 1, lastInsertRowid: -1 };
      },
      get(...params) {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        const result = stmt.step() ? stmt.getAsObject() : null;
        stmt.free();
        return result;
      },
      all(...params) {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        const results = [];
        while (stmt.step()) {
          results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
      }
    };
  },
  exec: (sql) => {
    if (!db) throw new Error('Database not initialized');
    db.run(sql);
    saveDb();
  },
  pragma: () => {},
  run: (sql, params) => {
    if (!db) throw new Error('Database not initialized');
    db.run(sql, params);
    saveDb();
  },
  close: () => {
    if (db) {
      saveDb();
      db.close();
    }
  },
  isReady: () => initialized
};

function saveDb() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  }
}

// Initialize the database asynchronously
async function initDb() {
  SQL = await initSqlJs();
  
  let data;
  try {
    data = fs.readFileSync(dbPath);
  } catch {
    data = null;
  }
  
  db = new SQL.Database(data);
  
  // Create tables
  const tableDefinitions = [
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      display_name TEXT NOT NULL,
      avatar TEXT DEFAULT 'default',
      status TEXT DEFAULT 'online',
      status_message TEXT DEFAULT 'Hello!',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      contact_id INTEGER NOT NULL,
      nickname TEXT,
      group_name TEXT DEFAULT 'Friends',
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (contact_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, contact_id)
    )`,
    `CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      receiver_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      type TEXT DEFAULT 'text',
      read_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS chat_rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS room_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS room_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(room_id, user_id)
    )`
  ];

  tableDefinitions.forEach(def => {
    db.run(def);
  });

  // Insert default chat rooms
  const rooms = [
    ['Romania General', 'Chat general pentru romani'],
    ['Music & Movies', 'Discutii despre muzica si filme'],
    ['Games & Fun', 'Jocuri si distractie'],
    ['Tech Talk', 'Discutii despre tehnologie']
  ];

  rooms.forEach(([name, desc]) => {
    db.run(
      'INSERT OR IGNORE INTO chat_rooms (name, description, created_by) VALUES (?, ?, NULL)',
      [name, desc]
    );
  });

  saveDb();
  initialized = true;
  console.log('✅ Database initialized successfully');
}

// Export a function that initializes the database
module.exports = {
  init: initDb,
  get: () => dbWrapper,
  prepare: (sql) => dbWrapper.prepare(sql),
  exec: (sql) => dbWrapper.exec(sql),
  pragma: () => dbWrapper.pragma(),
  run: (sql, params) => dbWrapper.run(sql, params),
  close: () => dbWrapper.close(),
  isReady: () => initialized
};
