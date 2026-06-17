async function main() {
  const token = process.env.BOT_TOKEN;
  const url = process.env.WEBAPP_URL;

  if (!token || !url) {
    console.error('BOT_TOKEN and WEBAPP_URL are required');
    process.exit(1);
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      menu_button: {
        type: 'web_app',
        text: 'Открыть отчёт',
        web_app: { url }
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
