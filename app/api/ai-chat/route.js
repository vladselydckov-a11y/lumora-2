import { NextResponse } from 'next/server';
import { buildDynamicSummary } from '../../../lib/sampleData';
import { getSupabaseSummary } from '../../../lib/supabaseServer';
import {
  buildRestaurantBrainBrief,
  buildRestaurantInstructions,
  classifyRestaurantQuestion,
  getBrainFallbackAnswer
} from '../../../lib/aiBrain';

async function getSummary(restaurantId, date, period) {
  if (process.env.USE_SUPABASE === 'true') {
    const realSummary = await getSupabaseSummary({ restaurantId, date, period }).catch((error) => {
      console.error('AI Supabase summary error:', error);
      return null;
    });
    if (realSummary) return realSummary;
  }
  return buildDynamicSummary({ restaurantId });
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

export async function POST(request) {
  try {
    const body = await request.json();
    const restaurantId = body?.restaurant_id || body?.restaurantId || 'all';
    const aiMode = body?.ai_mode || body?.aiMode || 'director';
    const date = body?.date || undefined;
    const period = body?.period || 'day';
    const history = Array.isArray(body?.history) ? body.history.slice(-6) : [];
    const question = String(body?.question || '').trim();

    if (!question) {
      return NextResponse.json({
        answer: 'Напиши вопрос по ресторану. Например: “где теряем деньги?”, “что сделать сегодня?”, “какие блюда продвигать?”, “кто из официантов просел?”',
        mode: 'empty_question'
      });
    }

    const summary = await getSummary(restaurantId, date, period);
    const intent = classifyRestaurantQuestion(question);
    const dataBrief = buildRestaurantBrainBrief(summary, intent);
    const instructions = buildRestaurantInstructions({ intent, aiMode });

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({
        answer: getBrainFallbackAnswer(question, summary, intent),
        mode: 'v7_4_fallback_without_openai_key',
        intent,
        dataMode: summary.dataMode || 'demo'
      });
    }

    const aiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        instructions,
        input: `Данные ресторана:\n${dataBrief}\n\nКороткая история диалога:\n${history.map((item) => `${item.role}: ${item.text}`).join('\n')}\n\nВопрос владельца: ${question}`,
        max_output_tokens: 1200
      })
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('OpenAI error:', errorText);
      return NextResponse.json({
        answer: getBrainFallbackAnswer(question, summary, intent),
        mode: 'v7_4_fallback_after_openai_error',
        intent,
        dataMode: summary.dataMode || 'demo',
        providerError: 'OpenAI не ответил. Проверь OPENAI_API_KEY, OPENAI_MODEL и биллинг.'
      });
    }

    const data = await aiResponse.json();
    const answer = extractOutputText(data) || getBrainFallbackAnswer(question, summary, intent);

    return NextResponse.json({
      answer,
      mode: 'v7_4_openai_brain',
      intent,
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      dataMode: summary.dataMode || 'demo'
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({
      answer: 'Ошибка AI-чата. Проверь логи Vercel, OPENAI_API_KEY, OPENAI_MODEL и Supabase-переменные.',
      mode: 'v7_4_error'
    }, { status: 500 });
  }
}
