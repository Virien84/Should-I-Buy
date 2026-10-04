// Se ejecuta en cada página. Solo despierta a la IA si la página "huele" a tienda.
(() => {
  const BUY_WORDS = /añadir al carrito|añadir a la cesta|comprar ahora|add to (cart|basket|bag)|buy now|in den warenkorb|ajouter au panier|aggiungi al carrello|adicionar ao carrinho/i;
  const PRICE_RE = /(\d{1,3}([.,\s]\d{3})*([.,]\d{2})?\s?(€|eur|\$|£))|((€|\$|£)\s?\d)/i;

  let host = null;
  let lastUrl = null;

  function findProductInJsonLd() {
    const visit = (node) => {
      if (!node || typeof node !== "object") return null;
      if (Array.isArray(node)) return node.map(visit).find(Boolean) || null;
      const type = [].concat(node["@type"] || []);
      if (type.includes("Product")) {
        const offers = [].concat(node.offers || []);
        const offer = offers[0] || {};
        const price = parseFloat(offer.price ?? offer.lowPrice ?? offer.priceSpecification?.price);
        return { name: node.name, price: isNaN(price) ? 0 : price, currency: offer.priceCurrency || offer.priceSpecification?.priceCurrency };
      }
      return visit(node["@graph"]) || null;
    };
    for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const found = visit(JSON.parse(el.textContent));
        if (found) return found;
      } catch {}
    }
    return null;
  }

  function meta(name) {
    const el = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
    return el ? el.content : null;
  }

  function collectPage() {
    const structured = findProductInJsonLd();
    const hints = {
      ogType: meta("og:type"),
      metaPrice: meta("product:price:amount") || meta("og:price:amount"),
      metaCurrency: meta("product:price:currency") || meta("og:price:currency"),
      h1: document.querySelector("h1")?.innerText?.trim().slice(0, 200),
    };
    const root = document.querySelector("main") || document.body;
    const text = (root.innerText || "").replace(/\s+/g, " ").slice(0, 4000);
    const looksLikeShop =
      !!structured ||
      /product/i.test(hints.ogType || "") ||
      !!hints.metaPrice ||
      (PRICE_RE.test(text) && BUY_WORDS.test(document.body.innerText));
    return { looksLikeShop, page: { url: location.href, title: document.title, structured, hints, text } };
  }

  // ---------- Interfaz ----------
  const COLORS = { green: "#1f9d55", yellow: "#d69e2e", red: "#e53e3e", thinking: "#718096" };
  const TITLES = { green: "Te lo puedes permitir", yellow: "Puedes, pero te aprieta", red: "Ahora no" };
  const EMOJI = { green: "🟢", yellow: "🟡", red: "🔴" };

  function ensureHost() {
    if (host) return host.shadowRoot;
    host = document.createElement("div");
    host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        .card { font: 14px/1.4 system-ui, sans-serif; width: 300px; background: #fff; color: #1a202c;
          border-radius: 14px; box-shadow: 0 10px 30px rgba(0,0,0,.25); overflow: hidden; }
        .bar { padding: 10px 14px; color: #fff; font-weight: 700; display: flex; justify-content: space-between; align-items: center; }
        .bar button { background: none; border: 0; color: #fff; font-size: 18px; cursor: pointer; }
        .body { padding: 12px 14px; }
        .product { font-size: 12px; color: #4a5568; margin-bottom: 6px; }
        .price { font-size: 20px; font-weight: 700; margin-bottom: 6px; }
        .details p { margin: 4px 0; }
        .note { margin-top: 8px; font-style: italic; color: #2d3748; }
        .warn { font-size: 12px; color: #b7791f; margin-top: 6px; }
        .actions { margin-top: 10px; display: flex; gap: 8px; }
        .actions button { flex: 1; border: 1px solid #cbd5e0; background: #f7fafc; border-radius: 8px; padding: 6px; cursor: pointer; font: inherit; }
        .ai { font-size: 11px; color: #a0aec0; margin-top: 8px; }
      </style>
      <div class="card"><div class="bar"><span class="title"></span><button class="close" title="Cerrar">×</button></div><div class="body"></div></div>`;
    shadow.querySelector(".close").onclick = remove;
    document.documentElement.appendChild(host);
    return shadow;
  }

  function remove() {
    host?.remove();
    host = null;
  }

  function render(state) {
    const shadow = ensureHost();
    const bar = shadow.querySelector(".bar");
    const title = shadow.querySelector(".title");
    const body = shadow.querySelector(".body");

    if (state.status === "thinking") {
      bar.style.background = COLORS.thinking;
      title.textContent = "🤔 Pensando…";
      body.innerHTML = `<div class="product">Mirando el producto con la IA local</div>`;
      return;
    }
    if (state.status === "error") {
      bar.style.background = COLORS.thinking;
      title.textContent = "FinDeMes no puede pensar";
      body.innerHTML = `<p>¿Está Ollama encendido?</p><div class="ai"></div>`;
      body.querySelector(".ai").textContent = state.error;
      return;
    }

    bar.style.background = COLORS[state.verdict];
    title.textContent = `${EMOJI[state.verdict]} ${TITLES[state.verdict]}`;
    body.innerHTML = `
      <div class="product"></div>
      <div class="price"></div>
      <div class="details"></div>
      <div class="note">…</div>
      <div class="warn" hidden></div>
      <div class="actions"><button class="bought">Lo he comprado</button></div>
      <div class="ai"></div>`;
    body.querySelector(".product").textContent = state.product.product_name;
    body.querySelector(".price").textContent = state.priceText;
    for (const line of state.details) {
      const p = document.createElement("p");
      p.textContent = line;
      body.querySelector(".details").appendChild(p);
    }
    if (state.currencyMismatch) {
      const w = body.querySelector(".warn");
      w.hidden = false;
      w.textContent = `Ojo: la tienda muestra el precio en ${state.product.currency}.`;
    }
    body.querySelector(".ai").textContent =
      state.product.source === "ai" ? "Producto detectado por Gemma en tu ordenador" : "Precio leído de los datos de la tienda";
    body.querySelector(".bought").onclick = (e) => {
      chrome.runtime.sendMessage({ type: "bought", name: state.product.product_name, price: state.product.price, url: location.href });
      e.target.textContent = "Apuntado ✔";
      e.target.disabled = true;
    };
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "note" && msg.url === location.href && host) {
      const note = host.shadowRoot.querySelector(".note");
      if (note) note.textContent = msg.note;
    }
  });

  async function check() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    remove();
    const { looksLikeShop, page } = collectPage();
    if (!looksLikeShop) return;
    render({ status: "thinking" });
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: "analyze", page });
    } catch (err) {
      res = { status: "error", error: String(err.message || err) };
    }
    if (page.url !== location.href) return; // el usuario ya se fue a otra página
    if (res.status === "ok" || res.status === "error") render(res);
    else remove();
  }

  // Las tiendas modernas cambian de página sin recargar: vigilamos la URL.
  setTimeout(check, 1200);
  setInterval(check, 1500);
})();
