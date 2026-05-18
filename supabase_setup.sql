-- ══════════════════════════════════════════════════
-- Pixel Habit Tracker — Supabase Setup
-- Run this entire file in:
--   Supabase Dashboard → SQL Editor → New query
-- ══════════════════════════════════════════════════


-- 1. HABITS TABLE
create table if not exists public.habits (
  id         text        primary key,
  user_id    text        not null,
  name       text        not null,
  category   text        not null default 'Other',
  frequency  text        not null default 'Daily',
  color      text        not null default '#7c5cbf',
  created_at text        not null
);


-- 2. COMPLETIONS TABLE
create table if not exists public.completions (
  id         bigserial   primary key,
  user_id    text        not null,
  habit_id   text        not null references public.habits(id) on delete cascade,
  date       text        not null,
  constraint completions_unique unique (habit_id, date)
);


-- 3. ROW LEVEL SECURITY
--    Enabled but fully open for anon — safe for a personal app
--    where the anon key is your only access control.
alter table public.habits      enable row level security;
alter table public.completions enable row level security;

-- Drop policies if re-running this script
drop policy if exists "anon_all_habits"      on public.habits;
drop policy if exists "anon_all_completions" on public.completions;

create policy "anon_all_habits"
  on public.habits for all
  to anon
  using (true)
  with check (true);

create policy "anon_all_completions"
  on public.completions for all
  to anon
  using (true)
  with check (true);


-- 3b. CATEGORIES TABLE
create table if not exists public.categories (
  id         text        primary key,
  user_id    text        not null,
  name       text        not null,
  color      text        not null default '#7c5cbf',
  created_at text        not null,
  constraint categories_user_name_unique unique (user_id, name)
);

alter table public.categories enable row level security;

drop policy if exists "anon_all_categories" on public.categories;

create policy "anon_all_categories"
  on public.categories for all
  to anon
  using (true)
  with check (true);


-- 3c. ARCHIVE FLAG on habits
alter table public.habits add column if not exists archived boolean not null default false;


-- 5. TODOS TABLE
create table if not exists public.todos (
  id          text      primary key,
  user_id     text      not null,
  text        text      not null,
  completed   boolean   not null default false,
  priority    text      not null default 'medium',
  tags        text[]    not null default '{}',
  due_date    text,
  order_index integer   not null default 0,
  created_at  text      not null
);

alter table public.todos enable row level security;
drop policy if exists "anon_all_todos" on public.todos;
create policy "anon_all_todos"
  on public.todos for all to anon using (true) with check (true);


-- 6. SUBTASKS TABLE
create table if not exists public.subtasks (
  id          text      primary key,
  user_id     text      not null,
  todo_id     text      not null references public.todos(id) on delete cascade,
  text        text      not null,
  completed   boolean   not null default false,
  order_index integer   not null default 0,
  created_at  text      not null
);

alter table public.subtasks enable row level security;
drop policy if exists "anon_all_subtasks" on public.subtasks;
create policy "anon_all_subtasks"
  on public.subtasks for all to anon using (true) with check (true);


-- 4. INDEXES for fast per-user queries
create index if not exists habits_user_id_idx       on public.habits(user_id);
create index if not exists completions_user_id_idx  on public.completions(user_id);
create index if not exists completions_habit_id_idx on public.completions(habit_id);
create index if not exists categories_user_id_idx   on public.categories(user_id);
create index if not exists todos_user_id_idx        on public.todos(user_id);
create index if not exists subtasks_user_id_idx     on public.subtasks(user_id);
create index if not exists subtasks_todo_id_idx     on public.subtasks(todo_id);
