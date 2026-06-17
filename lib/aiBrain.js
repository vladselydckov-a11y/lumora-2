function toText(value, fallback = 'нет данных') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return toText(value);
  return `${number.toLocaleString('ru-RU')} ₽`;
}

function metric(summary, key) {
  return (summary.metrics || []).find((item) => item.key === key) || {};
}

function percentPlan(summary) {
  const revenue = Number(metric(summary, 'revenue').raw || summary.restaurant?.revenue || 0);
  const plan = Number(summary.plan?.dailyRevenue || summary.forecast?.plan || 0);
  if (!plan) return 0;
  return Math.round((revenue / plan) * 100);
}

function limit(list, count = 5) {
  return Array.isArray(list) ? list.slice(0, count) : [];
}

function lines(list, formatter, empty = 'нет данных') {
  const arr = Array.isArray(list) ? list.filter(Boolean) : [];
  if (!arr.length) return empty;
  return arr.map(formatter).join('\n');
}

export function classifyRestaurantQuestion(question = '') {
  const q = String(question).toLowerCase();
  const has = (...words) => words.some((word) => q.includes(word));

  if (has('отчет', 'отчёт', 'сводк', 'собственник', 'владелец', 'итог')) return 'owner_report';
  if (has('что делать', 'действ', 'план', 'сегодня', 'до вечера', 'задач', 'шаг')) return 'action_plan';
  if (has('деньг', 'теряем', 'потер', 'прибыл', 'марж', 'недозараб', 'слив')) return 'money_loss';
  if (has('выруч', 'касс', 'продаж', 'оборот')) return 'revenue';
  if (has('средн', 'чек', 'допрод', 'апсел', 'upsell')) return 'avg_check';
  if (has('фуд', 'себесто', 'себес', 'списан', 'закуп', 'склад')) return 'foodcost';
  if (has('скид', 'акци', 'промо')) return 'discounts';
  if (has('официант', 'сотруд', 'команд', 'персонал', 'смен')) return 'team';
  if (has('блюд', 'меню', 'позици', 'кухн', 'топ')) return 'menu';
  if (has('прогноз', 'будет', 'успеем', 'план выполн')) return 'forecast';
  if (has('сеть', 'точк', 'филиал', 'ресторан')) return 'network';
  return 'general';
}

