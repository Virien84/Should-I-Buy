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

const EXTRACT_PROMPT = `You analyse the text of a web page. Decide whether it is the page of ONE specific product that can be bought (not a listing, search results, cart, article or home page).
If it is, return its short name, its current selling price (the final price the buyer would pay, not the crossed-out price, the unit price or the shipping cost) and the currency as an ISO code (EUR, USD, GBP...).
If it is not, return is_product_page=false, product_name="", price=0, currency="".
Answer with JSON only.`;

const cache = new Map(); // url -> extracted product

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
  if (!res.ok) throw new Error(`Ollama returned ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.message.content;
}

async function extractProduct(settings, page) {
  if (cache.has(page.url)) return cache.get(page.url);

  // Shortcut: if the shop publishes clean structured data, there's no need to ask the model.
  const h = page.structured;
  let product;
  if (h && h.price > 0 && h.name) {
    product = { is_product_page: true, product_name: h.name, price: h.price, currency: h.currency || settings.currency, source: "schema" };
  } else {
    const content = await ollamaChat(
      settings,
      [
        { role: "system", content: EXTRACT_PROMPT },
        { role: "user", content: `URL: ${page.url}\nTitle: ${page.title}\nHints: ${JSON.stringify(page.hints)}\n\nText:\n${page.text}` },
      ],
      EXTRACT_SCHEMA
    );
    product = { ...JSON.parse(content), source: "ai" };
  }
  cache.set(page.url, product);
  return product;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function describe(result, settings) {
  const m = (n) => money(n, settings.currency);
  const lines = [];
  if (result.verdict === "green" || result.verdict === "yellow") {
    lines.push(`You'd have ${m(result.leftAfter)} left for ${plural(result.cycle.left, "day")} (${m(result.perDayAfter)}/day).`);
    if (result.waitDays) lines.push(`Wait ${plural(result.waitDays, "day")} and it fits your spending pace.`);
  } else if (result.reason === "no-margin") {
    lines.push("Your fixed expenses and savings already take up all your income.");
  } else {
    lines.push(`You have ${m(Math.max(result.remaining, 0))} of free money left this month.`);
    lines.push(
      result.monthsHalf === result.monthsAll
        ? `You could afford it in ${plural(result.monthsAll, "month")} without touching your savings.`
        : `Without touching your savings: ${plural(result.monthsAll, "month")} putting aside all your free money, or ${result.monthsHalf} putting aside half.`
    );
  }
  return lines;
}

async function friendlyNote(settings, product, result, details) {
  const who = settings.name ? `You're talking to ${settings.name}.` : "";
  const verdictText = { green: "CAN afford it", yellow: "can, but it's tight", red: "CANNOT afford it right now" }[result.verdict];
  return ollamaChat(settings, [
    {
      role: "system",
      content: `You are a close, honest and funny friend who helps people make it to the end of the month. ${who} Write ONE sentence in English (25 words max), casual, no lecturing. Don't make up numbers: use only the ones I give you.`,
    },
    {
      role: "user",
      content: `Product: ${product.product_name} (${money(product.price, settings.currency)}). Verdict: ${verdictText}. Facts: ${details.join(" ")}`,
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

  // The friend's sentence arrives later so it doesn't hold up the traffic light.
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

// Load the model into memory when the browser starts: a cold first answer can take over a minute.
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
