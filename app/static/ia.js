// ==========================================================
// TPV · ia.js  (Estadísticas > Análisis con IA)
// Se carga DESPUÉS de app.js y usa sus helpers: $, post, esc, toast
// Agrega solo el botón "Analizar con IA" en la barra de Estadísticas y una tarjeta con el resultado.
// El análisis lo genera el servidor (POST /ia/analisis); la clave de Gemini nunca pasa por el navegador.
// El texto llega en secciones ("## Título") y se acomoda en una grilla que usa todo el ancho.
// ==========================================================
(() => {
  let token = 0; // si el usuario cambia de rango mientras carga, la respuesta vieja se descarta

  const fechaCorta = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return `${d}/${m}/${y}`;
  };
  const rango = () => [$("#stDesde").value, $("#stHasta").value];

  // ---------- Montaje ----------
  document.head.insertAdjacentHTML(
    "beforeend",
    `<style>
    .ia-btn { display: flex; align-items: center; gap: 8px; padding: 10px 16px; font-weight: 700; background: var(--acc); color: #fff }
    [data-theme="dark"] .ia-btn { color: #1b1a20 }

    #iaPanel { display: none; flex: none; margin-top: 16px; padding: 26px 30px 28px }
    #iaPanel.on { display: block; animation: iaIn .3s cubic-bezier(.2, .8, .2, 1) }
    @keyframes iaIn { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }

    .ia-h { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px }
    .ia-h h3 { margin: 0; font-size: 19px }
    .ia-h small { display: block; color: var(--mut); font-size: 13px; margin-top: 3px }
    .ia-acc { display: flex; gap: 8px; flex: none }
    .ia-acc button { padding: 8px 14px; font-size: 13.5px; font-weight: 600; background: var(--bg) }
    .ia-acc button:hover { background: var(--acc-soft); color: var(--acc-txt) }

    /* Grilla de 12 columnas: ocupa todo el ancho, igual que el dashboard */
    .ia-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 14px; margin-top: 20px }
    .ia-sec { min-width: 0; background: var(--bg); border-radius: 20px; padding: 22px 26px; font-size: 15px; line-height: 1.6 }
    .ia-sec.s6 { grid-column: span 6 }
    .ia-sec.s12 { grid-column: span 12 }

    .ia-sec h4 { display: flex; align-items: center; gap: 12px; margin: 0 0 12px; font-size: 16.5px }
    .ia-sec h4 .ic { width: 34px; height: 34px; border-radius: 11px; display: grid; place-content: center; font-size: 17px; background: var(--card); flex: none }
    .ia-sec p { margin: 8px 0 }
    .ia-sec ul { margin: 6px 0 0; padding-left: 20px }
    .ia-sec li { margin: 9px 0 }
    .ia-sec strong { color: var(--txt) }
    .ia-sec em { color: var(--mut); font-size: 13.5px }

    /* Resumen: franja destacada de punta a punta */
    .ia-sec.hero { background: var(--acc-soft); padding: 26px 30px }
    .ia-sec.hero h4 { color: var(--acc-txt) }
    .ia-sec.hero p { margin: 0; font-size: 17.5px; line-height: 1.65 }

    /* Un color por tema, con los mismos tonos del resto de la app */
    .ia-sec.good h4 .ic { background: var(--mint); color: var(--mint-t) }
    .ia-sec.good li::marker { color: var(--mint-t) }
    .ia-sec.warn h4 .ic { background: var(--peach); color: var(--peach-t) }
    .ia-sec.warn li::marker { color: var(--peach-t) }
    .ia-sec.stock h4 .ic { background: var(--rose); color: var(--rose-t) }
    .ia-sec.stock li::marker { color: var(--rose-t) }
    .ia-sec.when h4 .ic { background: var(--acc-soft); color: var(--acc-txt) }
    .ia-sec.when li::marker { color: var(--acc) }
    .ia-sec.acts h4 .ic { background: var(--acc-soft); color: var(--acc-txt) }

    /* Acciones de la semana: una tarjeta numerada por acción, en fila */
    .ia-acts { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; margin-top: 6px }
    .ia-act { display: flex; gap: 14px; align-items: flex-start; background: var(--card); border-radius: 16px; padding: 18px 20px; box-shadow: var(--shadow) }
    .ia-act .n { flex: none; width: 30px; height: 30px; border-radius: 50%; display: grid; place-content: center; font-weight: 800; font-size: 14px; background: var(--acc); color: #fff }
    [data-theme="dark"] .ia-act .n { color: #1b1a20 }

    .ia-nota { margin: 22px 0 0; padding-top: 14px; border-top: 1px dashed var(--line); color: var(--mut); font-size: 12.5px }

    /* Cargando: la misma grilla, con bloques que brillan */
    .ia-ld { margin: 16px 0 0; color: var(--mut); font-weight: 600 }
    .ia-sk { background: var(--bg); border-radius: 20px; padding: 24px 26px; min-height: 124px }
    .ia-sk.s6 { grid-column: span 6 }
    .ia-sk.s12 { grid-column: span 12 }
    .ia-sk i { display: block; height: 12px; border-radius: 99px; margin-bottom: 13px; background: linear-gradient(90deg, var(--card) 25%, var(--acc-soft) 50%, var(--card) 75%); background-size: 200% 100%; animation: iaShimmer 1.3s linear infinite }
    .ia-sk i:nth-child(1) { width: 38% } .ia-sk i:nth-child(2) { width: 92% } .ia-sk i:nth-child(3) { width: 78% } .ia-sk i:nth-child(4) { width: 55% }
    @keyframes iaShimmer { to { background-position: -200% 0 } }

    /* Error */
    .ia-err { margin-top: 18px; padding: 16px 18px; border-radius: 16px; background: var(--rose); color: var(--rose-t); display: flex; align-items: center; justify-content: space-between; gap: 16px }
    .ia-err b { display: block; margin-bottom: 2px }
    .ia-err button { flex: none; background: var(--card); color: var(--rose-t); font-weight: 600 }

    @media (max-width: 1100px) {
      .ia-sec.s6, .ia-sk.s6 { grid-column: span 12 }
    }
    @media (prefers-reduced-motion: reduce) { .ia-sk i { animation: none } }
    </style>`
  );

  const panel = document.createElement("section");
  panel.id = "iaPanel";
  panel.className = "card";
  panel.setAttribute("aria-live", "polite");
  $("#stDash").parentNode.insertBefore(panel, $("#stDash"));

  const btn = document.createElement("button");
  btn.id = "iaBtn";
  btn.className = "ia-btn";
  btn.title = "Un análisis de las ventas del período, explicado en simple";
  btn.textContent = "✨ Analizar con IA";
  $("#stRefrescar").before(btn);

  // ---------- Texto del análisis (markdown simple → HTML seguro) ----------
  const ITEM = /^(?:[-*•]|\d+[.)])\s+(.*)$/; // viñeta o lista numerada
  const sinAcentos = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*([^*\n]+?)\*/g, "<em>$1</em>");

  // Líneas de texto → párrafos y listas. Todo pasa por esc() antes de armar el HTML.
  function md(lineas) {
    let html = "";
    let enLista = false;
    const cerrarLista = () => {
      if (enLista) html += "</ul>";
      enLista = false;
    };
    for (const crudo of lineas) {
      const l = esc(crudo).trim();
      let m;
      if (!l) {
        cerrarLista();
      } else if ((m = l.match(ITEM))) {
        if (!enLista) html += "<ul>";
        enLista = true;
        html += `<li>${inline(m[1])}</li>`;
      } else {
        cerrarLista();
        html += `<p>${inline(l)}</p>`;
      }
    }
    cerrarLista();
    return html;
  }

  // Corta el texto en secciones por cada "## Título"
  function secciones(texto) {
    const out = [];
    let actual = { titulo: null, lineas: [] };
    const guardar = () => {
      if (actual.titulo || actual.lineas.some((l) => l.trim())) out.push(actual);
    };
    for (const crudo of texto.split("\n")) {
      const m = crudo.trim().match(/^#{1,4}\s+(.*)$/);
      if (m) {
        guardar();
        actual = { titulo: m[1].trim(), lineas: [] };
      } else {
        actual.lineas.push(crudo);
      }
    }
    guardar();
    return out;
  }

  // Cada sección conocida tiene su color, su ícono y su ancho (en columnas de 12)
  const TIPOS = [
    { re: /resumen/, cls: "hero", icono: "📋", span: 12 },
    { re: /funcionando/, cls: "good", icono: "📈", span: 6 },
    { re: /atencion/, cls: "warn", icono: "⚠️", span: 6 },
    { re: /stock/, cls: "stock", icono: "📦", span: 6 },
    { re: /cuando/, cls: "when", icono: "🕒", span: 6 },
    { re: /semana|haria|accion/, cls: "acts", icono: "✅", span: 12 },
  ];
  const PLANO = { cls: "plain", icono: "", span: 12 };

  // Las acciones se muestran como tarjetas numeradas
  function accionesHtml(lineas) {
    const items = [];
    const resto = [];
    for (const l of lineas) {
      const m = esc(l).trim().match(ITEM);
      if (m) items.push(m[1]);
      else resto.push(l);
    }
    if (items.length < 2) return md(lineas);
    const tarjetas = items.map((t, i) => `<div class="ia-act"><span class="n">${i + 1}</span><div>${inline(t)}</div></div>`).join("");
    return md(resto) + `<div class="ia-acts">${tarjetas}</div>`;
  }

  function render(texto) {
    const secs = secciones(texto).map((s) => {
      const tipo = TIPOS.find((t) => t.re.test(sinAcentos(s.titulo || ""))) || PLANO;
      return { ...s, tipo, span: tipo.span };
    });

    // Si una tarjeta angosta quedaría sola en su fila, se estira para no dejar un hueco
    let fila = 0;
    secs.forEach((s, i) => {
      if (s.span === 12) {
        if (fila === 6) secs[i - 1].span = 12;
        fila = 0;
      } else {
        fila = fila === 6 ? 0 : 6;
      }
    });
    if (fila === 6) secs[secs.length - 1].span = 12;

    const tarjeta = (s) =>
      `<article class="ia-sec ${s.tipo.cls} s${s.span}">` +
      (s.titulo ? `<h4>${s.tipo.icono ? `<span class="ic">${s.tipo.icono}</span>` : ""}<span>${esc(s.titulo)}</span></h4>` : "") +
      (s.tipo.cls === "acts" ? accionesHtml(s.lineas) : md(s.lineas)) +
      `</article>`;
    return `<div class="ia-grid">${secs.map(tarjeta).join("")}</div>`;
  }

  // ---------- Estados del panel ----------
  function cabecera(sub, conAcciones) {
    return `<div class="ia-h">
      <div><h3>✨ Análisis con IA</h3><small>${sub}</small></div>
      <div class="ia-acc">
        ${conAcciones ? '<button id="iaRegen" title="Volver a generar el análisis">🔄 Regenerar</button>' : ""}
        <button id="iaCerrar" title="Cerrar">✕</button>
      </div>
    </div>`;
  }

  function pintarCargando(desde, hasta) {
    const sk = (span) => `<div class="ia-sk s${span}"><i></i><i></i><i></i><i></i></div>`;
    panel.innerHTML =
      cabecera(`${fechaCorta(desde)} al ${fechaCorta(hasta)}`, false) +
      `<p class="ia-ld">Analizando tus ventas… puede tardar unos segundos.</p>` +
      `<div class="ia-grid">${sk(12)}${sk(6)}${sk(6)}${sk(6)}${sk(6)}${sk(12)}</div>`;
  }

  function pintarResultado(r, desde, hasta) {
    const cuando = new Date(r.generado).toLocaleString("es-AR", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
    const sub = `${fechaCorta(desde)} al ${fechaCorta(hasta)} · ${r.cache ? `guardado de ${cuando} (los datos no cambiaron)` : `generado ${cuando}`}`;
    panel.innerHTML =
      cabecera(sub, true) +
      render(r.texto) +
      (r.modelo
        ? `<p class="ia-nota">Análisis generado por IA a partir de los números del período. Puede equivocarse o no conocer lo que pasó en el negocio: usalo como una guía y verificá antes de decidir algo importante.</p>`
        : "");
  }

  function pintarError(msg) {
    panel.innerHTML =
      cabecera("No se pudo generar", false) +
      `<div class="ia-err"><span><b>Algo salió mal</b>${esc(msg)}</span><button id="iaReintentar">Reintentar</button></div>`;
  }

  // ---------- Acciones ----------
  async function analizar(regenerar = false) {
    const [desde, hasta] = rango();
    if (!desde || !hasta) return toast("Elegí un rango de fechas");
    const mio = ++token;
    btn.disabled = true;
    panel.classList.add("on");
    pintarCargando(desde, hasta);
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    try {
      const r = await post(`/ia/analisis?desde=${desde}&hasta=${hasta}&regenerar=${regenerar}`, {});
      if (mio === token) pintarResultado(r, desde, hasta);
    } catch (e) {
      if (mio === token) pintarError(e.message || "Error desconocido");
    } finally {
      if (mio === token) btn.disabled = false;
    }
  }

  // Al cambiar de rango el análisis anterior ya no corresponde: se cierra
  function cerrarPanel() {
    token++;
    btn.disabled = false;
    panel.classList.remove("on");
    panel.innerHTML = "";
  }

  // ---------- Eventos ----------
  btn.addEventListener("click", () => analizar(false));
  panel.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.id === "iaRegen") analizar(true);
    if (b.id === "iaReintentar") analizar(false);
    if (b.id === "iaCerrar") cerrarPanel();
  });
  $("#stChips").addEventListener("click", (e) => e.target.closest(".chip") && cerrarPanel());
  $("#stDesde").addEventListener("change", cerrarPanel);
  $("#stHasta").addEventListener("change", cerrarPanel);
})();