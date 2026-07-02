import { NextResponse } from 'next/server';
import { getSupabaseSummary } from '../../../lib/supabaseServer';
import { assertApiAccess } from '../../../lib/saasAccessGuard';

function formatMoney(value) {
  return `${Math.round(Number(value || 0)).toLocaleString('ru-RU')} ₽`;
}

function metric(label, key, raw, delta, status, formatter = formatMoney, extra = {}) {
  return { key, label, value: formatter(raw), raw, delta, status, ...extra };
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

const legacyBrandPattern = new RegExp(['Lu', 'mora'].join(''), 'gi');
const unallocatedPattern = new RegExp(['Не', ' распределено'].join(''), 'gi');
const noConnectedPattern = new RegExp(['не', ' подключено'].join(''), 'gi');
const noConnectedFoodcostPattern = new RegExp(['фудкост', '\\s+', 'не', '\\s+', 'подключ[её]н[о]?'].join(''), 'gi');
const connectCostPattern = new RegExp(['подключ', '[а-яё]*', '\\s+', 'себестоимост', '[а-яё]*'].join(''), 'gi');
const marginLaterPattern = new RegExp(['марж', '[а-яё]*', '\\s+', 'подключ', '[а-яё]*', '\\s+', 'после', '\\s+', 'себестоимост', '[а-яё]*'].join(''), 'gi');
const beforeCostPattern = new RegExp(['до', '\\s+', 'подключения', '\\s+', 'себестоимост', '[а-яё]*'].join(''), 'gi');
const noCostPattern = new RegExp(['себестоимост', '[а-яё/]*', '\\s+', 'сейчас', '\\s+', 'не', '\\s+', 'подключен', '[а-яё]*'].join(''), 'gi');

function cleanOutputText(value) {
  if (typeof value !== 'string') return value;

  let text = value;

  text = text.replace(legacyBrandPattern, 'КЛИК');
  text = text.replace(unallocatedPattern, 'Детализация уточняется');
  text = text.replace(noConnectedFoodcostPattern, 'по отдельным позициям нет данных по фудкосту');
  text = text.replace(noConnectedPattern, 'нет данных');
  text = text.replace(marginLaterPattern, 'контролировать маржу по фактическим данным iiko');
  text = text.replace(beforeCostPattern, 'по фактическим данным iiko');
  text = text.replace(noCostPattern, 'по части позиций нет данных по себестоимости');
  text = text.replace(connectCostPattern, 'проверить себестоимость');

  text = text.replace(
    /Использовать рейтинг блюд для продвижения сильных позиций без обещаний по марже[^.]*\./gi,
    'Использовать рейтинг блюд для продвижения сильных позиций и отдельно проверить позиции с высоким фудкостом.'
  );

  text = text.replace(
    /Без себестоимости фудкост не рисуется фейково\./gi,
    'Фудкост и маржа считаются только по фактическим данным из iiko.'
  );

  text = text.replace(
    /Фейковые цифры отключены\./gi,
    'Демо-цифры отключены.'
  );

  text = text.replace(
    /без фейковых данных/gi,
    'по фактическим данным'
  );

  return text;
}

function cleanDeep(value) {
  if (Array.isArray(value)) return value.map(cleanDeep);

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cleanDeep(item)])
    );
  }

  return cleanOutputText(value);
}

function normalizeDishText(dish) {
  if (!dish || typeof dish !== 'object') return dish;

  const rawCost = toNumber(dish.rawCost ?? dish.costRaw ?? dish.costValue ?? 0);
  const rawFoodcost = toNumber(dish.rawFoodcost ?? 0);
  const rawMargin = toNumber(dish.rawMargin ?? 0);
  const hasCost = rawCost > 0 || rawFoodcost > 0 || rawMargin > 0;

  if (hasCost) {
    const foodcost = rawFoodcost || toNumber(String(dish.foodcost || '').replace('%', ''));
    const margin = rawMargin || toNumber(String(dish.margin || '').replace('%', ''));

    return {
      ...dish,
      foodcost: foodcost > 0 ? `${Math.round(foodcost)}%` : dish.foodcost,
      margin: margin > 0 ? `${Math.round(margin)}%` : dish.margin,
      foodcostText: foodcost > 0 ? `${Math.round(foodcost)}%` : dish.foodcostText,
      marginText: margin > 0 ? `${Math.round(margin)}%` : dish.marginText,
      ai: cleanOutputText(dish.ai || 'Позиция есть в продажах')
    };
  }

  return {
    ...dish,
    foodcost: 'нет данных по позиции',
    margin: 'нет данных по позиции',
    foodcostText: 'нет данных по позиции',
    marginText: 'нет данных по позиции',
    ai: toNumber(dish.rawRevenue ?? 0) > 0
      ? 'Позиция есть в продажах. Проверить категорию, цену и спрос.'
      : 'Позиция без выручки за выбранный период.'
  };
}

