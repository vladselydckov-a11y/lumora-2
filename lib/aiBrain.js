function safeText(value, fallback = 'нет данных') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
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

function metricValue(summary, key, fallback = 'нет данных') {
  const item = findMetric(summary, key);
  return item?.value || (item?.raw !== undefined ? money(item.raw) : fallback);
}

function getPlanPercent(summary) {
  const revenue = safeNumber(summary?.restaurant?.revenue ?? findMetric(summary, 'revenue')?.raw);
  const plan = safeNumber(summary?.restaurant?.plan ?? summary?.plan?.activeRevenue ?? summary?.forecast?.plan);
  return plan ? Math.round((revenue / plan) * 100) : 0;
}

function first(list) {
  return safeArray(list)[0] || null;
}

function compactLines(items, formatter, limit = 5, empty = 'нет данных') {
  const rows = safeArray(items).filter(Boolean).slice(0, limit);
  if (!rows.length) return empty;
  return rows.map(formatter).join('\n');
}

export function classifyRestaurantQuestion(question = '') {
  const q = String(question).toLowerCase();
  const has = (...words) => words.some((word) => q.includes(word));

  if (has('отчет', 'отчёт', 'сводк', 'собственник', 'владелец', 'итог')) return 'owner_report';
  if (has('скрипт', 'смене', 'смены', 'командный текст', 'сообщение команде')) return 'shift_script';
  if (has('риск', 'опас', 'проверить по рискам', 'что проверить')) return 'risks';
  if (has('скид', 'акци', 'промо')) return 'discounts';
  if (has('блюд', 'меню', 'позици', 'кухн', 'топ', 'продвиг')) return 'menu';
  if (has('официант', 'сотруд', 'команд', 'персонал')) return 'team';
  if (has('час', 'пик', 'почас', 'вечер', 'обед')) return 'hourly';
  if (has('что делать', 'действ', 'план', 'сегодня', 'до вечера', 'задач', 'шаг', 'недел')) return 'action_plan';
  if (has('деньг', 'теряем', 'потер', 'прибыл', 'марж', 'недозараб', 'слив')) return 'money_loss';
  if (has('выруч', 'касс', 'продаж', 'оборот')) return 'revenue';
  if (has('средн', 'чек', 'допрод', 'апсел', 'upsell')) return 'avg_check';
  if (has('фуд', 'себесто', 'себес', 'списан', 'закуп', 'склад')) return 'foodcost';
  if (has('прогноз', 'будет', 'успеем', 'план выполн')) return 'forecast';
  if (has('сеть', 'точк', 'филиал', 'ресторан')) return 'network';
  return 'general';
}

