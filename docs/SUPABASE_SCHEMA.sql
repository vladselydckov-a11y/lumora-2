-- Resto Mini App v6 Supabase schema
-- Запускать в Supabase SQL editor.

create extension if not exists "pgcrypto";

create table if not exists restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  telegram_id text unique,
  name text,
  role text default 'viewer',
  created_at timestamptz default now()
);

create table if not exists user_restaurant_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  restaurant_id uuid references restaurants(id) on delete cascade,
  role text default 'viewer',
  created_at timestamptz default now(),
  unique(user_id, restaurant_id)
);

create table if not exists kpi_settings (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id) on delete cascade,
  daily_revenue_plan numeric default 250000,
  avg_check_target numeric default 1450,
  foodcost_max numeric default 30,
  discount_max numeric default 9000,
  updated_at timestamptz default now(),
  unique(restaurant_id)
);

create table if not exists daily_sales (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id) on delete cascade,
  business_date date not null,
  revenue numeric default 0,
  plan_revenue numeric default 0,
  checks_count integer default 0,
  guests_count integer default 0,
  avg_check numeric default 0,
  foodcost_percent numeric default 0,
  discounts numeric default 0,
  returns_amount numeric default 0,
  created_at timestamptz default now(),
  unique(restaurant_id, business_date)
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id) on delete cascade,
  business_date date not null,
  external_order_id text,
  source text,
  waiter_name text,
  status text,
  amount numeric default 0,
  discount numeric default 0,
  created_at timestamptz default now()
);

create table if not exists dish_sales (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id) on delete cascade,
  business_date date not null,
  dish_name text not null,
  category_name text,
  quantity numeric default 0,
  revenue numeric default 0,
  cost numeric default 0,
  foodcost_percent numeric default 0,
  created_at timestamptz default now()
);

create table if not exists waiter_sales (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id) on delete cascade,
  business_date date not null,
  waiter_name text not null,
  revenue numeric default 0,
  checks_count integer default 0,
  avg_check numeric default 0,
  upsell_score numeric default 0,
  created_at timestamptz default now()
);

create table if not exists problem_signals (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id) on delete cascade,
  business_date date not null,
  level text default 'warn',
  title text not null,
  reason text,
  amount numeric default 0,
  action text,
  created_at timestamptz default now()
);

create table if not exists ai_reports (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id) on delete cascade,
  business_date date not null,
  report_type text default 'daily',
  report_text text,
  created_at timestamptz default now()
);

create table if not exists notification_rules (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id) on delete cascade,
  telegram_chat_id text,
  rule_type text not null,
  enabled boolean default true,
  threshold numeric,
  schedule_time text,
  prompt text,
  created_at timestamptz default now()
);
