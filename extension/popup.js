import { DEFAULT_SETTINGS, monthSummary, money } from "./budget.js";

const $ = (id) => document.getElementById(id);
$("options").onclick = () => chrome.runtime.openOptionsPage();

async function render() {
  const stored = await chrome.storage.local.get(["settings", "purchases"]);
  const settings = { ...DEFAULT_SETTINGS, ...stored.settings };
  const purchases = stored.purchases || [];
  const el = $("content");

  if (!settings.income) {
    el.innerHTML = `<p>First, tell me your numbers in the settings.</p>`;
    return;
  }

  const s = monthSummary(settings, purchases);
  const m = (n) => money(n, settings.currency);
  const used = s.free > 0 ? Math.min(1, s.spent / s.free) : 1;
  const pace = s.cycle.elapsed / s.cycle.days;
  const color = used <= pace ? "#1f9d55" : used < 1 ? "#d69e2e" : "#e53e3e";

  el.innerHTML = `
    <div class="row"><span>Free money this month</span><b>${m(s.free)}</b></div>
    <div class="row"><span>Purchases logged</span><b>${m(s.spent)}</b></div>
    <div class="row"><span>Left</span><b>${m(s.remaining)}</b></div>
    <div class="meter"><div style="width:${used * 100}%;background:${color}"></div></div>
    <div class="muted">Day ${s.cycle.elapsed} of ${s.cycle.days} until payday. At your pace, you could have spent ${m(s.free * pace)} by today.</div>
    <ul id="list"></ul>`;

  const current = purchases
    .map((p, i) => ({ ...p, i }))
    .filter((p) => new Date(p.date) >= s.cycle.start);
  for (const p of current) {
    const li = document.createElement("li");
    li.textContent = `${p.name} · ${m(p.price)} `;
    const del = document.createElement("button");
    del.textContent = "×";
    del.title = "Remove";
    del.onclick = async () => {
      purchases.splice(p.i, 1);
      await chrome.storage.local.set({ purchases });
      render();
    };
    li.appendChild(del);
    $("list").appendChild(li);
  }
}

render();
