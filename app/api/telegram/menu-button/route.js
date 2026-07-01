import { NextResponse } from 'next/server';
import { assertAdminKey } from '../../../../lib/accessServer';
import { setTelegramMenuButton } from '../../../../lib/telegramAccessMessage';

function cleanText(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

async function handle(request) {
  const url = new URL(request.url);
  const jsonBody = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
  const body = {
    ...Object.fromEntries(url.searchParams.entries()),
    ...jsonBody
  };

  const gate = assertAdminKey(request, body);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: 'admin_key required' }, { status: 401 });
  }

  const chatId = cleanText(body.chat_id || body.chatId);
  const result = await setTelegramMenuButton({ chatId: chatId || null });

  return NextResponse.json({
    ok: true,
    scope: chatId ? 'chat' : 'default',
    telegram: result
  });
}

export async function GET(request) {
  return handle(request);
}

export async function POST(request) {
  return handle(request);
}