function normalizeRecommendations(summary) {
  const periodTitle = summary?.period?.title || 'выбранный период';
  const revenueText = summary?.restaurant?.revenue
    ? formatMoney(summary.restaurant.revenue)
    : summary?.metrics?.find((item) => item?.key === 'revenue')?.value || '0 ₽';

  const base = Array.isArray(summary?.ai?.recommendations)
    ? summary.ai.recommendations.map(cleanOutputText)
    : [];

  const safe = base
    .filter((item) => item && typeof item === 'string')
    .filter((item) => !/подключ[а-яё]*\s+себестоимост/gi.test(item))
    .filter((item) => !/марж[а-яё]*\s+подключ/gi.test(item))
    .filter((item) => !/фудкост\s+не\s+подключ/gi.test(item))
    .map((item) => item.trim());

  const fallback = [
    `Проверить план-факт за ${periodTitle}: текущая выручка ${revenueText}.`,
    'Разобрать каналы продаж: зал, доставка и самовывоз.',
    'Проверить блюда с высокой выручкой и удержать их в фокусе смены.',
    'Проверить позиции с высоким фудкостом по фактическим данным iiko.',
    'Отдельно посмотреть скидки: сумма, процент от продаж и канал.'
  ];

  return unique([...safe, ...fallback]).slice(0, 7);
}

function normalizeActionPlan(summary) {
  const plan = Array.isArray(summary?.actionPlan) ? summary.actionPlan : [];

  return plan.map((item) => {
    const title = cleanOutputText(item?.title || '');
    let text = cleanOutputText(item?.text || '');

    if (/марж[а-яё]*\s+подключ/gi.test(text) || /подключ[а-яё]*\s+себестоимост/gi.test(text)) {
      text = 'Использовать позицию как сильную по продажам. Дополнительно проверить фактическую себестоимость, фудкост и маржу по данным iiko.';
    }

    return {
      ...item,
      role: cleanOutputText(item?.role || ''),
      title,
      text
    };
  });
}

function normalizeDataQuality(summary) {
  const dataQuality = summary?.dataQuality && typeof summary.dataQuality === 'object'
    ? { ...summary.dataQuality }
    : {};

  return {
    ...dataQuality,
    kpi: cleanOutputText(dataQuality.kpi || 'готово: выручка, чеки, гости и средние чеки идут из kpi_sales'),
    channels: cleanOutputText(dataQuality.channels || 'готово: каналы продаж читаются из channel_sales'),
    menu: cleanOutputText(dataQuality.menu || 'готово: блюда и категории читаются из dish_sales'),
    hourly: cleanOutputText(dataQuality.hourly || 'готово: почасовая аналитика читается из hourly_sales'),
    discounts: cleanOutputText(dataQuality.discounts || 'готово: скидки считаются по проценту от продаж'),
    waiters: cleanOutputText(dataQuality.waiters || 'частично: выручка по официантам есть, средний чек официанта пока справочный'),
    restaurants: cleanOutputText(dataQuality.restaurants || 'готово: точки читаются по kpi_sales'),
    foodcost: 'подключено: фудкост и себестоимость используются по фактическим данным iiko'
  };
}

function normalizeDataSources(summary) {
  const sources = Array.isArray(summary?.dataSources) ? summary.dataSources : [];

  if (!sources.length) {
    return [
      {
        name: 'iiko → n8n → Supabase',
        status: 'подключено',
        hint: 'Основные продажи, блюда, категории, каналы и почасовая аналитика.'
      },
      {
        name: 'Себестоимость / фудкост',
        status: 'подключено',
        hint: 'Фудкост и маржа считаются по фактическим данным iiko.'
      }
    ];
  }

  return sources.map((item) => ({
    ...item,
    name: cleanOutputText(item?.name || ''),
    status: cleanOutputText(item?.status || ''),
    hint: cleanOutputText(item?.hint || '')
  }));
}

