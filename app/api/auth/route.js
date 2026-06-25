import { NextResponse } from 'next/server';
import { isFreshAuthDate, parseInitData, validateTelegramInitData } from '../../../lib/telegram';
import {
  acceptPendingInvitesForUser,
  enrichAccessWithRestaurants,
  upsertAppUser,
  getAccessForTelegramId,
  getActiveRestaurants
} from '../../../lib/accessServer';

async function buildAccessPayload(user) {
  try {
    if (!user || !user.id) {
      return { access: [], restaurants: [], acceptedInvites: [] };
    }

    await upsertAppUser(user);
    const acceptedInvites = await acceptPendingInvitesForUser(user);
    const access = await getAccessForTelegramId(user.id);
    const restaurants = await getActiveRestaurants();

    return {
      access: enrichAccessWithRestaurants(access, restaurants),
      restaurants,
      acceptedInvites
    };
  } catch (error) {
    return {
      access: [],
      restaurants: [],
      acceptedInvites: [],
      accessError: error?.message || 'access_check_failed'
    };
  }
}

export async function POST(request) {
  const authHeader = request.headers.get('authorization') || '';
  const [, initData] = authHeader.match(/^tma\s+(.+)$/i) || [];

  if (!initData) {
    return NextResponse.json({
      ok: true,
      mode: 'demo-browser',
      user: { id: 'demo', first_name: 'Демо', username: 'browser' },
      access: [],
      restaurants: [],
      acceptedInvites: [],
      note: 'Telegram initData отсутствует. В браузере доступы не привязываются, это нормально.'
    });
  }

  const botToken = process.env.BOT_TOKEN;
  const parsed = parseInitData(initData);
  const valid = validateTelegramInitData(initData, botToken);
  const fresh = isFreshAuthDate(parsed.authDate);

  if (!valid || !fresh) {
    return NextResponse.json({ ok: false, error: 'Invalid Telegram init data' }, { status: 401 });
  }

  const accessPayload = await buildAccessPayload(parsed.user);

  return NextResponse.json({
    ok: true,
    mode: 'telegram',
    user: parsed.user,
    ...accessPayload
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    mode: 'auth-ready',
    note: 'Use POST with Authorization: tma <Telegram initData>. Browser GET is only a health check.'
  });
}