export function buildRestaurantBrainBrief(summary, intent = 'general') {
  const period = summary?.period || {};
  const restaurant = summary?.restaurant || {};
  const plan = summary?.plan || {};
  const forecast = summary?.forecast || {};
  const discount = summary?.discountAnalytics || {};
  const hourly = summary?.hourlyAnalytics || {};
  const dataQuality = summary?.dataQuality || {};
  const revenue = safeNumber(restaurant.revenue ?? findMetric(summary, 'revenue')?.raw);
  const planValue = safeNumber(restaurant.plan ?? plan.activeRevenue ?? forecast.plan);
  const planPercent = planValue ? Math.round((revenue / planValue) * 100) : getPlanPercent(summary);

  return `
КОНТЕКСТ КЛИК
- Тип вопроса: ${intent}
- Данные: ${safeText(summary?.dataMode)}
- Период: ${safeText(period.title || `${period.startDate || ''} — ${period.endDate || ''}`)}
- Ресторан/сеть: ${safeText(restaurant.name || summary?.selectedRestaurantId)}

KPI
- Выручка: ${money(revenue)}
- План периода: ${money(planValue)}
- Выполнение плана: ${planPercent}%
- Чеки: ${metricValue(summary, 'checks')}
- Гости: ${metricValue(summary, 'guests')}
- Средний чек: ${metricValue(summary, 'avgCheck')}; цель ${money(plan.avgCheck)}
- Средний чек гостя: ${metricValue(summary, 'avgGuest')}
- Скидки: ${metricValue(summary, 'discounts')}
- Фудкост: ${metricValue(summary, 'foodcost')}

КАНАЛЫ
${compactLines(summary?.salesChannels, (item) => `- ${item.name}: ${item.revenueText || money(item.revenue)}, доля ${item.share ?? 0}%, скидки ${item.discountsText || money(item.discounts)}`, 5)}

СКИДКИ
- Всего: ${discount.totalDiscountsText || metricValue(summary, 'discounts')}
- Процент: ${discount.percentText || findMetric(summary, 'discounts')?.delta || 'нет'}
- Главный канал проверки: ${discount.worstChannel ? `${discount.worstChannel.name}, ${discount.worstChannel.discountsText}, ${discount.worstChannel.percentText}` : 'нет'}
- День проверки: ${discount.worstDay ? `${discount.worstDay.label}, ${discount.worstDay.discountsText}, ${discount.worstDay.percentText}` : 'нет'}
- Вывод: ${safeText(discount.insight, 'нет')}

ПОЧАСОВКА
- Лучший час: ${hourly.bestHour ? `${hourly.bestHour.label}, ${hourly.bestHour.revenueText}` : 'нет'}
- Вечер 18:00–22:00: ${hourly.eveningRevenueText || 'нет'}, ${hourly.eveningShare || 0}% выручки
- Обед 12:00–15:00: ${hourly.lunchRevenueText || 'нет'}, ${hourly.lunchShare || 0}% выручки
- Слабые часы: ${compactLines(summary?.weakHours || hourly.weakHours, (item) => `${item.label} ${item.revenueText || money(item.revenue)}`, 5, 'нет')}

БЛЮДА
Топ:
${compactLines(summary?.topDishes, (item) => `- ${item.name}: ${item.revenue}, ${item.amount}, категория ${item.category || 'нет'}, фудкост/маржа: ${item.foodcost || 'не подключено'} / ${item.margin || 'не подключено'}`, 8)}
Позиции с низкой выручкой:
${compactLines(summary?.lowDishes, (item) => `- ${item.name}: ${item.revenue}, ${item.amount}, причина ${item.issue || 'низкая выручка'}`, 5)}

ОФИЦИАНТЫ
${compactLines(summary?.waiters, (item) => `- ${item.name}: выручка ${item.revenue}, чеки ${item.checks}, средний чек ${item.avgCheck}, статус ${item.status || 'справочно'}`, 8)}

ТОЧКИ
${compactLines(summary?.network?.restaurants, (item) => `- ${item.name}: выручка ${money(item.revenue)}, план ${money(item.plan)}, статус ${item.status}, качество данных ${item.dataQuality || 'нет'}`, 6)}

РИСКИ / ДЕЙСТВИЯ
${compactLines(summary?.moneyLosses, (item) => `- ${item.title}: ${item.amount ? money(item.amount) : '0 ₽'}, причина ${item.reason || 'нет'}, действие ${item.action || 'нет'}, уровень ${item.level || 'neutral'}`, 6)}

ПЛАН ДЕЙСТВИЙ
${compactLines(summary?.actionPlan, (item) => `- ${item.role}: ${item.title}. ${item.text}`, 6)}

СКРИПТ ДЛЯ СМЕНЫ
${safeText(summary?.teamScript, 'нет')}

ОГРАНИЧЕНИЯ ДАННЫХ
- Фудкост: ${dataQuality.foodcost || 'если не подключён, не считать маржу и себестоимость'}
- Официанты: ${dataQuality.waiters || 'если не откалиброваны, средний чек только справочно'}
- Точки: ${dataQuality.restaurants || 'если не откалиброваны, сравнивать только выручку'}
`.trim();
}

