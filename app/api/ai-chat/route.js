import { NextResponse } from 'next/server';
import { buildDynamicSummary } from '../../../lib/sampleData';
import { getSupabaseSummary } from '../../../lib/supabaseServer';
import {
  buildRestaurantInstructions,
  classifyRestaurantQuestion,
  getBrainFallbackAnswer
} from '../../../lib/aiBrain';

const DEFAULT_MODEL = 'gpt-4.1-mini';

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

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function money(value) {
  return `${Math.round(safeNumber(value)).toLocaleString('ru-RU')} ₽`;
}

function findMetric(summary, key) {
  return safeArray(summary?.metrics).find((item) => item?.key === key) || null;
}

function metricText(summary, key, label) {
  const item = findMetric(summary, key);
  if (!item) return `${label}: нет данных`;
  return `${label}: ${item.value || money(item.raw)} (${item.delta || 'без сравнения'}, статус: ${item.status || 'neutral'})`;
}

function listLines(items, formatter, limit = 6) {
  const rows = safeArray(items).slice(0, limit);
  if (!rows.length) return 'нет данных';
  return rows.map(formatter).join('\n');
}

function buildLumoraFactBrief(summary, intent) {
  const period = summary?.period || {};
  const plan = summary?.plan || {};
  const restaurant = summary?.restaurant || {};
  const forecast = summary?.forecast || {};
  const discountAnalytics = summary?.discountAnalytics || {};
  const hourly = summary?.hourlyAnalytics || {};
  const dataQuality = summary?.dataQuality || {};
  const network = summary?.network || {};

  const revenue = safeNumber(restaurant.revenue ?? findMetric(summary, 'revenue')?.raw);
  const planRevenue = safeNumber(restaurant.plan ?? plan.activeRevenue);
  const planPercent = planRevenue ? Math.round((revenue / planRevenue) * 100) : 0;

  const topChannels = listLines(summary?.salesChannels, (item) => {
    return `- ${item.name}: ${item.revenueText || money(item.revenue)}, ${item.share ?? 0}% выручки, скидки ${item.discountsText || money(item.discounts)}, средний чек ${money(item.avgCheck)}`;
  }, 5);

  const topDishes = listLines(summary?.topDishes, (item) => {
    return `- ${item.name}: ${item.revenue}, ${item.amount}, категория ${item.category || 'не указана'}, маржа/фудкост: ${item.margin || 'не подключено'} / ${item.foodcost || 'не подключено'}`;
  }, 8);

  const weakDishes = listLines(summary?.lowDishes, (item) => {
    return `- ${item.name}: ${item.revenue}, ${item.amount}, причина: ${item.issue || 'низкая выручка за период'}`;
  }, 5);

  const waiters = listLines(summary?.waiters, (item) => {
    return `- ${item.name}: выручка ${item.revenue}, чеков ${item.checks}, средний чек ${item.avgCheck}, статус: ${item.status || 'справочно'}`;
  }, 8);

  const hourlyPeaks = listLines(summary?.hourlyPeaks || hourly?.peaks, (item) => {
    return `- ${item.label}: ${item.revenueText || money(item.revenue)}, чеков ${item.checks}, гостей ${item.guests}, доля ${item.share ?? 0}%`;
  }, 5);

  const weakHours = listLines(summary?.weakHours || hourly?.weakHours, (item) => {
    return `- ${item.label}: ${item.revenueText || money(item.revenue)}, чеков ${item.checks}, гостей ${item.guests}`;
  }, 5);

  const discountChannels = listLines(summary?.discountByChannels || discountAnalytics?.channels, (item) => {
    return `- ${item.name}: скидки ${item.discountsText || money(item.discounts)}, ${item.percentText || `${item.percent || 0}%`}, доля скидок ${item.share ?? 0}%, статус ${item.statusText || item.status || 'нет'}`;
  }, 5);

  const discountDays = listLines(summary?.discountByDays || discountAnalytics?.days, (item) => {
    return `- ${item.label || item.date}: скидки ${item.discountsText || money(item.discounts)}, ${item.percentText || `${item.percent || 0}%`}, статус ${item.statusText || item.status || 'нет'}`;
  }, 7);

  const restaurants = listLines(network?.restaurants, (item) => {
    const share = revenue ? Math.round((safeNumber(item.revenue) / revenue) * 100) : 0;
    return `- ${item.name}: выручка ${money(item.revenue)}, план ${money(item.plan)}, выполнение ${item.plan ? Math.round((safeNumber(item.revenue) / safeNumber(item.plan)) * 100) : 0}%, доля сети ${share}%, качество данных: ${item.dataQuality || 'нет пометки'}`;
  }, 6);

  const risks = listLines(summary?.moneyLosses, (item) => {
    return `- ${item.title}: ${item.amount ? money(item.amount) : '0 ₽'}, причина: ${item.reason || 'нет'}, действие: ${item.action || 'нет'}, уровень ${item.level || 'neutral'}`;
  }, 6);

  return `
КОНТЕКСТ ЗАПРОСА
- Намерение вопроса: ${intent}
- Режим данных: ${summary?.dataMode || 'unknown'}
- Период: ${period.title || `${period.startDate || ''} — ${period.endDate || ''}`}
- Ресторан/сеть: ${restaurant.name || summary?.selectedRestaurantId || 'не указано'}

ГЛАВНЫЕ KPI
- ${metricText(summary, 'revenue', 'Выручка')}
- План периода: ${money(planRevenue)}, выполнение: ${planPercent}%
- ${metricText(summary, 'checks', 'Чеки')}
- ${metricText(summary, 'guests', 'Гости')}
- ${metricText(summary, 'avgCheck', 'Средний чек')}
- ${metricText(summary, 'avgGuest', 'Средний чек гостя')}
- ${metricText(summary, 'discounts', 'Скидки')}
- ${metricText(summary, 'foodcost', 'Фудкост')}

ПРОГНОЗ
- Сейчас: ${money(forecast.current)}
- Прогноз: ${money(forecast.projected)}
- План: ${money(forecast.plan || planRevenue)}
- Риск: ${forecast.risk || 'нет'}
- Разрыв: ${money(forecast.gap)}
- Рекомендации прогноза: ${safeArray(forecast.recommendations).join('; ') || 'нет'}

КАНАЛЫ ПРОДАЖ
${topChannels}

СКИДКИ
- Всего скидок: ${discountAnalytics.totalDiscountsText || money(findMetric(summary, 'discounts')?.raw)}
- Процент скидок: ${discountAnalytics.percentText || findMetric(summary, 'discounts')?.delta || 'нет'}
- Статус: ${discountAnalytics.statusText || discountAnalytics.status || findMetric(summary, 'discounts')?.status || 'нет'}
- Главный канал скидок: ${discountAnalytics.worstChannel ? `${discountAnalytics.worstChannel.name}, ${discountAnalytics.worstChannel.discountsText}, ${discountAnalytics.worstChannel.percentText}` : 'нет'}
- День проверки: ${discountAnalytics.worstDay ? `${discountAnalytics.worstDay.label}, ${discountAnalytics.worstDay.discountsText}, ${discountAnalytics.worstDay.percentText}` : 'нет'}
- Вывод: ${discountAnalytics.insight || 'нет'}
Скидки по каналам:
${discountChannels}
Скидки по дням:
${discountDays}

ПОЧАСОВКА
- Лучший час: ${hourly.bestHour ? `${hourly.bestHour.label}, ${hourly.bestHour.revenueText}` : 'нет'}
- Слабый час: ${hourly.weakHour ? `${hourly.weakHour.label}, ${hourly.weakHour.revenueText}` : 'нет'}
- Обед 12:00–15:00: ${hourly.lunchRevenueText || 'нет'}, доля ${hourly.lunchShare || 0}%
- Вечер 18:00–22:00: ${hourly.eveningRevenueText || 'нет'}, доля ${hourly.eveningShare || 0}%
- Вывод: ${hourly.insight || 'нет'}
Пики по часам:
${hourlyPeaks}
Слабые часы:
${weakHours}

ТОЧКИ СЕТИ
${restaurants}
Важное ограничение по точкам: ${dataQuality.restaurants || 'если чеки/гости по точкам не откалиброваны, делать выводы только по выручке'}

МЕНЮ
Топ блюд:
${topDishes}
Позиции с низкой выручкой:
${weakDishes}
Важное ограничение по меню/фудкосту: ${dataQuality.foodcost || 'если себестоимость не подключена, не считать маржу и фудкост'}

ОФИЦИАНТЫ
${waiters}
Важное ограничение по официантам: ${dataQuality.waiters || 'если чеки официантов не откалиброваны, средний чек официанта только справочный'}

РИСКИ И ПОТЕНЦИАЛЬНЫЕ ПОТЕРИ
${risks}

СИГНАЛЫ КАЧЕСТВА ДАННЫХ
- KPI: ${dataQuality.kpi || 'нет'}
- Каналы: ${dataQuality.channels || 'нет'}
- Почасовка: ${dataQuality.hourly || 'нет'}
- Скидки: ${dataQuality.discounts || 'нет'}
- Меню: ${dataQuality.menu || 'нет'}
- Официанты: ${dataQuality.waiters || 'нет'}
- Точки: ${dataQuality.restaurants || 'нет'}
- Фудкост: ${dataQuality.foodcost || 'нет'}
`.trim();
}

