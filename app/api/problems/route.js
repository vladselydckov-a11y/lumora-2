import { NextResponse } from 'next/server';
import { buildDynamicSummary } from '../../../lib/sampleData';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const restaurantId = searchParams.get('restaurant_id') || 'all';
  const summary = buildDynamicSummary({ restaurantId });
  return NextResponse.json({ problems: summary.problems, losses: summary.moneyLosses, totalLoss: summary.totalLoss });
}
