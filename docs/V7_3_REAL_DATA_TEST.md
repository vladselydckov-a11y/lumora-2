# v7.3 Real Data Test

Цель v7.3: показать клиенту не просто красивую демку, а понятную механику внедрения данных ресторана.

Цепочка:

```text
Выгрузка iiko / Excel / CSV
→ Supabase таблицы
→ /api/summary
→ Mini App
→ AI-анализ
→ Telegram-отчёт
```

## Что добавлено

1. `lib/supabaseServer.js` теперь не просто проверяет подключение Supabase, а агрегирует реальные таблицы:
   - `restaurants`
   - `kpi_settings`
   - `daily_sales`
   - `dish_sales`
   - `waiter_sales`

2. `/api/summary` при `USE_SUPABASE=true` возвращает real data summary.

3. В `docs/demo-data` лежат готовые CSV выдуманного ресторана `Северный Гриль` за 30 дней.

4. `/api/import/preview` обновлён: показывает preview логики импорта и может базово проверить CSV-текст, если передать `csv_text`.

## Как протестировать real data mode

### 1. Создай Supabase проект

В Supabase открой SQL Editor и выполни:

```text
docs/SUPABASE_SCHEMA.sql
```

### 2. Загрузи CSV

В Supabase Table Editor загрузи файлы из `docs/demo-data` в таком порядке:

```text
restaurants.csv → restaurants
kpi_settings.csv → kpi_settings
daily_sales.csv → daily_sales
dish_sales.csv → dish_sales
waiter_sales.csv → waiter_sales
orders.csv → orders, опционально
```

Важно: во всех CSV используется один restaurant_id:

```text
11111111-1111-4111-8111-111111111111
```

### 3. Добавь ENV в Vercel

```env
USE_SUPABASE=true
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=service_role_key
```

После добавления ENV сделай Redeploy.

### 4. Проверь API

Открой:

```text
https://your-app.vercel.app/api/summary
```

Если всё подключено, в JSON должно быть:

```json
"dataMode": "supabase_real_30_days_v7_3"
```

### 5. Открой Mini App

Теперь экраны День, Неделя, Сеть, Риски, План, Блюда, Команда, AI-анализ и Отчёт будут строиться по таблицам Supabase.

## Что говорить клиенту

Не говори клиенту: “Мы загрузим Excel”.

Говори так:

```text
На старте мы берём выгрузку из iiko за 30 дней, загружаем её в нашу систему, и вы видите в Telegram готовую AI-аналитику: выручка, план-факт, средний чек, блюда, команда, риски и рекомендации.
```

Excel/CSV — это не продукт. Это сырьё для данных.

## Что ещё не является полной автоматизацией

v7.3 умеет читать реальные данные из Supabase. Но если клиент хочет, чтобы iiko сама каждый день обновляла данные, нужен следующий этап:

```text
iiko API / scheduled export
→ n8n или backend
→ Supabase upsert
→ Mini App
→ Telegram report
```

Это уже отдельная платная автоматизация, а не базовый запуск.
