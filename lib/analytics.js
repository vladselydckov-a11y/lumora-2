export function buildDataBrief(summary) {
  const metrics = summary.metrics.map((m) => `${m.label}: ${m.value} (${m.delta})`).join('\n');
  const topDishes = summary.topDishes.map((d, i) => `${i + 1}. ${d.name}: ${d.amount}, ${d.revenue}, фудкост ${d.foodcost || 'нет данных'}`).join('\n');
  const lowDishes = summary.lowDishes.map((d, i) => `${i + 1}. ${d.name}: ${d.amount}, ${d.revenue}, проблема: ${d.issue}`).join('\n');
  const waiters = summary.waiters.map((w, i) => `${i + 1}. ${w.name}: ${w.revenue}, чеков ${w.checks}, средний чек ${w.avgCheck}, допродажа ${w.upsell}`).join('\n');
  const week = summary.week.map((d) => `${d.day}: ${d.revenue.toLocaleString('ru-RU')} ₽, чеков ${d.checks}, средний чек ${d.avgCheck} ₽`).join('\n');
  const alerts = summary.alerts.map((a) => `- ${a.title}: ${a.text}`).join('\n');
  const network = summary.network.restaurants.map((r) => `${r.name}: ${r.revenue.toLocaleString('ru-RU')} ₽, план ${r.plan.toLocaleString('ru-RU')} ₽, чек ${r.avgCheck} ₽, проблема: ${r.problem}`).join('\n');
  const losses = summary.moneyLosses.map((l) => `- ${l.title}: ${l.amount.toLocaleString('ru-RU')} ₽, причина: ${l.reason}`).join('\n');
  const forecast = `Прогноз конца дня: ${summary.forecast.projected.toLocaleString('ru-RU')} ₽ при плане ${summary.forecast.plan.toLocaleString('ru-RU')} ₽. Риск: ${summary.forecast.risk}.`;

  return `Ресторан: ${summary.restaurant.name}\nПериод: ${summary.period.title}, сравнение ${summary.period.compareTitle}\nДанные обновлены: ${summary.generatedAt}\n\nМЕТРИКИ\n${metrics}\n\nСЕТЬ\n${network}\n\nПОТЕРИ\n${losses}\n\nПРОГНОЗ\n${forecast}\n\nНЕДЕЛЯ\n${week}\n\nТОП БЛЮД\n${topDishes}\n\nСЛАБЫЕ БЛЮДА\n${lowDishes}\n\nОФИЦИАНТЫ\n${waiters}\n\nСИГНАЛЫ\n${alerts}`;
}

export function getDemoAnswer(question, summary) {
  const q = String(question || '').toLowerCase();
  const revenue = summary.metrics.find((m) => m.key === 'revenue');
  const avgCheck = summary.metrics.find((m) => m.key === 'avgCheck');
  const foodcost = summary.metrics.find((m) => m.key === 'foodcost');
  const discounts = summary.metrics.find((m) => m.key === 'discounts');
  const topDish = summary.topDishes[0];
  const lowDish = summary.lowDishes[0];
  const weakWaiter = [...summary.waiters].sort((a, b) => a.rawAvgCheck - b.rawAvgCheck)[0];
  const weakPoint = [...summary.network.restaurants].sort((a, b) => (a.revenue / a.plan) - (b.revenue / b.plan))[0];
  const totalLoss = summary.totalLoss?.toLocaleString('ru-RU') || 'нет данных';

  if (q.includes('сеть') || q.includes('точк') || q.includes('филиал')) {
    return `По сети сейчас ${summary.network.totals.revenue.toLocaleString('ru-RU')} ₽, выполнение плана ${summary.network.totals.percent}%. Слабее всех выглядит точка ${weakPoint.name}: проблема — ${weakPoint.problem}. Действия: 1) сравнить смены по среднему чеку, 2) проверить скидки, 3) перенести сильные скрипты продаж из лучшей точки.`;
  }

  if (q.includes('потер') || q.includes('деньг') || q.includes('прибыл')) {
    return `Оценка финансовых отклонений сегодня: около ${totalLoss} ₽. Главные зоны внимания: средний чек ниже цели, фудкост выше нормы, лишние скидки и риск очереди кухни. Начать лучше со среднего чека: это самый быстрый рычаг через напитки, десерты и комбо.`;
  }

  if (q.includes('прогноз') || q.includes('конец дня') || q.includes('план')) {
    return `Прогноз конца дня: ${summary.forecast.projected.toLocaleString('ru-RU')} ₽ при плане ${summary.forecast.plan.toLocaleString('ru-RU')} ₽. Статус: ${summary.forecast.risk}. На вечер: поставить фокус на допродажу, проверить скидки и загрузку кухни перед пиком.`;
  }

  if (q.includes('скрипт') || q.includes('официант') || q.includes('команд')) {
    return `Скрипт для смены: ${summary.teamScript} Отдельно проверь ${weakWaiter.name}: средний чек ${weakWaiter.avgCheck}, ниже команды.`;
  }

  if (q.includes('выруч') || q.includes('касс')) {
    return `Выручка сейчас ${revenue.value}, это ${revenue.delta} к прошлой пятнице. Рост есть, но гости монетизируются не полностью: средний чек ${avgCheck.value}. Главный рычаг на сегодня — допродажа напитков, десертов и закусок.`;
  }

  if (q.includes('средн') || q.includes('чек')) {
    return `Средний чек ${avgCheck.value}. При текущем количестве чеков каждый недобор к цели сразу превращается в потерю денег. Проверь официанта ${weakWaiter.name}: у него средний чек ${weakWaiter.avgCheck}. Действия: скрипт допродажи, комбо, контроль по вечерней смене.`;
  }

  if (q.includes('блюд') || q.includes('топ')) {
    return `Главное блюдо по выручке: ${topDish.name}, ${topDish.amount}, ${topDish.revenue}. Слабая позиция: ${lowDish.name}, ${lowDish.amount}, ${lowDish.revenue}. Я бы продвигал ${topDish.name}, а ${lowDish.name} поставил в допродажу к кофе/основным блюдам.`;
  }

  if (q.includes('фуд') || q.includes('себесто')) {
    return `Фудкост сейчас ${foodcost.value}, динамика ${foodcost.delta}. Это красная зона. Нужно проверить себестоимость топовых блюд, списания, порции и закупочные цены. Начни с ${summary.topDishes.slice(0, 3).map((d) => d.name).join(', ')}.`;
  }

  if (q.includes('скид')) {
    return `Скидки сегодня ${discounts.value}, рост ${discounts.delta}. Быстрый контроль: посмотреть скидки по официантам, сменам и часам. Цель — понять, это акция или ручной слив маржи.`;
  }

  return `Короткий вывод: система видит не только цифры, но и зоны управленческих рисков. Сегодня фокус: средний чек, фудкост, скидки и слабая точка сети. Действия: дать скрипт официантам, проверить фудкост топ-блюд, разобрать скидки и обновить прогноз к вечеру.`;
}
