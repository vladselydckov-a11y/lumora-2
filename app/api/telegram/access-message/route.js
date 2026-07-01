import { NextResponse } from 'next/server';
import { assertAdminKey, normalizeUsername } from '../../../../lib/accessServer';
import { supabaseFetch } from '../../../../lib/supabaseServer';
import { sendAccessGrantedMessage } from '../../../../lib/telegramAccessMessage';

function enc(value) {
  return encodeURIComponent(String(value || ''));
}

function cleanText(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

async function fetchOptional(path) {
  const rows = await supabaseFetch(path).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function findBusinessMember({ businessId, username, telegramId }) {
  const businessFilter = businessId ? `&business_id=eq.${enc(businessId)}` : '';
  const tg = cleanText(telegramId);
  const normalized = normalizeUsername(username);

  if (tg) {
    const rows = await fetchOptional(`/rest/v1/platform_business_users?select=*&telegram_id=eq.${enc(tg)}${businessFilter}&status=eq.active&limit=1`);
    if (rows[0]) return rows[0];
  }

  if (normalized) {
    const rows = await fetchOptional(`/rest/v1/platform_business_users?select=*&username_normalized=eq.${enc(normalized)}${businessFilter}&status=eq.active&limit=1`);
    if (rows[0]) return rows[0];
  }

  return null;
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

  const businessId = cleanText(body.business_id || body.businessId);
  const username = cleanText(body.username);
  const telegramId = cleanText(body.telegram_id || body.telegramId);

  if (!username && !telegramId) {
    return NextResponse.json({ ok: false, error: 'username or telegram_id is required' }, { status: 400 });
  }

  const member = await findBusinessMember({ businessId, username, telegramId });
  const result = await sendAccessGrantedMessage({
    telegramId: telegramId || member?.telegram_id,
    username: username || member?.username_normalized || member?.username
  });

  return NextResponse.json({
    ok: true,
    memberFound: Boolean(member),
    business_id: businessId || member?.business_id || null,
    username: username || member?.username || null,
    telegramNotification: result
  });
}

export async function GET(request) {
  return handle(request);
}

export async function POST(request) {
  return handle(request);
}
