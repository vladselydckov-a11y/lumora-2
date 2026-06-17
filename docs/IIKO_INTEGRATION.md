# iiko integration plan

## MVP route: manual CSV first

1. В iiko построить OLAP-отчёт по продажам за день/неделю.
2. Выгрузить CSV/Excel.
3. Нормализовать данные в таблицы:
   - daily_sales
   - dish_sales
   - waiter_sales
4. Загружать данные в Google Sheets/Supabase.
5. Mini App читает `/api/summary`.

## Production route: API

Нужны данные от клиента:

- iikoCloud или iikoClassic/iikoOffice/iikoWeb?
- Есть ли API-доступ?
- Base URL / portal URL.
- Логин отдельного API-пользователя только на чтение.
- Какие отчёты нужны: продажи, блюда, официанты, фудкост, склад.
- Разрешение владельца на обработку данных.

## Recommended architecture

```
iiko API / CSV / email export
        ↓
n8n scheduled workflow
        ↓
normalize data
        ↓
Supabase / PostgreSQL
        ↓
Next.js Telegram Mini App
        ↓
Telegram reports
```

## Normalized tables

```sql
create table restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

create table daily_sales (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id),
  business_date date not null,
  revenue numeric default 0,
  checks_count integer default 0,
  guests_count integer default 0,
  avg_check numeric default 0,
  created_at timestamptz default now()
);

create table dish_sales (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id),
  business_date date not null,
  dish_name text not null,
  category_name text,
  quantity numeric default 0,
  revenue numeric default 0,
  cost numeric default 0,
  created_at timestamptz default now()
);

create table waiter_sales (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id),
  business_date date not null,
  waiter_name text not null,
  revenue numeric default 0,
  checks_count integer default 0,
  avg_check numeric default 0,
  created_at timestamptz default now()
);
```