function buildStrictInstructions({ intent, aiMode }) {
  const base = buildRestaurantInstructions({ intent, aiMode });

  return `${base}

ДОПОЛНИТЕЛЬНЫЕ ПРАВИЛА LUMORA V8
Ты — Lumora, ресторанный AI-аналитик для владельца/управляющего. Отвечай по-русски, коротко, конкретно, по делу.

Жёсткие правила:
1. Не выдумывай данные. Используй только цифры из блока “Данные ресторана”.
2. Если фудкост/себестоимость не подключены, прямо говори: “себестоимость не подключена”, не называй проценты маржи и не делай выводы по фудкосту.
3. Если официанты не откалиброваны, по ним можно говорить про выручку, но средний чек и допродажи называй справочными.
4. Если точки сети имеют ограничение по чекам/гостям, сравнивай точки только по выручке и доле, без жёстких выводов по гостям/среднему чеку.
5. Скидки оценивай в процентах от продаж, а сумму в рублях показывай как факт.
6. По почасовке используй пики и слабые часы: давай управленческие действия по смене, кухне, заготовкам и акциям.
7. В каждом ответе сначала дай вывод, потом 2–5 действий. Без длинной теории.
8. Не говори “как искусственный интеллект”.
9. Не обещай точность там, где данные помечены как частичные.
10. Если вопрос общий, всё равно привяжи ответ к выручке, плану, среднему чеку, скидкам, каналам, часам или блюдам.

Формат ответа:
- 1 короткий главный вывод.
- Затем конкретные пункты с цифрами.
- В конце: “Что сделать сейчас:” и 2–4 действия.
`;
}

