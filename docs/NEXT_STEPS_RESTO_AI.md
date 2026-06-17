# Next steps: ресторанный AI mini app

## Что уже есть в MVP v2

- Дашборд день/неделя/блюда.
- Сигналы: средний чек, фудкост, скидки.
- AI-чат внутри Telegram Mini App.
- Заготовка уведомлений.
- Заготовка ролей и источников данных.

## Как включить реальный AI-чат

1. Открой Vercel → Project → Settings → Environment Variables.
2. Добавь:
   - OPENAI_API_KEY=твой_ключ
   - OPENAI_MODEL=gpt-4.1-mini
3. Нажми Redeploy.

Без OPENAI_API_KEY чат работает в demo/fallback режиме.

## Как подключать iiko

Безопасная схема:

iiko → n8n/backend → Supabase → Mini App

Не вставляй логины и ключи iiko во frontend. Пользователь может их увидеть.

## Первый путь по iiko для клиента

1. Спросить у ресторана: iikoCloud или локальная iiko.
2. На старте взять CSV/Excel выгрузку OLAP по продажам.
3. Загрузить в Google Sheets или Supabase.
4. Подменить sampleData на реальные данные.
5. Потом автоматизировать через n8n/API.
