import { NextResponse } from 'next/server';
import { buildDynamicSummary } from '../../../lib/sampleData';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const restaurantId = searchParams.get('restaurant_id') || 'all';
  const summary = buildDynamicSummary({ restaurantId });
  return NextResponse.json({ restaurantId, plan: summary.plan, notifications: summary.notifications, users: summary.users });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  // MVP v6: сохраняем настройки на клиенте/localStorage. В боевой версии здесь будет upsert в Supabase.
  return NextResponse.json({ ok: true, saved: false, mode: 'demo_settings_endpoint', received: body });
}
