// ==========================================================
// TPV · arqueo.js  (Caja > Arqueo)
// Se carga DESPUÉS de app.js y usa sus helpers: $, api, post, fmt, esc, toast, abrir, cerrar, mostrarExito, METODOS
// Agrega solo el botón "Crear arqueo" en el header de Caja y su modal.
// El arqueo no cierra ni toca ventas: compara lo esperado contra lo contado y lo guarda.
// ==========================================================
(() => {
  let aq = null; // vista previa abierta: { hasta, desde, metodos: [{metodo, esperado}], total, ... }

  const ICONOS = { efectivo: "💵", mercado_pago: "📱", transferencia: "🏦", debito: "💳", credito: "💳" };
  const nombreMetodo = (m) => METODOS[m] || m;
  const fmtFecha = (iso) =>
    new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
  const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

  // ---------- Montaje ----------
  document.head.insertAdjacentHTML(
    "beforeend",
    `<style>
    #mArqueo .box { width: 760px; max-width: 95vw; max-height: 94vh; overflow-y: auto; padding: 32px 34px; display: flex; flex-direction: column; gap: 20px }

    /* Encabezado: título + total que dice el sistema */
    .aq-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; padding-bottom: 18px; border-bottom: 1px solid var(--line) }
    .aq-top h2 { margin: 0; font-size: 26px }
    .aq-per { display: inline-flex; align-items: center; gap: 8px; margin-top: 10px; padding: 6px 14px; border-radius: 99px; background: var(--acc-soft); color: var(--acc-txt); font-size: 13px; font-weight: 600 }
    .aq-sis { text-align: right; flex: none }
    .aq-sis small { display: block; color: var(--mut); font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px }
    .aq-sis b { display: block; font-size: 38px; font-weight: 800; letter-spacing: -.5px; color: var(--acc-txt); font-variant-numeric: tabular-nums; line-height: 1.15 }
    .aq-sis span { color: var(--mut); font-size: 13px }

    .aq-lead { margin: 0; color: var(--mut); font-size: 14px }

    /* Tarjetas por método */
    .aq-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px }
    .aq-card { display: flex; flex-direction: column; gap: 14px; padding: 18px 20px; border-radius: 22px; background: var(--input); border: 2px solid transparent; transition: border-color .15s, background .15s }
    .aq-card.efectivo { grid-column: span 2; background: var(--mint) }
    .aq-card:focus-within { border-color: var(--acc) }
    .aq-card.ok { border-color: var(--mint-t) }
    .aq-card.falta { border-color: var(--rose-t) }
    .aq-card.sobra { border-color: var(--peach-t) }

    .aq-cab { display: flex; align-items: center; gap: 12px }
    .aq-ic { width: 44px; height: 44px; border-radius: 14px; display: grid; place-content: center; font-size: 22px; background: var(--card); flex: none }
    .aq-card.efectivo .aq-ic { background: rgba(255, 255, 255, .55) }
    [data-theme="dark"] .aq-card.efectivo .aq-ic { background: rgba(0, 0, 0, .25) }
    .aq-nm { flex: 1; min-width: 0 }
    .aq-nm b { display: block; font-size: 17px }
    .aq-card.efectivo .aq-nm b { color: var(--mint-t) }
    .aq-nm small { display: block; color: var(--mut); font-size: 13px; margin-top: 1px }
    .aq-nm small em { font-style: normal; font-weight: 700; color: var(--txt); font-variant-numeric: tabular-nums }
    .aq-eq { padding: 7px 12px; font-size: 12.5px; font-weight: 600; border-radius: 99px; background: var(--card); color: var(--mut); white-space: nowrap }
    .aq-eq:hover { color: var(--acc-txt); background: var(--acc-soft) }

    .aq-in { position: relative }
    .aq-in span { position: absolute; left: 18px; top: 50%; transform: translateY(-50%); font-size: 22px; font-weight: 700; color: var(--mut); pointer-events: none }
    .aq-in input { font-size: 28px; font-weight: 800; padding: 14px 18px 14px 42px; background: var(--card); border-radius: 16px; font-variant-numeric: tabular-nums }
    .aq-card.efectivo .aq-in input { font-size: 32px }

    .aq-chip { align-self: flex-start; padding: 5px 13px; border-radius: 99px; font-size: 13px; font-weight: 700; background: var(--card); color: var(--mut); font-variant-numeric: tabular-nums }
    .aq-chip.ok { background: var(--mint); color: var(--mint-t) }
    .aq-chip.falta { background: var(--rose); color: var(--rose-t) }
    .aq-chip.sobra { background: var(--peach); color: var(--peach-t) }

    /* Resumen final */
    .aq-res { display: grid; grid-template-columns: 1fr 1fr 1.5fr; gap: 0; border-radius: 22px; background: var(--input); overflow: hidden }
    .aq-res > div { padding: 18px 22px }
    .aq-res > div + div { border-left: 1px dashed var(--line) }
    .aq-res small { display: block; color: var(--mut); font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px }
    .aq-res b { display: block; margin-top: 4px; font-size: 26px; font-weight: 800; font-variant-numeric: tabular-nums }
    .aq-res .dif { transition: background .15s }
    .aq-res .dif b { font-size: 30px }
    .aq-res .dif span { display: block; font-size: 13px; font-weight: 600; margin-top: 2px; color: var(--mut) }
    .aq-res .dif.ok { background: var(--mint); color: var(--mint-t) }
    .aq-res .dif.falta { background: var(--rose); color: var(--rose-t) }
    .aq-res .dif.sobra { background: var(--peach); color: var(--peach-t) }
    .aq-res .dif.ok small, .aq-res .dif.falta small, .aq-res .dif.sobra small, .aq-res .dif.ok span, .aq-res .dif.falta span, .aq-res .dif.sobra span { color: inherit; opacity: .8 }

    .aq-nota label { margin: 0 0 6px }
    #aqErr { margin: -8px 0 -4px }
    #mArqueo .acc { margin-top: 0 }
    #mArqueo .acc button { padding: 18px; font-size: 18px }

    @media (max-width: 700px) {
      .aq-grid { grid-template-columns: 1fr }
      .aq-card.efectivo { grid-column: auto }
      .aq-top { flex-direction: column }
      .aq-sis { text-align: left }
      .aq-res { grid-template-columns: 1fr 1fr }
      .aq-res .dif { grid-column: span 2; border-left: 0 !important }
    }
    </style>`
  );

  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="modal" id="mArqueo">
      <div class="box">
        <div class="aq-top">
          <div>
            <h2>Arqueo de caja</h2>
            <div class="aq-per" id="aqPer"></div>
          </div>
          <div class="aq-sis"><small>Según el sistema</small><b id="aqSis">$0</b><span id="aqTk"></span></div>
        </div>

        <p class="aq-lead">Escribí lo que contaste en cada método. Para los pagos digitales, el monto que verificaste en tu app o cuenta.</p>

        <div class="aq-grid" id="aqGrid"></div>

        <div class="aq-res">
          <div><small>Sistema</small><b id="aqResSis">$0</b></div>
          <div><small>Contado</small><b id="aqResCon">$0</b></div>
          <div class="dif" id="aqResDif"><small>Diferencia</small><b>—</b><span>Completá los montos</span></div>
        </div>

        <div class="aq-nota">
          <label for="aqNota">Nota (opcional)</label>
          <input id="aqNota" placeholder="Ej: cierre de turno mañana" autocomplete="off">
        </div>

        <div class="err" id="aqErr"></div>
        <div class="acc">
          <button id="aqCerrar">Cancelar</button>
          <button class="go" id="aqGuardar" style="flex:1.6">✅ Guardar arqueo</button>
        </div>
      </div>
    </div>`
  );

  // Botón en el header de Caja, antes del reloj
  const header = document.querySelector("#view-caja header.top");
  const btn = document.createElement("button");
  btn.id = "btnArqueo";
  btn.className = "act";
  btn.style.cssText = "padding:10px 16px; font-weight:600; gap:8px; margin-left:10px";
  btn.title = "Contar la caja y guardar el arqueo";
  btn.textContent = "🧮 Crear arqueo";
  header.insertBefore(btn, header.querySelector(".reloj"));

  // ---------- Lógica ----------
  const inputs = () => [...document.querySelectorAll("#aqGrid input[data-m]")];
  const esperadoDe = (m) => aq.metodos.find((x) => x.metodo === m).esperado;
  const estado = (dif) => (dif === 0 ? "ok" : dif < 0 ? "falta" : "sobra");
  const textoDif = (dif) => (dif === 0 ? "✓ Coincide" : dif < 0 ? `Falta ${fmt(-dif)}` : `Sobra ${fmt(dif)}`);

  function recalcular() {
    let contadoTotal = 0;
    let algo = false;

    inputs().forEach((inp) => {
      const m = inp.dataset.m;
      const card = inp.closest(".aq-card");
      const chip = card.querySelector(".aq-chip");
      card.classList.remove("ok", "falta", "sobra");

      if (inp.value.trim() === "") {
        chip.className = "aq-chip";
        chip.textContent = "Sin completar";
        return;
      }
      algo = true;
      const con = Math.round(Number(inp.value) * 100);
      const dif = con - esperadoDe(m);
      contadoTotal += con;
      card.classList.add(estado(dif));
      chip.className = "aq-chip " + estado(dif);
      chip.textContent = textoDif(dif);
    });

    $("#aqResCon").textContent = fmt(contadoTotal);
    const box = $("#aqResDif");
    box.classList.remove("ok", "falta", "sobra");
    if (!algo) {
      box.querySelector("b").textContent = "—";
      box.querySelector("span").textContent = "Completá los montos";
      return;
    }
    const dif = contadoTotal - aq.total;
    box.classList.add(estado(dif));
    box.querySelector("b").textContent = dif === 0 ? fmt(0) : (dif > 0 ? "+" : "−") + fmt(Math.abs(dif));
    box.querySelector("span").textContent = dif === 0 ? "La caja cuadra perfecto 🎉" : dif < 0 ? "Falta plata en la caja" : "Sobra plata en la caja";
  }

  async function abrirArqueo() {
    try {
      aq = await api("/caja/arqueo/preview");
    } catch (e) {
      return toast("No se pudo preparar el arqueo: " + e.message);
    }

    $("#aqPer").textContent = aq.ultimo_arqueo
      ? `🕒 Desde el arqueo anterior · ${fmtFecha(aq.desde)}`
      : "🕒 Desde el inicio del día";
    $("#aqSis").textContent = fmt(aq.total);
    $("#aqTk").textContent = plural(aq.cantidad_ventas, "ticket cobrado", "tickets cobrados");
    $("#aqResSis").textContent = fmt(aq.total);

    $("#aqGrid").innerHTML = aq.metodos
      .map(
        (m) => `<div class="aq-card ${esc(m.metodo)}">
        <div class="aq-cab">
          <div class="aq-ic">${ICONOS[m.metodo] || "💰"}</div>
          <div class="aq-nm"><b>${esc(nombreMetodo(m.metodo))}</b><small>Sistema: <em>${fmt(m.esperado)}</em></small></div>
          ${m.esperado > 0 ? `<button class="aq-eq" type="button" data-eq="${esc(m.metodo)}" title="Usar el monto del sistema">= Sistema</button>` : ""}
        </div>
        <div class="aq-in"><span>$</span><input type="number" min="0" step="any" placeholder="0" data-m="${esc(m.metodo)}"></div>
        <div class="aq-chip">Sin completar</div>
      </div>`
      )
      .join("");

    $("#aqNota").value = "";
    $("#aqErr").textContent = "";
    recalcular();
    abrir("#mArqueo");
    setTimeout(() => inputs()[0] && inputs()[0].focus(), 50);
  }

  async function guardarArqueo() {
    const contado = {};
    let vacios = 0;
    for (const inp of inputs()) {
      const m = inp.dataset.m;
      if (inp.value.trim() === "") {
        contado[m] = 0;
        if (esperadoDe(m) > 0) vacios++;
        continue;
      }
      const v = Number(inp.value);
      if (!(v >= 0)) return ($("#aqErr").textContent = `Revisá el monto de ${nombreMetodo(m)}`);
      contado[m] = Math.round(v * 100);
    }
    if (vacios && !confirm(`Dejaste ${plural(vacios, "método con ventas", "métodos con ventas")} sin completar.\nSe guardan como $0. ¿Continuar?`)) return;

    $("#aqGuardar").disabled = true;
    try {
      const res = await post("/caja/arqueo", { hasta: aq.hasta, contado, nota: $("#aqNota").value });
      const a = res.arqueo;
      cerrar("#mArqueo");
      mostrarExito({
        titulo: "Arqueo guardado",
        sub: `${plural(a.cantidad_ventas, "ticket", "tickets")} · contado ${fmt(a.total_contado)}`,
        monto: fmt(a.total_esperado),
        fila: { label: a.diferencia === 0 ? "Sin diferencia" : a.diferencia > 0 ? "Sobrante" : "Faltante", valor: fmt(Math.abs(a.diferencia)) },
        duracion: 3200,
      });
    } catch (e) {
      $("#aqErr").textContent = e.message;
    } finally {
      $("#aqGuardar").disabled = false;
    }
  }

  // ---------- Eventos ----------
  btn.addEventListener("click", abrirArqueo);
  $("#aqCerrar").addEventListener("click", () => cerrar("#mArqueo"));
  $("#aqGuardar").addEventListener("click", guardarArqueo);
  $("#aqGrid").addEventListener("input", recalcular);

  // "= Sistema": copia el monto del sistema al campo (útil para pagos digitales ya verificados)
  $("#aqGrid").addEventListener("click", (e) => {
    const b = e.target.closest("[data-eq]");
    if (!b) return;
    const inp = document.querySelector(`#aqGrid input[data-m="${b.dataset.eq}"]`);
    inp.value = esperadoDe(b.dataset.eq) / 100;
    recalcular();
    inp.focus();
  });

  // Enter: pasa al siguiente campo; en la nota guarda
  $("#mArqueo").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.target.tagName === "BUTTON") return;
    e.preventDefault();
    const lista = [...inputs(), $("#aqNota")];
    const i = lista.indexOf(e.target);
    if (e.target.id === "aqNota") guardarArqueo();
    else if (i >= 0) lista[i + 1].focus();
  });
})();