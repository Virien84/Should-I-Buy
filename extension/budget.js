// Budget logic. No AI here: the maths has to be exact and explainable.

export const DEFAULT_SETTINGS = {
  name: "",
  income: 0,        // monthly net income
  fixed: 0,         // monthly fixed expenses (rent, bills, subscriptions...)
  savings: 0,       // what gets put aside every month
  payday: 1,        // day of the month the salary arrives (1-28)
  currency: "EUR",
  model: "gemma3:4b",
  ollamaUrl: "http://localhost:11434",
};

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Current pay cycle: from the last payday to the next one.
export function payCycle(payday, now = new Date()) {
  const today = startOfDay(now);
  let start = new Date(today.getFullYear(), today.getMonth(), payday);
  if (start > today) start = new Date(today.getFullYear(), today.getMonth() - 1, payday);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, payday);
  const days = Math.round((end - start) / DAY);
  const elapsed = Math.round((today - start) / DAY) + 1; // today counts
  return { start, end, days, elapsed, left: days - elapsed + 1 };
}

export function spentThisCycle(purchases, cycle) {
  return purchases
    .filter((p) => new Date(p.date) >= cycle.start)
    .reduce((sum, p) => sum + p.price, 0);
}

export function monthSummary(settings, purchases, now = new Date()) {
  const cycle = payCycle(settings.payday, now);
  const free = settings.income - settings.fixed - settings.savings;
  const spent = spentThisCycle(purchases, cycle);
  const remaining = free - spent;
  // If free money were "earned" day by day, how much is available as of today.
  const onPace = (free * cycle.elapsed) / cycle.days - spent;
  return { cycle, free, spent, remaining, onPace };
}

// verdict: "green" (go ahead), "yellow" (you can, but it is tight), "red" (not without touching your savings)
export function evaluate(price, settings, purchases, now = new Date()) {
  const s = monthSummary(settings, purchases, now);
  const { cycle, free, remaining, onPace } = s;
  const result = { ...s, price, verdict: "red" };

  if (free <= 0) {
    result.reason = "no-margin";
    return result;
  }

  if (price <= remaining) {
    result.leftAfter = remaining - price;
    result.perDayAfter = result.leftAfter / cycle.left;
    if (price <= onPace) {
      result.verdict = "green";
    } else {
      result.verdict = "yellow";
      // Days to wait until it fits the spending pace.
      const daysNeeded = Math.ceil(((price + s.spent) * cycle.days) / free) - cycle.elapsed;
      result.waitDays = daysNeeded < cycle.left ? daysNeeded : null;
    }
    return result;
  }

  // Not this month: how many months of putting free money aside, without touching savings.
  const need = price - Math.max(remaining, 0);
  result.monthsAll = Math.ceil(need / free);
  result.monthsHalf = Math.ceil(need / (free / 2));
  return result;
}

export function money(amount, currency = "EUR") {
  try {
    return new Intl.NumberFormat("en-IE", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