function buildEnhancedFallbackAnswer(question, summary, intent) {
  const base = getBrainFallbackAnswer(question, summary, intent);
  const q = String(question || '').toLowerCase();
  const revenue = summary?.restaurant?.revenue || findMetric(summary, 'revenue')?.raw || 0;
  const plan = summary?.restaurant?.plan || summary?.plan?.activeRevenue || 0;
  const planPercent = plan ? Math.round((safeNumber(revenue) / safeNumber(plan)) * 100) : 0;
  const avgCheck = findMetric(summary, 'avgCheck')?.value || money(summary?.restaurant?.avgCheck);
  const discounts = summary?.discountAnalytics;
  const hourly = summary?.hourlyAnalytics;
  const bestDish = safeArray(summary?.topDishes)[0];
  const bestChannel = safeArray(summary?.salesChannels)[0];

  if (q.includes('скид')) {
    return [
      `Главный вывод: скидки сейчас ${discounts?.totalDiscountsText || findMetric(summary, 'discounts')?.value || 'нет данных'}, это ${discounts?.percentText || findMetric(summary, 'discounts')?.delta || 'нет процента'} от продаж.`,
      discounts?.worstChannel ? `Больше всего скидок в канале ${discounts.worstChannel.name}: ${discounts.worstChannel.discountsText}, ${discounts.worstChannel.percentText}.` : null,
      discounts?.worstDay ? `День для проверки: ${discounts.worstDay.label}, ${discounts.worstDay.discountsText}, ${discounts.worstDay.percentText}.` : null,
      'Что сделать сейчас: проверить причины скидок в главном канале, посмотреть смену/акции в день с максимальным процентом, дальше оценивать скидки именно в процентах от продаж.'
    ].filter(Boolean).join('\n');
  }

  if (q.includes('час') || q.includes('пик') || q.includes('смен')) {
    return [
      `Главный вывод: основной пик продаж ${hourly?.bestHour ? `${hourly.bestHour.label}, ${hourly.bestHour.revenueText}` : 'пока не найден'}.`,
      hourly?.insight || null,
      'Что сделать сейчас: усилить кухню и смену в часы пика, подготовить заготовки заранее, слабые часы использовать для подготовки и точечных акций.'
    ].filter(Boolean).join('\n');
  }

  if (q.includes('блюд') || q.includes('меню') || q.includes('продвиг')) {
    return [
      `Главный вывод: сильная позиция сейчас ${bestDish ? `${bestDish.name}, ${bestDish.revenue}` : 'не определена'}.`,
      'Себестоимость не подключена, поэтому маржу и фудкост по блюдам пока не оцениваем.',
      'Что сделать сейчас: продвигать топовые позиции, проверить позиции с низкой выручкой, себестоимость подключить отдельным этапом.'
    ].join('\n');
  }

  if (q.includes('деньг') || q.includes('теря') || q.includes('потер')) {
    return [
      `Главный вывод: план выполнен на ${planPercent}%, выручка ${money(revenue)} из ${money(plan)}.`,
      `Средний чек: ${avgCheck}. Главный канал выручки: ${bestChannel ? `${bestChannel.name}, ${bestChannel.revenueText}` : 'нет данных'}.`,
      discounts?.insight ? `Скидки: ${discounts.insight}` : null,
      hourly?.bestHour ? `Пик продаж: ${hourly.bestHour.label}, ${hourly.bestHour.revenueText}.` : null,
      'Что сделать сейчас: проверить план-факт, скидки по каналам, пик смены и топ блюд. Фудкост не считать до подключения себестоимости.'
    ].filter(Boolean).join('\n');
  }

  return base;
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
        answer: 'Напиши вопрос по ресторану. Например: “где теряем деньги?”, “что сделать сегодня?”, “какие скидки проверить?”, “какие блюда продвигать?”',
        mode: 'empty_question'
      });
    }

    const summary = await getSummary(restaurantId, date, period);
    const intent = classifyRestaurantQuestion(question);
    const dataBrief = buildLumoraFactBrief(summary, intent);
    const instructions = buildStrictInstructions({ intent, aiMode });

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({
        answer: buildEnhancedFallbackAnswer(question, summary, intent),
        mode: 'v8_lumora_fallback_without_openai_key',
        intent,
        dataMode: summary?.dataMode || 'demo'
      });
    }

    const aiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
        instructions,
        input: `Данные ресторана:\n${dataBrief}\n\nКороткая история диалога:\n${history.map((item) => `${item.role}: ${item.text}`).join('\n')}\n\nВопрос владельца: ${question}`,
        max_output_tokens: 1400
      })
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('OpenAI error:', errorText);
      return NextResponse.json({
        answer: buildEnhancedFallbackAnswer(question, summary, intent),
        mode: 'v8_lumora_fallback_after_openai_error',
        intent,
        dataMode: summary?.dataMode || 'demo',
        providerError: 'OpenAI не ответил. Проверь OPENAI_API_KEY, OPENAI_MODEL и биллинг.'
      });
    }

    const data = await aiResponse.json();
    const answer = extractOutputText(data) || buildEnhancedFallbackAnswer(question, summary, intent);

    return NextResponse.json({
      answer,
      mode: 'v8_lumora_openai_brain',
      intent,
      model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
      dataMode: summary?.dataMode || 'demo'
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({
      answer: 'Ошибка AI-чата. Проверь логи Vercel, OPENAI_API_KEY, OPENAI_MODEL и Supabase-переменные.',
      mode: 'v8_lumora_error'
    }, { status: 500 });
  }
}
