import { supabaseFetch } from './supabaseServer';

const DEFAULT_APP_URL = 'https://lumora-2-black.vercel.app';
const DEFAULT_BUTTON_TEXT = 'Клик';
const ACCESS_TEXT = 'Доступ к КЛИК Ai выдан.\n\nОткройте приложение через кнопку «Клик» ниже. Внутри будут доступны отчёты, аналитика и рекомендации по вашему ресторану.';

function enc(value) {
  return encodeURIComponent(String(value || ''));
}

function normalizeUsername(value = '') {
  return String(value || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
}

function cleanText(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function getBotToken() {
  return process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '';
}

function getAppUrl() {
  const raw = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || process.env.VERCEL_URL || DEFAULT_APP_URL;
  const text = String(raw || '').trim();
  if (!text) return DEFAULT_APP_URL;
  if (text.startsWith('http://') || text.startsWith('https://')) return text.replace(/\/$/, '');
  return `https://${text.replace(/\/$/, '')}`;
}

function getButtonText() {
  return cleanText(process.env.TELEGRAM_ACCESS_BUTTON_TEXT, DEFAULT_BUTTON_TEXT);
}

async function optionalRows(path) {
  const rows = await supabaseFetch(path).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function findTelegramUser({ telegramId, username }) {
  const tg = cleanText(telegramId);
  const normalized = normalizeUsername(username);

  if (tg) {
    const rows = await optionalRows(`/rest/v1/app_users?select=telegram_id,username,username_normalized,display_name&telegram_id=eq.${enc(tg)}&limit=1`);
    if (rows[0]?.telegram_id) return rows[0];
    return { telegram_id: tg, username: normalized ? `@${normalized}` : null };
  }

  if (!normalized) return null;

  const rows = await optionalRows(`/rest/v1/app_users?select=telegram_id,username,username_normalized,display_name&username_normalized=eq.${enc(normalized)}&limit=1`);
  return rows[0]?.telegram_id ? rows[0] : null;
}

function buildReplyMarkup(appUrl = getAppUrl()) {
  return {
    inline_keyboard: [
      [
        {
          text: getButtonText(),
          web_app: { url: appUrl }
        }
      ]
    ]
  };
}

function buildMenuButton(appUrl = getAppUrl()) {
  return {
    type: 'web_app',
    text: getButtonText(),
    web_app: { url: appUrl }
  };
}

async function telegramRequest(method, payload) {
  const token = getBotToken();
  if (!token) {
    return {
      ok: false,
      sent: false,
      reason: 'bot_token_missing',
      hint: 'Добавь TELEGRAM_BOT_TOKEN или BOT_TOKEN в Vercel Environment Variables.'
    };
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const json = await response.json().catch(() => ({}));
  return {
    ok: Boolean(json.ok),
    sent: Boolean(json.ok),
    method,
    telegram_status: response.status,
    telegram_response: json
  };
}

export async function setTelegramMenuButton({ chatId, appUrl = getAppUrl() } = {}) {
  const payload = {
    menu_button: buildMenuButton(appUrl)
  };

  if (chatId) payload.chat_id = String(chatId);

  const result = await telegramRequest('setChatMenuButton', payload);
  return {
    ...result,
    chat_id: chatId || null,
    button_text: getButtonText(),
    app_url: appUrl
  };
}

export async function sendAccessGrantedMessage({ telegramId, username } = {}) {
  const appUrl = getAppUrl();
  const user = await findTelegramUser({ telegramId, username });

  if (!user?.telegram_id) {
    return {
      ok: true,
      sent: false,
      reason: 'telegram_id_unknown',
      username: username ? `@${normalizeUsername(username)}` : null,
      hint: 'Бот не может первым написать человеку только по @username. Пользователь должен хотя бы один раз открыть бота/Mini App, чтобы в app_users появился telegram_id.'
    };
  }

  const menuResult = await setTelegramMenuButton({ chatId: user.telegram_id, appUrl }).catch((error) => ({
    ok: false,
    method: 'setChatMenuButton',
    error: error?.message || 'setChatMenuButton failed'
  }));

  const messageResult = await telegramRequest('sendMessage', {
    chat_id: user.telegram_id,
    text: ACCESS_TEXT,
    reply_markup: buildReplyMarkup(appUrl)
  });

  return {
    ...messageResult,
    chat_id: user.telegram_id,
    username: user.username || username || null,
    button_text: getButtonText(),
    app_url: appUrl,
    message_text: ACCESS_TEXT,
    menu_button: menuResult
  };
}

export async function notifyMemberAccessGranted({ member } = {}) {
  return sendAccessGrantedMessage({
    telegramId: member?.telegram_id,
    username: member?.username_normalized || member?.username
  }).catch((error) => ({
    ok: false,
    sent: false,
    reason: 'telegram_send_failed',
    error: error?.message || 'Telegram notification failed'
  }));
}
