import { NextResponse } from 'next/server';
import { buildDynamicSummary } from '../../../lib/sampleData';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const restaurantId = searchParams.get('restaurant_id') || 'all';
  const summary = buildDynamicSummary({ restaurantId });

  const tasks = summary.actionPlan.map((item, index) => ({
    id: `task-${index + 1}`,
    restaurant_id: restaurantId,
    owner_role: item.role,
    title: item.title,
    text: item.text,
    status: index === 0 ? 'in_progress' : 'new',
    due: index === 0 ? 'today_18_00' : 'today',
    expected_effect: index === 0 ? 'поднять средний чек и вернуть часть потерь' : 'снизить операционные отклонения'
  }));

  return NextResponse.json({ tasks, generatedAt: summary.generatedAt, mode: 'v7_demo_tasks' });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  return NextResponse.json({ ok: true, mode: 'demo_action_tracker', received: body });
}
