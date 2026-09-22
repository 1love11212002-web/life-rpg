-- Goal Quest: схема базы данных.
-- Выполнить целиком в Supabase: SQL Editor -> New query -> вставить -> Run.
-- Таблицы habits/stats/achievements/weigh_ins/chat_messages пока не использует
-- код, они созданы заранее под следующие этапы, чтобы потом не переносить данные.

create extension if not exists "pgcrypto";

-- ---------- Пользователи ----------
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint unique not null,
  first_name text,
  xp_total int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- Цели и квесты (этап 1) ----------
create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  category text not null default 'other',
  deadline date,
  status text not null default 'active', -- active | done | archived
  created_at timestamptz not null default now()
);

create table if not exists quests (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references goals(id) on delete cascade,
  text text not null,
  xp int not null default 10,
  position int not null default 0,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists xp_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  amount int not null,
  reason text,
  created_at timestamptz not null default now()
);

-- ---------- Следующие этапы ----------
create table if not exists habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  frequency text not null default 'daily',
  streak int not null default 0,
  best_streak int not null default 0,
  goal_id uuid references goals(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists habit_logs (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references habits(id) on delete cascade,
  done_date date not null,
  created_at timestamptz not null default now(),
  unique (habit_id, done_date)
);

create table if not exists stats (
  user_id uuid primary key references users(id) on delete cascade,
  discipline int not null default 0,
  knowledge int not null default 0,
  finance int not null default 0,
  fitness int not null default 0,
  career int not null default 0,
  social int not null default 0
);

create table if not exists achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  description text,
  earned_at timestamptz not null default now()
);

create table if not exists weigh_ins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  weight_kg numeric not null,
  logged_at timestamptz not null default now()
);

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  role text not null, -- user | assistant
  content text not null,
  created_at timestamptz not null default now()
);

-- ---------- Индексы ----------
create index if not exists idx_goals_user on goals(user_id);
create index if not exists idx_quests_goal on quests(goal_id);
create index if not exists idx_xp_log_user on xp_log(user_id);
create index if not exists idx_habits_user on habits(user_id);
create index if not exists idx_habit_logs_habit on habit_logs(habit_id);
create index if not exists idx_weigh_ins_user on weigh_ins(user_id);
create index if not exists idx_chat_user on chat_messages(user_id);

-- Доступ к таблицам получает только сервер через service_role ключ
-- (он задаётся в переменных окружения Vercel и никогда не попадает в браузер),
-- поэтому Row Level Security на этих таблицах не включаем.
