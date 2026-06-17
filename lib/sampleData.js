export function formatMoney(value) {
  return `${Math.round(Number(value || 0)).toLocaleString('ru-RU')} ₽`;
}

function percent(value) {
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function deltaStatus(value, goodWhenPositive = true) {
  if (value === 0) return 'neutral';
  return goodWhenPositive ? (value > 0 ? 'good' : 'bad') : (value > 0 ? 'bad' : 'good');
}

export function buildDynamicSummary(options = {}) {
  const selectedRestaurantId = options.restaurantId || 'all';
  const customKpi = options.kpi || {};
  const now = new Date();
  const tick = Math.floor(now.getTime() / 1000);
  const wave = Math.floor((tick % 240) / 8);
  const pulse = (tick % 37);

  const baseRevenue = 187400;
  const revenue = baseRevenue + wave * 950 + pulse * 43;
  const checks = 143 + Math.floor(wave / 2);
  const guests = 168 + Math.floor(wave / 2) + (pulse % 5);
  const avgCheck = Math.round(revenue / Math.max(checks, 1));
  const foodcost = Number((32.1 + (wave % 7) * 0.22).toFixed(1));
  const discounts = 11800 + wave * 120 + (pulse % 4) * 210;
  const planRevenue = Number(customKpi.dailyRevenue || 250000);
  const targetAvgCheck = Number(customKpi.avgCheck || 1450);
  const targetFoodcost = Number(customKpi.foodcostMax || 30);
  const revenueDelta = 7.2 + (wave % 8) * 0.35;
  const checksDelta = 2.4 + (wave % 6) * 0.18;
  const avgCheckDelta = ((avgCheck - 1375) / 1375) * 100;
  const guestsDelta = 4.4 + (wave % 4) * 0.3;
  const foodcostDelta = foodcost - targetFoodcost;
  const discountsDelta = 9.5 + (wave % 5) * 0.8;

  const avgCheckLoss = Math.max((targetAvgCheck - avgCheck) * checks, 0);
  const foodcostLoss = Math.max(Math.round(revenue * ((foodcost - targetFoodcost) / 100)), 0);
  const discountLoss = Math.round(discounts * 0.2);
  const kitchenLoss = 4200 + (wave % 4) * 900;
  const totalLoss = avgCheckLoss + foodcostLoss + discountLoss + kitchenLoss;
  const planPercent = Math.round((revenue / planRevenue) * 100);
  const projectedEndDay = revenue + Math.round((planRevenue - revenue) * (0.76 + ((wave % 5) * 0.035)));

  const topDishes = [
    { name: 'Пицца Пепперони', category: 'Пицца', amount: `${42 + (wave % 4)} шт.`, rawAmount: 42 + (wave % 4), revenue: formatMoney(38600 + wave * 210), rawRevenue: 38600 + wave * 210, foodcost: '28%', margin: '62%', ai: 'Продвигать вечером' },
    { name: 'Цезарь с курицей', category: 'Салаты', amount: `${37 + (wave % 3)} шт.`, rawAmount: 37 + (wave % 3), revenue: formatMoney(29970 + wave * 160), rawRevenue: 29970 + wave * 160, foodcost: '34%', margin: '55%', ai: 'Проверить себестоимость' },
    { name: 'Бургер BBQ', category: 'Бургеры', amount: `${31 + (wave % 3)} шт.`, rawAmount: 31 + (wave % 3), revenue: formatMoney(27590 + wave * 130), rawRevenue: 27590 + wave * 130, foodcost: '31%', margin: '58%', ai: 'Норма' },
    { name: 'Паста Карбонара', category: 'Паста', amount: `${26 + (wave % 2)} шт.`, rawAmount: 26 + (wave % 2), revenue: formatMoney(23400 + wave * 100), rawRevenue: 23400 + wave * 100, foodcost: '33%', margin: '54%', ai: 'Контроль порций' },
    { name: 'Морс ягодный', category: 'Напитки', amount: `${24 + (wave % 6)} шт.`, rawAmount: 24 + (wave % 6), revenue: formatMoney(8400 + wave * 90), rawRevenue: 8400 + wave * 90, foodcost: '18%', margin: '80%', ai: 'Допродавать' }
  ];

  const lowDishes = [
    { name: 'Чизкейк', category: 'Десерты', amount: `${6 + (wave % 2)} шт.`, rawAmount: 6 + (wave % 2), revenue: formatMoney(3900 + wave * 35), rawRevenue: 3900 + wave * 35, issue: 'низкая допродажа при высокой марже', ai: 'Поставить в скрипт к кофе' },
    { name: 'Латте', category: 'Напитки', amount: `${8 + (wave % 2)} шт.`, rawAmount: 8 + (wave % 2), revenue: formatMoney(3200 + wave * 20), rawRevenue: 3200 + wave * 20, issue: 'слабая связка с десертами', ai: 'Комбо латте + чизкейк' },
    { name: 'Картофель фри', category: 'Закуски', amount: `${9 + (wave % 3)} шт.`, rawAmount: 9 + (wave % 3), revenue: formatMoney(2700 + wave * 20), rawRevenue: 2700 + wave * 20, issue: 'нет роста в вечерней смене', ai: 'Добавить к бургеру' }
  ];

  const waiters = [
    { name: 'Анна', checks: 41 + (wave % 3), avgCheck: formatMoney(1620 + wave * 2), rawAvgCheck: 1620 + wave * 2, revenue: formatMoney(66420 + wave * 350), rawRevenue: 66420 + wave * 350, upsell: 'сильная', status: 'Лидер смены' },
    { name: 'Илья', checks: 38 + (wave % 2), avgCheck: formatMoney(1430 + wave), rawAvgCheck: 1430 + wave, revenue: formatMoney(54340 + wave * 240), rawRevenue: 54340 + wave * 240, upsell: 'норма', status: 'Держит план' },
    { name: 'Максим', checks: 31 + (wave % 2), avgCheck: formatMoney(1080 + wave), rawAvgCheck: 1080 + wave, revenue: formatMoney(33480 + wave * 120), rawRevenue: 33480 + wave * 120, upsell: 'слабая', status: 'Нужна работа' },
    { name: 'София', checks: 33 + (wave % 3), avgCheck: formatMoney(1210 + wave * 2), rawAvgCheck: 1210 + wave * 2, revenue: formatMoney(39930 + wave * 180), rawRevenue: 39930 + wave * 180, upsell: 'средняя', status: 'Проверить чек' }
  ];

  const restaurants = [
    { id: 'r1', name: 'Центр', city: 'Москва', revenue: revenue, plan: planRevenue, avgCheck, checks, guests, problem: avgCheck < targetAvgCheck ? 'средний чек' : 'норма', status: avgCheck < targetAvgCheck ? 'warn' : 'good' },
    { id: 'r2', name: 'Север', city: 'Москва', revenue: 221000 + wave * 630, plan: 260000, avgCheck: 1480 + (wave % 7), checks: 149 + (wave % 4), guests: 174 + (wave % 5), problem: 'норма', status: 'good' },
    { id: 'r3', name: 'Юг', city: 'Москва', revenue: 146000 + wave * 390, plan: 240000, avgCheck: 1090 + (wave % 8), checks: 134 + (wave % 4), guests: 160 + (wave % 5), problem: 'выручка и чек', status: 'bad' },
    { id: 'r4', name: 'Бар на Патриках', city: 'Москва', revenue: 198000 + wave * 510, plan: 230000, avgCheck: 1760 + (wave % 10), checks: 112 + (wave % 4), guests: 130 + (wave % 5), problem: 'скидки вечером', status: 'warn' }
  ];
  const networkRevenue = restaurants.reduce((sum, item) => sum + item.revenue, 0);
  const networkPlan = restaurants.reduce((sum, item) => sum + item.plan, 0);
  const networkChecks = restaurants.reduce((sum, item) => sum + item.checks, 0);
  const networkGuests = restaurants.reduce((sum, item) => sum + item.guests, 0);
  const networkAvgCheck = Math.round(networkRevenue / Math.max(networkChecks, 1));
  const selectedPoint = restaurants.find((item) => item.id === selectedRestaurantId);
  const activeRestaurant = selectedRestaurantId === 'all' || !selectedPoint
    ? { id: 'all', name: 'Вся сеть', city: 'Москва', revenue: networkRevenue, plan: networkPlan, avgCheck: networkAvgCheck, checks: networkChecks, guests: networkGuests, problem: 'сеть', status: restaurants.some((item) => item.status === 'bad') ? 'warn' : 'good' }
    : selectedPoint;
  const scopedRevenue = activeRestaurant.revenue;
  const scopedPlan = activeRestaurant.plan;
  const scopedChecks = activeRestaurant.checks;
  const scopedGuests = activeRestaurant.guests;
  const scopedAvgCheck = activeRestaurant.avgCheck;
  const scopedAvgCheckDelta = ((scopedAvgCheck - targetAvgCheck) / targetAvgCheck) * 100;
  const scopedAvgCheckLoss = Math.max((targetAvgCheck - scopedAvgCheck) * scopedChecks, 0);
  const scopedPlanPercent = Math.round((scopedRevenue / scopedPlan) * 100);

  return {
    generatedAt: now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    selectedRestaurantId: activeRestaurant.id,
    restaurant: { id: activeRestaurant.id, name: activeRestaurant.name, city: activeRestaurant.city, currency: '₽' },
    period: { date: now.toISOString().slice(0, 10), title: 'Сегодня', compareTitle: 'к прошлой пятнице' },
    plan: { dailyRevenue: scopedPlan, avgCheck: targetAvgCheck, foodcostMax: targetFoodcost, discountMax: Number(customKpi.discountMax || 9000) },
    metrics: [
      { key: 'revenue', label: 'Выручка', value: formatMoney(scopedRevenue), raw: scopedRevenue, delta: selectedRestaurantId === 'all' ? `${scopedPlanPercent}% плана сети` : percent(revenueDelta), status: scopedPlanPercent >= 70 ? 'good' : 'bad' },
      { key: 'checks', label: 'Чеки', value: String(scopedChecks), raw: scopedChecks, delta: selectedRestaurantId === 'all' ? 'по сети' : percent(checksDelta), status: 'good' },
      { key: 'avgCheck', label: 'Средний чек', value: formatMoney(scopedAvgCheck), raw: scopedAvgCheck, delta: percent(scopedAvgCheckDelta), status: deltaStatus(scopedAvgCheckDelta) },
      { key: 'guests', label: 'Гости', value: String(scopedGuests), raw: scopedGuests, delta: selectedRestaurantId === 'all' ? 'по сети' : percent(guestsDelta), status: 'good' },
      { key: 'foodcost', label: 'Фудкост', value: `${foodcost}%`, raw: foodcost, delta: `+${foodcostDelta.toFixed(1)} п.п.`, status: 'bad' },
      { key: 'discounts', label: 'Скидки', value: formatMoney(discounts), raw: discounts, delta: percent(discountsDelta), status: 'bad' }
    ],
    topDishes,
    lowDishes,
    waiters,
    week: [
      { day: 'Пн', revenue: 142000, checks: 119, avgCheck: 1193 },
      { day: 'Вт', revenue: 151000, checks: 126, avgCheck: 1198 },
      { day: 'Ср', revenue: 139000, checks: 114, avgCheck: 1219 },
      { day: 'Чт', revenue: 168000, checks: 135, avgCheck: 1244 },
      { day: 'Пт', revenue, checks, avgCheck },
      { day: 'Сб', revenue: 218000 + wave * 410, checks: 153, avgCheck: 1425 },
      { day: 'Вс', revenue: 204000 + wave * 300, checks: 146, avgCheck: 1397 }
    ],
    network: {
      selectedRestaurantId: activeRestaurant.id,
      restaurants,
      totals: {
        revenue: networkRevenue,
        plan: networkPlan,
        percent: Math.round((networkRevenue / networkPlan) * 100),
        avgCheck: networkAvgCheck,
        checks: networkChecks,
        weakPoints: restaurants.filter((item) => item.status !== 'good').length
      },
      ai: 'Сеть растёт по общей выручке, но точка Юг тянет вниз средний чек и выполнение плана. Для владельца сети главный фокус — сравнение точек и стандарты смен.'
    },
    moneyLosses: [
      { title: 'Средний чек ниже цели', amount: scopedAvgCheckLoss, reason: `${scopedChecks} чеков × недобор ${formatMoney(Math.max(targetAvgCheck - scopedAvgCheck, 0))}`, action: 'Допродажа напитков, десертов и комбо в вечернюю смену.', level: 'bad' },
      { title: 'Фудкост выше нормы', amount: foodcostLoss, reason: `${foodcost}% против нормы ${targetFoodcost}%`, action: 'Проверить себестоимость топ-5 блюд, порции и списания.', level: 'bad' },
      { title: 'Лишние скидки', amount: discountLoss, reason: `20% от скидок ${formatMoney(discounts)}`, action: 'Разобрать скидки по сменам, часам и сотрудникам.', level: 'warn' },
      { title: 'Очередь кухни', amount: kitchenLoss, reason: 'Риск задержек в пиковые часы', action: 'Проверить скорость отдачи и стоп-лист перед вечером.', level: 'warn' }
    ],
    totalLoss: scopedAvgCheckLoss + foodcostLoss + discountLoss + kitchenLoss,
    actionPlan: [
      { role: 'Владелец', title: 'Контроль денег', text: 'Посмотреть отклонения в рублях, проверить точку Юг и утвердить план по среднему чеку.' },
      { role: 'Управляющий', title: 'Задача смене', text: 'Дать официантам фокус: напиток + десерт к каждому второму чеку. Проверить скидки после 18:00.' },
      { role: 'Шеф-повар', title: 'Кухня и маржа', text: 'Сверить себестоимость пиццы, салатов и списания. Проверить порции в вечерний пик.' },
      { role: 'Маркетинг', title: 'Быстрое промо', text: 'Собрать вечернее предложение: кофе + чизкейк, напиток + бургер, десерт к основному блюду.' }
    ],
    teamScript: 'Фокус смены: поднимаем средний чек. Каждому второму гостю предлагаем напиток или десерт. Для бургеров — картофель/соус, для кофе — чизкейк, для пиццы — морс. Цель: средний чек 1 450 ₽.',
    forecast: {
      current: revenue,
      plan: planRevenue,
      projected: projectedEndDay,
      risk: projectedEndDay < planRevenue ? 'Риск не выполнить план' : 'План выполним при текущем темпе',
      gap: planRevenue - projectedEndDay,
      confidence: 78 + (wave % 9),
      recommendations: [
        'До 18:00 проверить средний чек по официантам.',
        'На вечер поставить фокус на напитки и десерты.',
        'Если прогноз ниже плана — запустить мини-акцию без большой скидки.',
        'Проверить загрузку кухни перед пиковым часом.'
      ]
    },
    shifts: [
      { name: 'Утро', time: '10:00–13:00', revenue: 38400 + wave * 75, checks: 34, avgCheck: 1129, issue: 'низкая допродажа кофе и десертов', status: 'warn' },
      { name: 'День', time: '13:00–17:00', revenue: 69000 + wave * 120, checks: 56, avgCheck: 1232, issue: 'много гостей, чек ниже цели', status: 'bad' },
      { name: 'Вечер', time: '17:00–22:00', revenue: 80000 + wave * 350, checks: 53 + (wave % 3), avgCheck: 1510, issue: 'главный шанс добрать план', status: 'good' }
    ],
    kpiSettings: [
      { name: 'План выручки', value: formatMoney(planRevenue), status: 'активно' },
      { name: 'Цель среднего чека', value: formatMoney(targetAvgCheck), status: 'ниже цели' },
      { name: 'Норма фудкоста', value: `${targetFoodcost}%`, status: 'превышена' },
      { name: 'Лимит скидок', value: formatMoney(9000), status: 'превышен' }
    ],
    alerts: [
      { level: 'bad', title: 'Средний чек просел', text: `${formatMoney(avgCheck)} против цели ${formatMoney(targetAvgCheck)} при росте гостей.` },
      { level: 'bad', title: 'Фудкост выше нормы', text: `${foodcost}%. Желательно проверить себестоимость топовых блюд.` },
      { level: 'warn', title: 'Скидки растут', text: `Скидки ${formatMoney(discounts)}. Нужно проверить причины и смены.` },
      { level: 'warn', title: 'Прогноз дня', text: projectedEndDay < planRevenue ? `Есть риск не добрать ${formatMoney(Math.abs(planRevenue - projectedEndDay))}.` : 'План можно выполнить при текущем темпе.' }
    ],
    problems: [
      { level: 'bad', title: 'Средний чек ниже цели', impact: `-${formatMoney(avgCheckLoss)}`, reason: `Гостей стало больше, но средний чек ${formatMoney(avgCheck)} против цели ${formatMoney(targetAvgCheck)}. Значит проблема не в трафике, а в допродаже.`, actions: ['Дать официантам фокус: напиток + десерт к каждому второму чеку.', 'Проверить сотрудников с чеком ниже команды.', 'Добавить вечернее предложение “десерт + кофе”.'] },
      { level: 'bad', title: 'Фудкост выше нормы', impact: `+${foodcostDelta.toFixed(1)} п.п.`, reason: `Фудкост ${foodcost}% выше целевого уровня ${targetFoodcost}%. Нужно понять, где съедается маржа.`, actions: ['Сверить себестоимость топ-5 блюд.', 'Проверить списания и порции на кухне.', 'Сравнить закупочные цены с прошлой неделей.'] },
      { level: 'warn', title: 'Скидки растут', impact: formatMoney(discounts), reason: 'Скидки выросли. Это может быть нормой для акции, но требует контроля по сменам.', actions: ['Посмотреть скидки по официантам и часам.', 'Проверить, не используют ли скидки вместо сервиса.', 'Ограничить ручные скидки без причины.'] }
    ],
    notifications: [
      { id: 'daily', title: 'Ежедневный отчёт', time: '09:00', enabled: true, prompt: 'Выручка, чеки, средний чек, топ блюд, проблемы, 3 действия на сегодня.' },
      { id: 'forecast', title: 'Прогноз дня', time: '16:00', enabled: true, prompt: 'Прогноз выполнения плана и действия на вечер.' },
      { id: 'alerts', title: 'Тревоги', time: 'Сразу', enabled: true, prompt: 'Сообщать, если выручка падает, фудкост выше нормы, скидки растут или официант ниже команды.' },
      { id: 'weekly', title: 'Недельный отчёт', time: 'Пн 10:00', enabled: true, prompt: 'Динамика недели, лучшие/слабые дни, блюда, официанты, фудкост, рекомендации.' }
    ],
    users: [
      { name: 'Владелец', role: 'admin', access: 'Все точки, деньги, AI-чат, настройки, отчёты' },
      { name: 'Управляющий', role: 'manager', access: 'День, смены, команда, уведомления, проблемы' },
      { name: 'Шеф-повар', role: 'chef', access: 'Блюда, фудкост, стоп-лист, списания' },
      { name: 'Маркетолог', role: 'marketing', access: 'Акции, скидки, гости, повторные продажи' }
    ],
    dataSources: [
      { name: 'iiko', status: 'MVP: CSV/Excel; дальше API', hint: 'Сначала берём выгрузку, потом подключаем автоматизацию.' },
      { name: 'n8n', status: 'мост автоматизации', hint: 'Забирает данные по расписанию и пишет в базу.' },
      { name: 'Supabase', status: 'нужна для сети и истории', hint: 'Хранит рестораны, роли, заказы, отчёты, уведомления.' }
    ],
    ai: {
      summary: `Выручка обновляется в demo-live режиме. Выбран режим: ${activeRestaurant.name}. Главная зона роста — средний чек: сейчас ${formatMoney(scopedAvgCheck)} при цели ${formatMoney(targetAvgCheck)}. Сеть показывает ${restaurants.filter((item) => item.status !== 'good').length} точки с отклонениями.`,
      recommendations: ['Поднять средний чек через напитки и десерты.', 'Проверить точку Юг и вечерние скидки.', 'Сверить фудкост топ-блюд.', 'Сделать прогноз дня в 16:00 и отправить план смене.'],
      exampleQuestions: ['Что происходит по сети?', 'Где ресторан теряет деньги?', 'Что сделать сегодня?', 'Какая точка слабее?', 'Какой прогноз конца дня?', 'Сформируй скрипт для официантов', 'Сформируй отчёт владельцу']
    }
  };
}

export const sampleSummary = buildDynamicSummary();
