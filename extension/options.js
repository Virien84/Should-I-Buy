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
      ? `You have ${money(free, s.currency)} free each month for day-to-day spending and treats.`
      : "With these numbers you have no free money left each month.";
  $("free").style.background = free > 0 ? "#f0fff4" : "#fff5f5";
}

const { settings } = await chrome.storage.local.get("settings");
const current = { ...DEFAULT_SETTINGS, ...settings };
for (const f of FIELDS) $(f).value = current[f];
showFree();
for (const f of FIELDS) $(f).addEventListener("input", showFree);

$("save").onclick = async () => {
  await chrome.storage.local.set({ settings: read() });
  $("status").textContent = "Saved ✔";
  setTimeout(() => ($("status").textContent = ""), 2000);
};

$("test").onclick = async () => {
  await chrome.storage.local.set({ settings: read() });
  $("ollama").textContent = "Testing…";
  const res = await chrome.runtime.sendMessage({ type: "ping-ollama" });
  if (!res.ok) {
    $("ollama").textContent = `Cannot connect: ${res.error}`;
  } else if (!res.models.some((m) => m === read().model || m === `${read().model}:latest`)) {
    $("ollama").textContent = `Connected, but the model is missing. Run: ollama pull ${read().model}`;
  } else {
    $("ollama").textContent = "All set ✔";
  }
};