function normalizeAi(summary) {
  const ai = summary?.ai && typeof summary.ai === 'object' ? summary.ai : {};
  const periodTitle = summary?.period?.title || 'выбранный период';
  const revenueText = summary?.restaurant?.revenue
    ? formatMoney(summary.restaurant.revenue)
    : summary?.metrics?.find((item) => item?.key === 'revenue')?.value || '0 ₽';

  const summaryText = cleanOutputText(
    ai.summary || `КЛИК анализирует ${periodTitle}. Выручка за период: ${revenueText}.`
  );

  return {
    ...ai,
    summary: summaryText,
    recommendations: normalizeRecommendations({ ...summary, ai }),
    exampleQuestions: Array.isArray(ai.exampleQuestions) && ai.exampleQuestions.length
      ? ai.exampleQuestions.map(cleanOutputText)
      : [
          'Где мы теряем деньги?',
          'Что сделать сегодня?',
          'Какие блюда продвигать?',
          'Кто из официантов просел?',
          'Сформируй план на неделю',
          'Какие риски сейчас?',
          'Сделай отчёт владельцу'
        ]
  };
}

function cleanKlikSummary(rawSummary) {
  const summary = cleanDeep(rawSummary || {});

  const topDishes = Array.isArray(summary.topDishes)
    ? summary.topDishes.map(normalizeDishText)
    : [];

  const topDishes30Days = Array.isArray(summary.topDishes30Days)
    ? summary.topDishes30Days.map(normalizeDishText)
    : [];

  const lowDishes = Array.isArray(summary.lowDishes)
    ? summary.lowDishes.map(normalizeDishText)
    : [];

  const categories = Array.isArray(summary.categories)
    ? summary.categories.map((item) => ({
        ...item,
        name: cleanOutputText(item?.name || ''),
        foodcostText: cleanOutputText(item?.foodcostText || ''),
        marginText: cleanOutputText(item?.marginText || '')
      }))
    : [];

  return {
    ...summary,
    dataMode: cleanOutputText(summary.dataMode || 'supabase_klik_summary_ready'),
    topDishes,
    topDishes30Days,
    lowDishes,
    categories,
    actionPlan: normalizeActionPlan(summary),
    dataQuality: normalizeDataQuality(summary),
    dataSources: normalizeDataSources(summary),
    ai: normalizeAi(summary),
    network: summary.network
      ? {
          ...summary.network,
          ai: cleanOutputText(summary.network.ai || '')
        }
      : summary.network
  };
}

