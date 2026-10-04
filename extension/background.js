import { DEFAULT_SETTINGS, evaluate, money } from "./budget.js";

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    is_product_page: { type: "boolean" },
    product_name: { type: "string" },
    price: { type: "number" },
    currency: { type: "string" },
  },
  required: ["is_product_page", "product_name", "price", "currency"],
};

const EXTRACT_PROMPT = `Analizas el texto de una página web. Decide si es la página de UN producto concreto que se puede comprar (no un listado, buscador, carrito, artículo o portada).
Si lo es, devuelve su nombre corto y el precio actual de venta (el precio final que pagaría, no el tachado ni el precio por unidad ni el de envío) y la moneda en código ISO (EUR, USD, GBP...).
Si no lo es, devuelve is_product_page=false, product_name="", price=0, currency="".
Responde solo con JSON.`;

const cache = new Map(); // url -> producto extraído

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...settings };
}

async function getPurchases() {
  const { purchases } = await chrome.storage.local.get("purchases");
  return purchases || [];
}

async function ollamaChat(settings, messages, format) {
  const res = await fetch(`${settings.ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: settings.model,
      messages,
      stream: false,
      keep_alive: "30m",
      options: { temperature: format ? 0 : 0.7 },
      ...(format ? { format } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Ollama respondió ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.message.content;
}

async function extractProduct(settings, page) {
  if (cache.has(page.url)) return cache.get(page.url);

  // Atajo: si la tienda publica datos estructurados limpios, no hace falta preguntar al modelo.
  const h = page.structured;
  let product;
  if (h && h.price > 0 && h.name) {
    product = { is_product_page: true, product_name: h.name, price: h.price, currency: h.currency || settings.currency, source: "schema" };
  } else {
    const content = await ollamaChat(
      settings,
      [
        { role: "system", content: EXTRACT_PROMPT },
        { role: "user", content: `URL: ${page.url}\nTítulo: ${page.title}\nPistas: ${JSON.stringify(page.hints)}\n\nTexto:\n${page.text}` },
      ],
      EXTRACT_SCHEMA
    );
    product = { ...JSON.parse(content), source: "ai" };
  }
  cache.set(page.url, product);
  return product;
}

function describe(result, settings) {
  const m = (n) => money(n, settings.currency);
  const lines = [];
  if (result.verdict === "green") {
    lines.push(`Te quedarían ${m(result.leftAfter)} para ${result.cycle.left} días (${m(result.perDayAfter)}/día).`);
  } else if (result.verdict === "yellow") {
    lines.push(`Te quedarían ${m(result.leftAfter)} para ${result.cycle.left} días (${m(result.perDayAfter)}/día).`);
    if (result.waitDays) lines.push(`Si esperas ${result.waitDays} día${result.waitDays === 1 ? "" : "s"}, entra en tu ritmo de gasto.`);
  } else if (result.reason === "no-margin") {
    lines.push("Tus gastos fijos y tu ahorro ya se comen todos tus ingresos.");
  } else {
    lines.push(`Este mes te quedan ${m(Math.max(result.remaining, 0))} libres.`);
    lines.push(
      result.monthsHalf === result.monthsAll
        ? `Podrías permitírtelo en ${result.monthsAll} mes${result.monthsAll === 1 ? "" : "es"} sin tocar tus ahorros.`
        : `Sin tocar tus ahorros: ${result.monthsAll} mes${result.monthsAll === 1 ? "" : "es"} apartando todo tu dinero libre, o ${result.monthsHalf} apartando la mitad.`
    );
  }
  return lines;
}

async function friendlyNote(settings, product, result, details) {
  const who = settings.name ? `Hablas con ${settings.name}.` : "";
  const verdictText = { green: "SÍ se lo puede permitir", yellow: "puede, pero le aprieta", red: "NO se lo puede permitir ahora" }[result.verdict];
  return ollamaChat(settings, [
    {
      role: "system",
      content: `Eres un amigo cercano, sincero y con humor que ayuda a llegar a fin de mes. ${who} Escribe UNA sola frase en español (máximo 25 palabras), sin sermones, tuteando. No inventes cifras: usa solo las que te doy.`,
    },
    {
      role: "user",
      content: `Producto: ${product.product_name} (${money(product.price, settings.currency)}). Veredicto: ${verdictText}. Datos: ${details.join(" ")}`,
    },
  ]);
}

async function analyze(page, tabId) {
  const settings = await getSettings();
  if (!settings.income) return { status: "unconfigured" };

  const product = await extractProduct(settings, page);
  if (!product.is_product_page || !(product.price > 0)) return { status: "not-product" };

  const result = evaluate(product.price, settings, await getPurchases());
  const details = describe(result, settings);
  const response = {
    status: "ok",
    product,
    verdict: result.verdict,
    details,
    priceText: money(product.price, settings.currency),
    currencyMismatch: product.currency && product.currency.toUpperCase() !== settings.currency.toUpperCase(),
  };

  // La frase del "amigo" llega después para no retrasar el semáforo.
  friendlyNote(settings, product, result, details)
    .then((note) => chrome.tabs.sendMessage(tabId, { type: "note", url: page.url, note: note.trim() }))
    .catch(() => {});

  return response;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "analyze") {
    analyze(msg.page, sender.tab.id)
      .then(sendResponse)
      .catch((err) => sendResponse({ status: "error", error: String(err.message || err) }));
    return true;
  }
  if (msg.type === "bought") {
    getPurchases().then(async (purchases) => {
      purchases.push({ name: msg.name, price: msg.price, url: msg.url, date: new Date().toISOString() });
      await chrome.storage.local.set({ purchases });
      sendResponse({ ok: true });
    });
    return true;
  }
  if (msg.type === "ping-ollama") {
    getSettings()
      .then((s) => fetch(`${s.ollamaUrl}/api/tags`).then((r) => r.json()))
      .then((d) => sendResponse({ ok: true, models: d.models.map((m) => m.name) }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }
});

// Cargar el modelo en memoria al abrir el navegador: la primera respuesta en frío puede tardar más de un minuto.
async function warmUp() {
  const settings = await getSettings();
  fetch(`${settings.ollamaUrl}/api/generate`, {
    method: "POST",
    body: JSON.stringify({ model: settings.model, keep_alive: "30m" }),
  }).catch(() => {});
}

chrome.runtime.onStartup.addListener(warmUp);
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") chrome.runtime.openOptionsPage();
  warmUp();
});
