// Lógica del presupuesto. Sin IA: las cuentas tienen que ser exactas y explicables.

export const DEFAULT_SETTINGS = {
  name: "",
  income: 0,        // ingresos netos al mes
  fixed: 0,         // gastos fijos al mes (alquiler, facturas, suscripciones...)
  savings: 0,       // lo que aparta cada mes para ahorrar
  payday: 1,        // día del mes en que cobra (1-28)
  currency: "EUR",
  model: "gemma3:4b",
  ollamaUrl: "http://localhost:11434",
};

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Ciclo de cobro actual: desde el último día de cobro hasta el siguiente.
export function payCycle(payday, now = new Date()) {
  const today = startOfDay(now);
  let start = new Date(today.getFullYear(), today.getMonth(), payday);
  if (start > today) start = new Date(today.getFullYear(), today.getMonth() - 1, payday);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, payday);
  const days = Math.round((end - start) / DAY);
  const elapsed = Math.round((today - start) / DAY) + 1; // hoy cuenta
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
  // Si el dinero libre se fuera "ganando" día a día, cuánto llevas disponible hoy.
  const onPace = (free * cycle.elapsed) / cycle.days - spent;
  return { cycle, free, spent, remaining, onPace };
}

// verdict: "green" (adelante), "yellow" (puedes, pero te aprieta), "red" (no sin tocar tus ahorros)
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
      // Días que tendrías que esperar para que entre en tu ritmo de gasto.
      const daysNeeded = Math.ceil(((price + s.spent) * cycle.days) / free) - cycle.elapsed;
      result.waitDays = daysNeeded < cycle.left ? daysNeeded : null;
    }
    return result;
  }

  // No llega este mes: cuántos meses apartando dinero libre, sin tocar el ahorro.
  const need = price - Math.max(remaining, 0);
  result.monthsAll = Math.ceil(need / free);
  result.monthsHalf = Math.ceil(need / (free / 2));
  return result;
}

export function money(amount, currency = "EUR") {
  try {
    return new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