export function buildRestaurantInstructions({ intent = 'general', aiMode = 'director' } = {}) {
  const intentRules = {
    owner_report: 'Сделай отчёт владельцу: итог, что хорошо, что проверить, что сделать. Не добавляй длинную теорию.',
    shift_script: 'Дай готовый текст для смены, который можно скопировать в рабочий чат. Не делай общий анализ.',
    risks: 'Покажи 3–5 рисков и что проверить первым. Не повторяй все KPI.',
    discounts: 'Говори только про скидки: общий процент, канал, день проверки, действия.',
    menu: 'Говори про блюда и меню. Не оценивай маржу, если себестоимость не подключена.',
    team: 'Говори по официантам осторожно: выручка можно, средний чек справочно, без обвинений конкретного человека.',
    hourly: 'Говори по часам: пик, слабые часы, смена, кухня, заготовки.',
    action_plan: 'Дай конкретный план действий на выбранный период, без повторения всех KPI.',
    money_loss: 'Покажи, где могут быть потери: план-факт, скидки, средний чек, фудкост только если подключён.',
    forecast: 'Говори про прогноз, план и разрыв до плана.',
    network: 'Говори про точки сети только по выручке и доле, если чеки/гости не откалиброваны.',
    foodcost: 'Если себестоимость не подключена, честно скажи это и не считай фудкост.',
    general: 'Ответь по вопросу, не повторяя весь общий отчёт.'
  };

  return `Ты КЛИК, ресторанный AI-аналитик для владельца и управляющего.

Режим: ${aiMode}. Намерение: ${intent}.
Задача намерения: ${intentRules[intent] || intentRules.general}

Жёсткие правила:
1. Используй только цифры из блока “Данные ресторана”.
2. Не выдумывай фудкост, себестоимость, маржу, причины скидок, имена сотрудников и даты.
3. Если фудкост/себестоимость не подключены, пиши: “себестоимость не подключена”, и не делай выводы по марже.
4. По официантам не называй “слабый сотрудник”, если данные по чекам не откалиброваны. Можно писать: “по выручке ниже других” или “нужно проверить отдельно”.
5. По точкам сети сравнивай только выручку и долю, если чеки/гости по точкам помечены как требующие калибровки.
6. Скидки оценивай по проценту от продаж, рубли показывай как факт.
7. Не повторяй один и тот же общий блок KPI в каждом ответе. Отвечай строго на заданный вопрос.
8. Формулировки должны быть клиентскими, без внутренней технички и без слов “JSON”, “таблица”, “модель”.
9. Если данных не хватает, назови ровно какие данные нужны.

Формат:
Главный вывод: одно короткое предложение.

Детали:
1. ...
2. ...
3. ...

Что сделать сейчас:
1. ...
2. ...
3. ...

Для скрипта смены вместо этого формата дай сразу готовый текст для команды.`;
}

