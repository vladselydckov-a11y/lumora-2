import { NextResponse } from 'next/server';
import { getSupabaseSummary } from '../../../lib/supabaseServer';
import { assertApiAccess } from '../../../lib/saasAccessGuard';
import {
  buildRestaurantBrainBrief,
  buildRestaurantInstructions,
  classifyRestaurantQuestion,
  getBrainFallbackAnswer
} from '../../../lib/aiBrain';

const DEFAULT_MODEL = 'gpt-4.1-mini';

function buildNoDataSummary({ restaurantId = 'all', date, period = 'day' } = {}) {
  const plan = period === 'month' ? 3000000 : period === 'week' ? 500000 : 150000;
  const selectedDate = date || new Date().toISOString().slice(0, 10);
  return {
    dataMode: 'ai_no_real_data',
    isEmptyPeriod: true,
    generatedAt: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    selectedRestaurantId: restaurantId,
    restaurant: { id: restaurantId, name: restaurantId === 'all' ? 'Вся сеть' : 'Ресторан', city: 'Тюмень', revenue: 0, plan, avgCheck: 0, checks: 0, guests: 0 },
    period: { date: selectedDate, startDate: selectedDate, endDate: selectedDate, type: period, title: period === 'week' ? 'Неделя' : period === 'month' ? 'Месяц' : 'День' },
    plan: { dailyRevenue: 150000, weeklyRevenue: 500000, monthlyRevenue: 3000000, activeRevenue: plan, avgCheck: 2200, foodcostMax: 30, discountMax: 9000 },
    metrics: [],
    salesChannels: [], topDishes: [], lowDishes: [], waiters: [], week: [], hourly: [], hourlyPeaks: [], weakHours: [],
    discountAnalytics: {}, network: { restaurants: [] }, moneyLosses: [], actionPlan: [],
    forecast: { current: 0, projected: 0, plan, gap: plan, risk: 'нет реальных данных', recommendations: [] },
    dataQuality: { kpi: 'нет реального ответа', foodcost: 'не подключено', waiters: 'нет данных', restaurants: 'нет данных' },
    teamScript: 'Реальные данные пока не получены.',
    ai: { summary: 'Lumora не получила реальные данные.', recommendations: ['Проверить /api/summary и ENV в Vercel.'] }
  };
}

async function getSummary(restaurantId, date, period) {
  if (process.env.USE_SUPABASE !== 'true') {
    return buildNoDataSummary({ restaurantId, date, period });
  }

  const realSummary = await getSupabaseSummary({ restaurantId, date, period }).catch((error) => {
    console.error('AI Supabase summary error:', error);
    return null;
  });

  return realSummary || buildNoDataSummary({ restaurantId, date, period });
}

function extractOutputText(data) {
  if (data?.output_text) return data.output_text;
  if (!Array.isArray(data?.output)) return '';
  return data.output
    .flatMap((item) => item.content || [])
    .map((part) => part.text || part.output_text || '')
    .filter(Boolean)
    .join('\n')
    .trim();
}

function shouldUseFallbackOnly(summary) {
  return summary?.dataMode === 'ai_no_real_data' || summary?.dataMode === 'strict_no_demo_data';
}

function sanitizeAnswer(answer, summary, intent, question) {
  let text = String(answer || '').trim();
  if (!text) return getBrainFallbackAnswer(question, summary, intent);

  const foodcostNotReady = String(summary?.dataQuality?.foodcost || '').includes('не подключено') || String(summary?.dataQuality?.foodcost || '').includes('не подключ');
  if (foodcostNotReady) {
    text = text
      .replace(/проверить себестоимость топ-блюд\.?/gi, 'себестоимость подключить отдельным этапом.')
      .replace(/разобрать фудкост топ-блюд\.?/gi, 'фудкост не оценивать до подключения себестоимости.')
      .replace(/проверить фудкост топ-блюд\.?/gi, 'фудкост не оценивать до подключения себестоимости.');
  }

  return text;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const restaurantId = body?.restaurant_id || body?.restaurantId || 'all';
    const aiMode = body?.ai_mode || body?.aiMode || 'director';
    const date = body?.date || undefined;
    const period = body?.period || 'day';
    const history = Array.isArray(body?.history) ? body.history.slice(-4) : [];
    const question = String(body?.question || '').trim();

    const guard = await assertApiAccess(request, { restaurantId, section: 'ai' });
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });

    if (!question) {
      return NextResponse.json({
        answer: 'Напиши вопрос по ресторану. Например: “где теряем деньги?”, “что сделать сегодня?”, “какие скидки проверить?”, “дай скрипт для смены”.',
        mode: 'empty_question'
      });
    }

    const summary = await getSummary(restaurantId, date, period);
    const intent = classifyRestaurantQuestion(question);

    if (!process.env.OPENAI_API_KEY || shouldUseFallbackOnly(summary)) {
      return NextResponse.json({
        answer: getBrainFallbackAnswer(question, summary, intent),
        mode: process.env.OPENAI_API_KEY ? 'v8_lumora_fallback_no_real_data' : 'v8_lumora_fallback_without_openai_key',
        intent,
        dataMode: summary?.dataMode || 'unknown'
      });
    }

    const dataBrief = buildRestaurantBrainBrief(summary, intent);
    const instructions = buildRestaurantInstructions({ intent, aiMode });

    const aiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
        instructions,
        input: `Данные ресторана:\n${dataBrief}\n\nПоследние сообщения:\n${history.map((item) => `${item.role}: ${item.text}`).join('\n')}\n\nВопрос владельца: ${question}`,
        max_output_tokens: 900
      })
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('OpenAI error:', errorText);
      return NextResponse.json({
        answer: getBrainFallbackAnswer(question, summary, intent),
        mode: 'v8_lumora_fallback_after_openai_error',
        intent,
        dataMode: summary?.dataMode || 'unknown',
        providerError: 'OpenAI не ответил. Проверь OPENAI_API_KEY, OPENAI_MODEL и биллинг.'
      });
    }

    const data = await aiResponse.json();
    const rawAnswer = extractOutputText(data);
    const answer = sanitizeAnswer(rawAnswer, summary, intent, question);

    return NextResponse.json({
      answer,
      mode: 'v8_lumora_openai_brain_final',
      intent,
      model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
      dataMode: summary?.dataMode || 'unknown'
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({
      answer: 'Ошибка AI-чата. Проверь логи Vercel, OPENAI_API_KEY, OPENAI_MODEL и Supabase-переменные.',
      mode: 'v8_lumora_error'
    }, { status: 500 });
  }
}