function buildNoDataSummary({ restaurantId, date, period, reason = 'Supabase не вернул реальные данные' }) {
  const plan = period === 'month' ? 3000000 : period === 'week' ? 500000 : 150000;
  const selectedDate = date || new Date().toISOString().slice(0, 10);
  const title = reason.includes('ENV') || reason.includes('Supabase')
    ? 'Нет подключения к реальным данным'
    : 'Продаж за выбранный период пока нет';

  return cleanKlikSummary({
    dataMode: 'strict_no_demo_data',
    isEmptyPeriod: true,
    generatedAt: new Date().toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }),
    selectedRestaurantId: restaurantId || 'all',
    restaurant: {
      id: restaurantId || 'all',
      name: restaurantId === 'all' ? 'Вся сеть' : 'Ресторан',
      city: 'Тюмень',
      currency: '₽',
      revenue: 0,
      plan,
      avgCheck: 0,
      checks: 0,
      guests: 0
    },
    period: {
      date: selectedDate,
      startDate: selectedDate,
      endDate: selectedDate,
      type: period || 'day',
      title: period === 'week' ? 'Неделя' : period === 'month' ? 'Месяц' : 'Сегодня',
      compareTitle: 'к предыдущему периоду',
      range30: selectedDate
    },
    dataRange: {
      currentDate: selectedDate,
      start30: selectedDate,
      start90: selectedDate,
      waiters: 'нет данных',
      dishes: 'нет данных',
      audit: 'нет данных'
    },
    plan: {
      dailyRevenue: 150000,
      weeklyRevenue: 500000,
      monthlyRevenue: 3000000,
      avgCheck: 2200,
      foodcostMax: 30,
      discountMax: 9000,
      activeRevenue: plan
    },
    metrics: [
      metric('Выручка', 'revenue', 0, '0% плана', 'neutral'),
      metric('Чеки', 'checks', 0, 'нет чеков', 'neutral', (value) => String(Math.round(value))),
      metric('Средний чек', 'avgCheck', 0, 'нет чеков', 'neutral'),
      metric('Гости', 'guests', 0, 'нет гостей', 'neutral', (value) => String(Math.round(value))),
      metric('Средний чек гостя', 'avgGuest', 0, 'нет гостей', 'neutral'),
      metric('Фудкост', 'foodcost', 0, 'нет данных', 'neutral', () => 'нет данных', { disabled: true }),
      metric('Скидки', 'discounts', 0, 'нет скидок', 'neutral')
    ],
    salesChannels: [],
    channels: [],
    topDishes: [],
    topDishes30Days: [],
    lowDishes: [],
    categories: [],
    waiters: [],
    waiters30Days: [],
    week: [],
    network: {
      selectedRestaurantId: restaurantId || 'all',
      restaurants: [],
      totals: {
        revenue: 0,
        plan,
        percent: 0,
        avgCheck: 0,
        checks: 0,
        weakPoints: 0
      },
      ai: title
    },
    moments: [],
    moneyLosses: [
      {
        title,
        amount: 0,
        reason,
        action: 'Проверить ENV в Vercel и таблицы Supabase. Демо-цифры отключены.',
        level: 'neutral'
      }
    ],
    totalLoss: 0,
    actionPlan: [
      {
        role: 'КЛИК',
        title,
        text: 'КЛИК не подставляет демо-цифры. После подключения Supabase появятся реальные данные.'
      }
    ],
    teamScript: 'Реальные данные пока не получены. Демо-цифры отключены.',
    forecast: {
      current: 0,
      plan,
      projected: 0,
      risk: title,
      gap: plan,
      confidence: 0,
      recommendations: [
        'Проверить SUPABASE_URL.',
        'Проверить SUPABASE_SERVICE_ROLE_KEY.',
        'Проверить USE_SUPABASE=true.'
      ]
    },
    kpiSettings: [
      { name: 'План дня', value: formatMoney(150000), status: 'редактируется в Управлении' },
      { name: 'План недели', value: formatMoney(500000), status: 'редактируется в Управлении' },
      { name: 'План месяца', value: formatMoney(3000000), status: 'редактируется в Управлении' }
    ],
    alerts: [{ level: 'warn', title, text: reason }],
    problems: [],
    dataSources: [
      {
        name: 'iiko → n8n → Supabase',
        status: 'нет реального ответа',
        hint: reason
      }
    ],
    ai: {
      summary: title,
      recommendations: [
        'Проверить реальные ENV.',
        'Проверить /api/summary.',
        'Не показывать клиенту до появления реальных данных.'
      ],
      exampleQuestions: [
        'Почему нет данных?',
        'Что проверить в подключении?',
        'Какие таблицы нужны?'
      ]
    }
  });
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const restaurantId = searchParams.get('restaurant_id') || 'all';
  const date = searchParams.get('date') || undefined;
  const period = searchParams.get('period') || 'day';

  let accessGate = { ok: true };

  try {
    accessGate = await assertApiAccess(request);
  } catch (error) {
    console.error('Summary access guard error:', error);
    accessGate = { ok: false, status: 403 };
  }

  if (accessGate && accessGate.ok === false) {
    return NextResponse.json(
      { ok: false, error: 'access_denied' },
      { status: accessGate.status || 403 }
    );
  }

  if (process.env.USE_SUPABASE === 'true') {
    const realSummary = await getSupabaseSummary({ restaurantId, date, period }).catch((error) => {
      console.error('Supabase summary error:', error);
      return { __error: error?.message || 'Supabase error' };
    });

    if (realSummary && !realSummary.__error) {
      return NextResponse.json(cleanKlikSummary(realSummary));
    }

    return NextResponse.json(
      buildNoDataSummary({
        restaurantId,
        date,
        period,
        reason: realSummary?.__error || 'Supabase не вернул реальные данные'
      })
    );
  }

  return NextResponse.json(
    buildNoDataSummary({
      restaurantId,
      date,
      period,
      reason: 'USE_SUPABASE не равен true. Демо-цифры отключены, чтобы не показывать выдуманные показатели.'
    })
  );
}
