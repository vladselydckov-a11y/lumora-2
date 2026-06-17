# n8n: iiko/CSV → Supabase → Telegram

## MVP workflow через выгрузку iiko

1. Google Drive Trigger или Manual Trigger.
2. Скачать CSV/Excel выгрузку из iiko.
3. Read Spreadsheet.
4. Code node: привести колонки к формату:
   - restaurant_id
   - business_date
   - revenue
   - checks_count
   - avg_check
   - dish_name
   - waiter_name
   - discounts
   - foodcost_percent
5. Supabase upsert:
   - daily_sales
   - dish_sales
   - waiter_sales
6. OpenAI: сформировать AI-отчёт.
7. Supabase insert: ai_reports.
8. Telegram: отправить отчёт владельцу.

## Потом

Когда клиент готов платить за автоматизацию, CSV можно заменить на iiko API / scheduled OLAP export.
