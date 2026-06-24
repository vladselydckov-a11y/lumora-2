import { NextResponse } from 'next/server';
import {
  acceptPendingInvitesForUser,
  enrichAccessWithRestaurants,
  getAccessForTelegramId,
  getActiveRestaurants,
  telegramUserFromBody,
  upsertAppUser
} from '../../../../lib/accessServer';

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const telegramUser = telegramUserFromBody(body);

  if (!telegramUser) {
    return NextResponse.json({
      ok: true,
      mode: 'browser_without_telegram',
      user: null,
      access: [],
      restaurants: [],
      message: 'Открой Mini App в Telegram, чтобы привязать telegram_id. В браузере доступы не определяются.'
    });
  }

  const user = await upsertAppUser(telegramUser);
  await acceptPendingInvitesForUser(telegramUser);

  const [accessRows, restaurants] = await Promise.all([
    getAccessForTelegramId(telegramUser.id),
    getActiveRestaurants()
  ]);

  const access = enrichAccessWithRestaurants(accessRows, restaurants);
  const allowedRestaurants = access
    .map((item) => item.restaurant)
    .filter(Boolean);

  return NextResponse.json({
    ok: true,
    mode: 'telegram_user_access',
    user,
    access,
    restaurants: allowedRestaurants,
    hasAccess: access.length > 0
  });
}
