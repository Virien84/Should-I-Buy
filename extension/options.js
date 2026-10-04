import { DEFAULT_SETTINGS, money } from "./budget.js";

const FIELDS = ["name", "income", "fixed", "savings", "payday", "currency", "model", "ollamaUrl"];
const NUMERIC = new Set(["income", "fixed", "savings", "payday"]);
const $ = (id) => document.getElementById(id);

function read() {
  const s = {};
  for (const f of FIELDS) s[f] = NUMERIC.has(f) ? Number($(f).value) || 0 : $(f).value.trim();
  s.payday = Math.min(28, Math.max(1, s.payday || 1));
  return s;
}

function showFree() {
  const s = read();
  const free = s.income - s.fixed - s.savings;
  $("free").textContent =
    free > 0
      ? `Te quedan ${money(free, s.currency)} libres al mes para el día a día y los caprichos.`
      : "Con estos números no te queda dinero libre al mes.";
  $("free").style.background = free > 0 ? "#f0fff4" : "#fff5f5";
}

const { settings } = await chrome.storage.local.get("settings");
const current = { ...DEFAULT_SETTINGS, ...settings };
for (const f of FIELDS) $(f).value = current[f];
showFree();
for (const f of FIELDS) $(f).addEventListener("input", showFree);

$("save").onclick = async () => {
  await chrome.storage.local.set({ settings: read() });
  $("status").textContent = "Guardado ✔";
  setTimeout(() => ($("status").textContent = ""), 2000);
};

$("test").onclick = async () => {
  await chrome.storage.local.set({ settings: read() });
  $("ollama").textContent = "Probando…";
  const res = await chrome.runtime.sendMessage({ type: "ping-ollama" });
  if (!res.ok) {
    $("ollama").textContent = `No conecta: ${res.error}`;
  } else if (!res.models.some((m) => m === read().model || m === `${read().model}:latest`)) {
    $("ollama").textContent = `Conecta, pero falta el modelo. Ejecuta: ollama pull ${read().model}`;
  } else {
    $("ollama").textContent = "Todo listo ✔";
  }
};
