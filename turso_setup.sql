-- ══════════════════════════════════════════════════
-- Pixel Habit Tracker — Turso / SQLite Setup
-- Run via:  turso db shell <your-db-name> < turso_setup.sql
-- ══════════════════════════════════════════════════


-- 1. HABITS
CREATE TABLE IF NOT EXISTS habits (
  id         TEXT    PRIMARY KEY,
  user_id    TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  category   TEXT    NOT NULL DEFAULT 'Other',
  frequency  TEXT    NOT NULL DEFAULT 'Daily',
  color      TEXT    NOT NULL DEFAULT '#7c5cbf',
  created_at TEXT    NOT NULL,
  archived   INTEGER NOT NULL DEFAULT 0
);


-- 2. COMPLETIONS
CREATE TABLE IF NOT EXISTS completions (
  id       INTEGER PRIMARY KEY,
  user_id  TEXT    NOT NULL,
  habit_id TEXT    NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  date     TEXT    NOT NULL,
  UNIQUE(habit_id, date)
);


-- 3. CATEGORIES
CREATE TABLE IF NOT EXISTS categories (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#7c5cbf',
  created_at TEXT NOT NULL,
  UNIQUE(user_id, name)
);


-- 4. TODOS
CREATE TABLE IF NOT EXISTS todos (
  id           TEXT    PRIMARY KEY,
  user_id      TEXT    NOT NULL,
  text         TEXT    NOT NULL,
  completed    INTEGER NOT NULL DEFAULT 0,
  priority     TEXT    NOT NULL DEFAULT 'medium',
  tags         TEXT    NOT NULL DEFAULT '[]',   -- stored as JSON array
  due_date     TEXT,
  order_index  INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'todo',
  completed_at TEXT
);


-- 5. SUBTASKS
CREATE TABLE IF NOT EXISTS subtasks (
  id          TEXT    PRIMARY KEY,
  user_id     TEXT    NOT NULL,
  todo_id     TEXT    NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  text        TEXT    NOT NULL,
  completed   INTEGER NOT NULL DEFAULT 0,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL
);


-- 6. INDEXES
CREATE INDEX IF NOT EXISTS habits_user_id_idx       ON habits(user_id);
CREATE INDEX IF NOT EXISTS completions_user_id_idx  ON completions(user_id);
CREATE INDEX IF NOT EXISTS completions_habit_id_idx ON completions(habit_id);
CREATE INDEX IF NOT EXISTS categories_user_id_idx   ON categories(user_id);
CREATE INDEX IF NOT EXISTS todos_user_id_idx        ON todos(user_id);
CREATE INDEX IF NOT EXISTS subtasks_user_id_idx     ON subtasks(user_id);
CREATE INDEX IF NOT EXISTS subtasks_todo_id_idx     ON subtasks(todo_id);