export function buildRestaurantBrainBrief(summary, intent = 'general') {
  const revenue = metric(summary, 'revenue');
  const checks = metric(summary, 'checks');
  const avgCheck = metric(summary, 'avgCheck');
  const guests = metric(summary, 'guests');
  const foodcost = metric(summary, 'foodcost');
  const discounts = metric(summary, 'discounts');
  const plan = summary.plan || {};
  const forecast = summary.forecast || {};
  const planPercent = percentPlan(summary);

  const topDishes = lines(limit(summary.topDishes, 6), (d, i) => (
    `${i + 1}. ${d.name}: ${toText(d.amount)}, выручка ${toText(d.revenue)}, фудкост ${toText(d.foodcost)}, маржа ${toText(d.margin)}, AI: ${toText(d.ai)}`
  ));

  const lowDishes = lines(limit(summary.lowDishes, 5), (d, i) => (
    `${i + 1}. ${d.name}: ${toText(d.amount)}, выручка ${toText(d.revenue)}, причина: ${toText(d.issue)}, действие: ${toText(d.ai)}`
  ));

  const waiters = lines(limit(summary.waiters, 8), (w, i) => (
    `${i + 1}. ${w.name}: выручка ${toText(w.revenue)}, чеков ${toText(w.checks)}, средний чек ${toText(w.avgCheck)}, допродажа ${toText(w.upsell)}, статус ${toText(w.status)}`
  ));

  const losses = lines(limit(summary.moneyLosses, 5), (l, i) => (
    `${i + 1}. ${l.title}: оценка ${money(l.amount)}, причина: ${toText(l.reason)}, действие: ${toText(l.action)}, уровень: ${toText(l.level)}`
  ));

  const alerts = lines(limit(summary.alerts, 8), (a, i) => (
    `${i + 1}. ${a.title}: ${toText(a.text)}, уровень: ${toText(a.level)}`
  ));

  const week = lines(limit(summary.week, 7), (d) => (
    `${d.day} ${d.date}: выручка ${money(d.revenue)}, чеков ${toText(d.checks)}, средний чек ${money(d.avgCheck)}`
  ));

  const network = lines(limit(summary.network?.restaurants, 8), (r, i) => (
    `${i + 1}. ${r.name}: выручка ${money(r.revenue)}, план ${money(r.plan)}, средний чек ${money(r.avgCheck)}, проблема ${toText(r.problem)}, статус ${toText(r.status)}`
  ));

  const actions = lines(limit(summary.actionPlan, 6), (a, i) => (
    `${i + 1}. ${a.role}: ${a.title}. ${a.text}`
  ));

  return `КОНТЕКСТ\n` +
    `Версия продукта: v7.4 AI Brain\n` +
    `Ресторан: ${toText(summary.restaurant?.name)} (${toText(summary.restaurant?.city)})\n` +
    `Выбранный период: ${toText(summary.period?.title)}\n` +
    `Период для аудита: ${toText(summary.period?.range30 || summary.dataRange?.audit)}\n` +
    `Режим данных: ${toText(summary.dataMode)}\n` +
    `Тип вопроса: ${intent}\n\n` +
    `КЛЮЧЕВЫЕ KPI\n` +
    `Выручка: ${toText(revenue.value)}; выполнение плана: ${planPercent}%\n` +
    `План выручки: ${money(plan.dailyRevenue || forecast.plan)}\n` +
    `Чеки: ${toText(checks.value)}\n` +
    `Гости: ${toText(guests.value)}\n` +
    `Средний чек: ${toText(avgCheck.value)}; цель: ${money(plan.avgCheck)}\n` +
    `Фудкост: ${toText(foodcost.value)}; норма: ${toText(plan.foodcostMax)}%\n` +
    `Скидки: ${toText(discounts.value)}; лимит: ${money(plan.discountMax)}\n` +
    `Оценка отклонений в деньгах: ${money(summary.totalLoss)}\n\n` +
    `ПРОГНОЗ\n` +
    `Текущая выручка: ${money(forecast.current)}\n` +
    `Прогноз конца дня: ${money(forecast.projected)}\n` +
    `План: ${money(forecast.plan)}\n` +
    `Риск: ${toText(forecast.risk)}\n` +
    `Уверенность прогноза: ${toText(forecast.confidence)}%\n\n` +
    `ОТКЛОНЕНИЯ И РИСКИ\n${losses}\n\n` +
    `СИГНАЛЫ\n${alerts}\n\n` +
    `ПЛАН ДЕЙСТВИЙ\n${actions}\n\n` +
    `ТОП БЛЮД\n${topDishes}\n\n` +
    `СЛАБЫЕ БЛЮДА\n${lowDishes}\n\n` +
    `КОМАНДА\n${waiters}\n\n` +
    `НЕДЕЛЯ\n${week}\n\n` +
    `СЕТЬ / ТОЧКИ\n${network}\n\n` +
    `СКРИПТ ДЛЯ СМЕНЫ\n${toText(summary.teamScript)}`;
}

export function buildRestaurantInstructions({ intent = 'general', aiMode = 'director' } = {}) {
  return `Ты AI-операционный директор ресторана. Ты работаешь внутри управленческого mini app для владельца ресторана.\n\n` +
    `Режим анализа: ${aiMode}. Тип вопроса: ${intent}.\n\n` +
    `Главные правила:\n` +
    `1. Отвечай только по данным из блока КОНТЕКСТ.\n` +
    `2. Не выдумывай цифры, даты, сотрудников, блюда и причины.\n` +
    `3. Если данных недостаточно, прямо скажи, каких данных не хватает.\n` +
    `4. Не пересказывай весь JSON. Дай управленческий вывод.\n` +
    `5. Пиши по-русски, простыми словами для владельца ресторана.\n` +
    `6. Всегда связывай вывод с деньгами, планом, средним чеком, фудкостом, скидками, командой или меню.\n` +
    `7. Не говори “возможно” без причины. Если делаешь гипотезу, подпиши: “гипотеза”.\n\n` +
    `Формат ответа:\n` +
    `Короткий вывод: 1-2 предложения.\n\n` +
    `Что видно по цифрам:\n` +
    `1. ...\n` +
    `2. ...\n` +
    `3. ...\n\n` +
    `Что сделать сейчас:\n` +
    `1. ...\n` +
    `2. ...\n` +
    `3. ...\n\n` +
    `Если уместно, добавь блок “Чего не хватает для точности”.\n\n` +
    `Пример хорошего ответа на вопрос “где теряем деньги?”:\n` +
    `Короткий вывод: основные отклонения сейчас в плане, среднем чеке, фудкосте и скидках. Самый быстрый рычаг на сегодня — поднять средний чек через допродажи.\n\n` +
    `Что видно по цифрам:\n` +
    `1. План выполнен не полностью, значит есть недобор по выручке.\n` +
    `2. Средний чек ниже цели, каждый чек приносит меньше денег, чем должен.\n` +
    `3. Фудкост или скидки выше нормы съедают маржу.\n\n` +
    `Что сделать сейчас:\n` +
    `1. Дать официантам конкретный скрипт: напиток или десерт к каждому второму чеку.\n` +
    `2. Проверить скидки по смене и сотрудникам.\n` +
    `3. Проверить себестоимость топ-блюд и списания.`;
}

