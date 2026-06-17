import { NextResponse } from 'next/server';
import { buildDynamicSummary } from '../../../lib/sampleData';
import { supabaseFetch } from '../../../lib/supabaseServer';

export async function GET() {
  if (process.env.USE_SUPABASE === 'true') {
    const rows = await supabaseFetch('/rest/v1/restaurants?select=id,name,city,is_active&order=name.asc').catch(() => null);
    if (Array.isArray(rows) && rows.length) {
      return NextResponse.json([{ id: 'all', name: 'Вся сеть', city: 'Все точки' }, ...rows]);
    }
  }
  const summary = buildDynamicSummary();
  return NextResponse.json([{ id: 'all', name: 'Вся сеть', city: 'Все точки' }, ...summary.network.restaurants.map((item) => ({ id: item.id, name: item.name, city: item.city }))]);
}