export function getBrainFallbackAnswer(question, summary, intent = 'general') {
  const revenue = safeNumber(summary?.restaurant?.revenue ?? findMetric(summary, 'revenue')?.raw);
  const plan = safeNumber(summary?.restaurant?.plan ?? summary?.plan?.activeRevenue ?? summary?.forecast?.plan);
  const planPercent = plan ? Math.round((revenue / plan) * 100) : getPlanPercent(summary);
  const avgCheck = metricValue(summary, 'avgCheck');
  const avgCheckTarget = money(summary?.plan?.avgCheck);
  const discounts = summary?.discountAnalytics || {};
  const hourly = summary?.hourlyAnalytics || {};
  const bestChannel = first(summary?.salesChannels);
  const topDish = first(summary?.topDishes);
  const lowDish = first(summary?.lowDishes);
  const waiter = first(summary?.waiters);
  const risks = safeArray(summary?.moneyLosses);

  if (intent === 'discounts') {
    return [
      `Главный вывод: скидки ${discounts.totalDiscountsText || metricValue(summary, 'discounts')} — ${discounts.percentText || findMetric(summary, 'discounts')?.delta || 'нет процента'} от продаж.`,
      '',
      'Детали:',
      discounts.worstChannel ? `1. Канал проверки: ${discounts.worstChannel.name}, ${discounts.worstChannel.discountsText}, ${discounts.worstChannel.percentText}.` : '1. Канал проверки не найден.',
      discounts.worstDay ? `2. День проверки: ${discounts.worstDay.label}, ${discounts.worstDay.discountsText}, ${discounts.worstDay.percentText}.` : '2. День проверки не найден.',
      '3. Оцениваем скидки по проценту от продаж, а не только по сумме в рублях.',
      '',
      'Что сделать сейчас:',
      '1. Проверить причины скидок в главном канале.',
      '2. Посмотреть смену и акции в день с максимальным процентом.',
      '3. Отдельно разобрать ручные корректировки, если они есть.'
    ].join('\n');
  }

  if (intent === 'hourly' || intent === 'shift_script') {
    const peak = hourly.bestHour;
    if (intent === 'shift_script') {
      return `Команда, фокус на смену:\n\nСегодня держим качество продаж и скорость кухни. Главный пик продаж — ${peak ? `${peak.label}, ${peak.revenueText}` : 'пиковый час пока не определён'}. К основному блюду предлагаем напиток, к кофе — десерт. В часы пика заранее готовим заготовки и не просаживаем скорость. Скидки даём только по правилам, без лишних ручных корректировок.`;
    }
    return [
      `Главный вывод: главный пик продаж — ${peak ? `${peak.label}, ${peak.revenueText}` : 'пока не найден'}.`,
      '',
      'Детали:',
      `1. Вечер 18:00–22:00 даёт ${hourly.eveningRevenueText || 'нет данных'}, ${hourly.eveningShare || 0}% выручки.`,
      `2. Обед 12:00–15:00 даёт ${hourly.lunchRevenueText || 'нет данных'}, ${hourly.lunchShare || 0}% выручки.`,
      `3. Слабый час: ${hourly.weakHour ? `${hourly.weakHour.label}, ${hourly.weakHour.revenueText}` : 'нет данных'}.`,
      '',
      'Что сделать сейчас:',
      '1. Усилить кухню и смену в часы пика.',
      '2. Подготовить заготовки заранее.',
      '3. Слабые часы использовать для подготовки и точечных акций.'
    ].join('\n');
  }

  if (intent === 'menu') {
    return [
      `Главный вывод: сильная позиция сейчас — ${topDish ? `${topDish.name}, ${topDish.revenue}` : 'нет данных'}.`,
      '',
      'Детали:',
      topDish ? `1. Продвигать можно ${topDish.name}: ${topDish.amount}, ${topDish.revenue}.` : '1. Топ-блюда не найдены.',
      lowDish ? `2. Проверить позицию с низкой выручкой: ${lowDish.name}, ${lowDish.revenue}.` : '2. Низкие позиции не найдены.',
      '3. Себестоимость не подключена, поэтому маржу и фудкост по блюдам пока не оцениваем.',
      '',
      'Что сделать сейчас:',
      '1. Добавить топ-позицию в рекомендации официантов.',
      '2. Проверить низкие позиции по спросу и актуальности.',
      '3. Себестоимость подключить отдельным этапом.'
    ].join('\n');
  }

  if (intent === 'team') {
    return [
      'Главный вывод: по официантам сейчас безопасно смотреть выручку, а средний чек считать справочным.',
      '',
      'Детали:',
      waiter ? `1. По выручке в списке есть ${waiter.name}: ${waiter.revenue}.` : '1. Данных по официантам нет.',
      '2. Средний чек официантов требует калибровки, поэтому не делаем жёстких выводов по конкретному сотруднику.',
      '3. Команде нужен не общий призыв, а конкретный скрипт допродажи.',
      '',
      'Что сделать сейчас:',
      '1. Дать скрипт: “к основному блюду предложить напиток, к кофе предложить десерт”.',
      '2. Сравнивать сотрудников по выручке, пока чеки не откалиброваны.',
      '3. Разбирать спорные случаи индивидуально, без давления на всю команду.'
    ].join('\n');
  }

  if (intent === 'owner_report') {
    return [
      `Главный вывод: выручка ${money(revenue)}, план выполнен на ${planPercent}%, средний чек ${avgCheck}.`,
      '',
      'Что важно владельцу:',
      `1. План периода: ${money(plan)}, факт: ${money(revenue)}.`,
      bestChannel ? `2. Главный канал: ${bestChannel.name}, ${bestChannel.revenueText}, ${bestChannel.share}% выручки.` : '2. Канал продаж не найден.',
      discounts.worstChannel ? `3. Скидки: ${discounts.totalDiscountsText}, ${discounts.percentText}; проверить ${discounts.worstChannel.name}.` : `3. Скидки: ${metricValue(summary, 'discounts')}.`,
      hourly.bestHour ? `4. Пик продаж: ${hourly.bestHour.label}, ${hourly.bestHour.revenueText}.` : '4. Пик продаж не найден.',
      '',
      'Что сделать сейчас:',
      '1. Добрать план через пиковые часы и сильные блюда.',
      '2. Проверить скидки по каналу и дню.',
      '3. Не оценивать фудкост, пока себестоимость не подключена.'
    ].join('\n');
  }

  if (intent === 'risks' || intent === 'money_loss' || intent === 'action_plan') {
    const riskLines = risks.slice(0, 4).map((item, index) => `${index + 1}. ${item.title}: ${item.reason || item.action || 'проверить'}.`).join('\n');
    return [
      `Главный вывод: план выполнен на ${planPercent}%, выручка ${money(revenue)} из ${money(plan)}.`,
      '',
      'Детали:',
      riskLines || '1. Явных рисков по текущим правилам нет.',
      bestChannel ? `${risks.length ? risks.length + 1 : 2}. Главный канал выручки: ${bestChannel.name}, ${bestChannel.revenueText}.` : '',
      '',
      'Что сделать сейчас:',
      '1. Проверить план-факт и разрыв до плана.',
      discounts.worstChannel ? `2. Проверить скидки в канале ${discounts.worstChannel.name}.` : '2. Проверить скидки по каналам.',
      hourly.bestHour ? `3. Усилить смену в пик ${hourly.bestHour.label}.` : '3. Проверить пики продаж.',
      '4. Фудкост не считать до подключения себестоимости.'
    ].filter(Boolean).join('\n');
  }

  if (intent === 'network') {
    const points = compactLines(summary?.network?.restaurants, (item, index) => `${index + 1}. ${item.name}: ${money(item.revenue)} выручки.`, 5);
    return [
      'Главный вывод: по точкам сейчас надёжно сравниваем выручку и долю, а чеки/гости требуют калибровки.',
      '',
      'Детали:',
      points,
      '',
      'Что сделать сейчас:',
      '1. Сравнивать точки только по выручке.',
      '2. Не делать выводы по среднему чеку точек до калибровки.',
      '3. Позже настроить отдельную сверку чеков и гостей по точкам.'
    ].join('\n');
  }

  if (intent === 'foodcost') {
    return [
      'Главный вывод: себестоимость/фудкост сейчас не подключены, поэтому маржу по блюдам не считаем.',
      '',
      'Что видно:',
      '1. В интерфейсе фудкост честно помечен как “не подключено”.',
      '2. По блюдам можно смотреть выручку и количество, но не прибыльность.',
      '3. Для точного фудкоста нужен отдельный отчёт/поле себестоимости из iiko.',
      '',
      'Что сделать сейчас:',
      '1. Найти в iiko OLAP поле себестоимости или отчёт по списаниям/закупкам.',
      '2. Подключить себестоимость отдельной веткой в n8n.',
      '3. После этого включить маржу и фудкост в КЛИК.'
    ].join('\n');
  }

  return [
    `Главный вывод: выручка ${money(revenue)}, выполнение плана ${planPercent}%, средний чек ${avgCheck} при цели ${avgCheckTarget}.`,
    '',
    'Детали:',
    bestChannel ? `1. Главный канал: ${bestChannel.name}, ${bestChannel.revenueText}.` : '1. Каналы не найдены.',
    hourly.bestHour ? `2. Пик продаж: ${hourly.bestHour.label}, ${hourly.bestHour.revenueText}.` : '2. Почасовой пик не найден.',
    discounts.worstChannel ? `3. Скидки проверить в канале ${discounts.worstChannel.name}: ${discounts.worstChannel.percentText}.` : '3. Скидки без явного канала риска.',
    '',
    'Что сделать сейчас:',
    '1. Проверить план-факт.',
    '2. Удерживать средний чек без лишнего давления на команду.',
    '3. Фудкост не оценивать до подключения себестоимости.'
  ].join('\n');
}