export function getBrainFallbackAnswer(question, summary, intent = 'general') {
  const revenue = metric(summary, 'revenue');
  const avgCheck = metric(summary, 'avgCheck');
  const foodcost = metric(summary, 'foodcost');
  const discounts = metric(summary, 'discounts');
  const plan = summary.plan || {};
  const planPercent = percentPlan(summary);
  const losses = limit(summary.moneyLosses, 4).filter((item) => Number(item.amount) > 0);
  const weakWaiter = limit(summary.waiters, 8).sort((a, b) => Number(a.rawAvgCheck || 0) - Number(b.rawAvgCheck || 0))[0];
  const topDish = limit(summary.topDishes, 1)[0];
  const lowDish = limit(summary.lowDishes, 1)[0];

  const base = `Короткий вывод: по данным видно, что ресторан сейчас делает ${toText(revenue.value)} при выполнении плана ${planPercent}%. Главные зоны контроля: средний чек ${toText(avgCheck.value)} при цели ${money(plan.avgCheck)}, фудкост ${toText(foodcost.value)} и скидки ${toText(discounts.value)}.`;

  if (intent === 'money_loss') {
    return `${base}\n\nЧто видно по цифрам:\n${losses.map((item, index) => `${index + 1}. ${item.title}: ${money(item.amount)}. Причина: ${item.reason}.`).join('\n') || '1. Явных денежных отклонений по текущим правилам нет.'}\n\nЧто сделать сейчас:\n1. Начать со среднего чека: напиток, десерт или комбо к каждому второму чеку.\n2. Проверить скидки по сотрудникам и сменам.\n3. Проверить фудкост топ-блюд и списания.`;
  }

  if (intent === 'team') {
    return `${base}\n\nЧто видно по команде:\n1. Слабая зона: ${weakWaiter ? `${weakWaiter.name}, средний чек ${weakWaiter.avgCheck}` : 'нет данных по официантам'}.\n2. Команде нужен простой фокус на допродажу, а не общий призыв “продавайте больше”.\n\nЧто сделать сейчас:\n1. Дать скрипт: “к основному блюду предложить напиток, к кофе предложить десерт”.\n2. Сравнить средний чек по сменам.\n3. Разобрать слабого сотрудника отдельно, без давления на всю команду.`;
  }

  if (intent === 'menu') {
    return `${base}\n\nЧто видно по меню:\n1. Сильная позиция: ${topDish ? `${topDish.name}, выручка ${topDish.revenue}` : 'нет данных'}.\n2. Слабая позиция: ${lowDish ? `${lowDish.name}, причина: ${lowDish.issue}` : 'нет данных'}.\n\nЧто сделать сейчас:\n1. Продвигать сильную позицию через официантов и комбо.\n2. Слабую позицию либо вынести в допродажу, либо убрать из фокуса.\n3. Проверить фудкост блюда, которое даёт много выручки.`;
  }

  if (intent === 'owner_report') {
    return `Короткий вывод: ресторан за выбранный день показывает ${toText(revenue.value)} выручки, выполнение плана ${planPercent}%, средний чек ${toText(avgCheck.value)}, фудкост ${toText(foodcost.value)}.\n\nЧто важно для владельца:\n1. План-факт: ${planPercent}% выполнения.\n2. Средний чек: ${toText(avgCheck.value)} при цели ${money(plan.avgCheck)}.\n3. Скидки: ${toText(discounts.value)} при лимите ${money(plan.discountMax)}.\n\nЧто сделать сейчас:\n1. Дать фокус смене на допродажи.\n2. Проверить скидки по сотрудникам.\n3. Разобрать фудкост топ-блюд.`;
  }

  return `${base}\n\nЧто видно по цифрам:\n1. План-факт: ${planPercent}% выполнения.\n2. Средний чек: ${toText(avgCheck.value)}.\n3. Фудкост: ${toText(foodcost.value)}.\n\nЧто сделать сейчас:\n1. Поднять средний чек через конкретный скрипт допродажи.\n2. Проверить скидки и ручные корректировки.\n3. Проверить себестоимость топ-блюд.`;
}
