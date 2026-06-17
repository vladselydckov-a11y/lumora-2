async function main() {
  const token = process.env.BOT_TOKEN;
  const url = process.env.WEBAPP_URL;
  const chatId = process.env.CHAT_ID;

  if (!token || !url || !chatId) {
    console.error('BOT_TOKEN, WEBAPP_URL and CHAT_ID are required');
    process.exit(1);
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: 'Открой мини-приложение с отчётом ресторана:',
      reply_markup: {
        inline_keyboard: [[
          { text: 'Открыть отчёт', web_app: { url } }
        ]]
      }
    })
  });

  const result = await response.json();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
