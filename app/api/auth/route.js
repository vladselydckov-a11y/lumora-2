import { NextResponse } from 'next/server';
import { isFreshAuthDate, parseInitData, validateTelegramInitData } from '../../../lib/telegram';

export async function POST(request) {
  const authHeader = request.headers.get('authorization') || '';
  const [, initData] = authHeader.match(/^tma\s+(.+)$/i) || [];

  if (!initData) {
    return NextResponse.json({
      ok: true,
      mode: 'demo-browser',
      user: { id: 'demo', first_name: 'Демо', username: 'browser' }
    });
  }

  const botToken = process.env.BOT_TOKEN;
  const parsed = parseInitData(initData);
  const valid = validateTelegramInitData(initData, botToken);
  const fresh = isFreshAuthDate(parsed.authDate);

  if (!valid || !fresh) {
    return NextResponse.json({ ok: false, error: 'Invalid Telegram init data' }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    mode: 'telegram',
    user: parsed.user
  });
}
