// ==========================================================
// TPV · cuentas.js  (Admin > Cuentas corrientes)
// Se carga DESPUÉS de app.js y usa sus helpers: $, api, post, fmt, esc, toast, abrir, cerrar, nav, mostrarExito, aplicarTema, METODOS
//
// Pantalla: abrís una cuenta (nombre + deuda inicial), la caja le carga ventas con el medio de pago
// "Cuenta corriente", y acá registrás lo que el cliente va pagando.
//
// Al abrir una cuenta se ve un modal grande con dos páginas (botón de flecha para cambiar):
//   1. Deudas: cada ticket a cuenta con lo que falta, para saldarlos de a uno + historial de movimientos.
//   2. Gráfico: una sola línea con la deuda (sube en rojo con cada compra, baja en verde con cada pago), suave y con degradé, con su media.
//
// Índice:
//   1. Estado y utilidades
//   2. Montaje (estilos y HTML)
//   3. Lista de cuentas
//   4. Nueva / editar cuenta
//   5. Detalle: páginas, deudas e historial
//   6. Gráfico: curva de deuda con degradé y media
//   7. Pagos
//   8. Eventos
// ==========================================================
(() => {
  // ==========================================================
  // 1. ESTADO Y UTILIDADES
  // ==========================================================
  let cuentas = []; // todas, con su saldo
  let cF = { q: "", vista: "activas" }; // vista: activas | deuda | archivadas
  let editId = null; // cuenta en edición (null = cuenta nueva)
  let editDesdeDet = false; // la edición se abrió desde el detalle

  let detId = null; // cuenta abierta en el detalle
  let detDeudas = []; // deudas de esa cuenta (tickets + deuda inicial) con lo que falta de cada una
  let detSerie = []; // evolución para el gráfico
  let verSaldadas = false; // mostrar también las deudas ya saldadas
  let pag = "deudas"; // página visible del detalle: "deudas" | "grafico"

  let pagoCta = null; // cuenta del pop-up de pago
  let pagoDeuda = null; // deuda puntual que se está saldando (null = pago general)
  let pagoTope = 0; // máximo que se puede pagar en este pop-up (centavos)
  let pagoDesdeDet = false; // el pago se abrió desde el detalle (al terminar se vuelve a él)

  const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;
  const centavos = (txt) => Math.round(Number(txt || 0) * 100);
  const fechaCorta = (iso) =>
    iso ? new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—";
  const fechaLarga = (iso) =>
    new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const put = (url, body) =>
    api(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const nombreMetodo = (m) => METODOS[m] || m || "";
  const nombreDeuda = (d) => (d.ref === 0 ? "Deuda inicial" : `Ticket #${d.venta_id}`);


  // ==========================================================
  // 2. MONTAJE (estilos y HTML)
  // ==========================================================
  document.head.insertAdjacentHTML(
    "beforeend",
    `<style>
    /* ----- Lista ----- */
    #ccBody .pr-row { cursor: pointer }
    #ccBody .pr-row:hover { background: var(--acc-soft) }
    /* Tabla: "Cuenta" a la izquierda y con más lugar; el resto en columnas iguales, centradas */
    #ccTabla .pr-head, #ccTabla .pr-row { display: grid; grid-template-columns: var(--cols); align-items: center; column-gap: 16px; padding-left: 22px; padding-right: 22px }
    #ccTabla .pr-head > span, #ccTabla .pr-row > span { min-width: 0; text-align: center }
    #ccTabla .pr-head > span:first-child, #ccTabla .pr-row > span:first-child { text-align: left }
    #ccTabla .pr-nom { overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
    .cc-chip { display: inline-block; padding: 4px 10px; border: 0; border-radius: 999px; font-family: inherit; font-size: 12.5px; font-weight: 700; white-space: nowrap }
    .cc-chip.debe { background: var(--rose); color: var(--rose-t) }
    .cc-chip.ok { background: var(--mint); color: var(--mint-t) }
    button.cc-chip:hover { filter: brightness(.95); box-shadow: 0 0 0 2px currentColor }
    .cc-lnk { margin-left: 8px; padding: 0; background: none; box-shadow: none; color: var(--acc-txt); font-size: 12.5px; font-weight: 600; text-decoration: underline }
    .cc-sel { width: 100%; height: 46px; border-radius: 14px; background: var(--input); border: 2px solid var(--line); padding: 0 12px; font-weight: 600; font-family: inherit }
    .cc-hint { margin: 6px 0 0; color: var(--mut); font-size: 12.5px }
    .cc-prev { margin-top: 8px; min-height: 20px; font-size: 13px; color: var(--mut) }
    .cc-prev.debe { color: var(--rose-t) }
    .cc-prev.ok { color: var(--mint-t) }
    .cc-dest { margin: 10px 0 4px; padding: 10px 12px; border-radius: 12px; background: var(--bg); font-size: 13px; color: var(--mut); line-height: 1.45 }
    .cc-dest b { color: var(--txt) }

    /* ----- Detalle: modal grande ----- */
    #mCuentaDet .box { width: 1120px; max-width: 96vw; height: min(780px, 94vh); max-height: 94vh; padding: 26px 30px 24px; display: flex; flex-direction: column; gap: 14px; overflow: hidden }
    .cc-dh { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px }
    .cc-dh h2 { margin: 0 }
    .cc-dh p { margin: 2px 0 0 }
    .cc-switch { display: inline-flex; align-items: center; gap: 8px; padding: 10px 18px; border-radius: 99px; background: var(--acc-soft); color: var(--acc-txt); font-weight: 700; white-space: nowrap }
    .cc-switch span { font-size: 18px; line-height: 1; transition: transform .2s }
    .cc-switch:hover span { transform: translateX(4px) }
    .cc-switch.back:hover span { transform: translateX(-4px) }

    .cc-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px }
    .cc-kpis div { padding: 10px 14px; border-radius: 14px; background: var(--bg) }
    .cc-kpis small { display: block; margin-bottom: 2px; color: var(--mut); font-size: 12px }
    .cc-kpis b { font-size: 17px; font-variant-numeric: tabular-nums }
    .cc-kpis .sal b { color: var(--rose-t) }
    .cc-kpis .sal.ok b { color: var(--mint-t) }

    /* Páginas (se cambian con la flecha) */
    .cc-pages { flex: 1; min-height: 0; position: relative }
    .cc-pg { position: absolute; inset: 0; display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 18px; animation: ccPg .25s ease }
    .cc-pg.graf { display: flex; flex-direction: column; gap: 12px }
    .cc-pg[hidden] { display: none !important }
    @keyframes ccPg { from { opacity: 0; transform: translateX(14px) } }

    .cc-col { min-height: 0; display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: 18px; overflow: hidden }
    .cc-col-h { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--line); background: var(--bg) }
    .cc-col-h b { font-size: 15px }
    .cc-col-h small { display: block; margin-top: 1px; color: var(--mut); font-size: 12.5px }
    .cc-scroll { flex: 1; min-height: 0; overflow-y: auto }
    .cc-vacio { padding: 26px; text-align: center; color: var(--mut); font-size: 14px }

    /* Deudas */
    .cc-tip-top { padding: 10px 16px; border-bottom: 1px solid var(--line); color: var(--mut); font-size: 12.5px; line-height: 1.45 }
    .cc-deu { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 14px; align-items: center; padding: 12px 16px; border-top: 1px solid var(--line) }
    .cc-deu:first-child { border-top: 0 }
    .cc-deu .inf b { font-size: 15px }
    .cc-deu .inf small { display: block; margin-top: 1px; color: var(--mut); font-size: 12.5px }
    .cc-bar { height: 6px; margin-top: 8px; border-radius: 99px; background: var(--bg); overflow: hidden }
    .cc-bar i { display: block; height: 100%; border-radius: 99px; background: var(--mint-t); transition: width .3s }
    .cc-deu .mto { text-align: right }
    .cc-deu .mto b { display: block; font-size: 16px; color: var(--rose-t); font-variant-numeric: tabular-nums }
    .cc-deu .mto small { color: var(--mut); font-size: 12px }
    .cc-deu.ok { opacity: .6 }
    .cc-sal { padding: 9px 16px; font-size: 13.5px; border-radius: 12px }

    /* Historial */
    .cc-mov { display: grid; grid-template-columns: 70px minmax(0, 1fr) 110px 28px; gap: 10px; align-items: center; padding: 10px 14px; border-top: 1px solid var(--line); font-size: 14px }
    .cc-mov:first-child { border-top: 0 }
    .cc-mov .f { color: var(--mut); font-size: 13px }
    .cc-mov .c small { display: block; color: var(--mut); font-size: 12.5px }
    .cc-mov .m { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums }
    .cc-mov .m.mas { color: var(--rose-t) }
    .cc-mov .m.menos { color: var(--mint-t) }
    .cc-mov.anul .c b, .cc-mov.anul .m { text-decoration: line-through; opacity: .55 }
    .cc-del { padding: 4px; background: none; box-shadow: none; color: var(--mut); font-size: 14px }
    .cc-del:hover { color: var(--rose-t) }

    /* Gráfico: curva de deuda (roja sube, verde baja) con degradé + media */
    .cc-leg { display: flex; flex-wrap: wrap; gap: 8px 22px; padding: 2px 4px }
    .cc-leg span { display: inline-flex; align-items: center; gap: 8px; color: var(--mut); font-size: 13px; font-weight: 600 }
    .cc-leg i { display: inline-block; width: 24px; height: 0 }
    .cc-graf { position: relative; flex: 1; min-height: 220px; border: 1px solid var(--line); border-radius: 18px; overflow: hidden }
    .cc-graf svg { display: block }
    .cc-graf text { fill: var(--mut); font-size: 11.5px; font-family: inherit }
    .cc-graf text.tm { fill: var(--acc-txt); font-size: 12px; font-weight: 700 }
    .cc-graf .gl { stroke: var(--line); stroke-width: 1 }
    .cc-graf .gl.base { stroke: var(--mut); opacity: .35 }
    .cc-graf .sg { fill: none; stroke-width: 3.2; stroke-linecap: round; stroke-linejoin: round }
    .cc-graf .sg.eq { stroke: var(--mut); opacity: .6 }
    .cc-graf .sg.tail { stroke-width: 2; stroke-dasharray: 5 5 }
    .cc-graf .lm { stroke: var(--acc); stroke-width: 2; stroke-dasharray: 7 5 }
    .cc-graf .ar { animation: ccFade .9s ease both }
    .cc-graf .gd { stroke: var(--mut); stroke-dasharray: 4 4; opacity: 0 }
    .cc-graf .gp { stroke: var(--card); stroke-width: 3; opacity: 0 }
    .cc-graf .dt { stroke: var(--card); stroke-width: 2 }
    @keyframes ccFade { from { opacity: 0 } }
    .cc-gtip { position: absolute; z-index: 2; top: 12px; left: 0; min-width: 200px; padding: 10px 14px; border-radius: 14px; background: var(--txt); color: var(--card); font-size: 12.5px; line-height: 1.55; box-shadow: 0 8px 24px rgba(0, 0, 0, .25); pointer-events: none; opacity: 0; transition: opacity .12s }
    .cc-gtip b { display: block; margin-bottom: 4px; font-size: 13px }
    .cc-gtip div { display: flex; justify-content: space-between; gap: 16px }
    .cc-gtip .ev { margin-bottom: 4px; padding-bottom: 4px; border-bottom: 1px solid rgba(128, 128, 128, .35) }
    .cc-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px }
    .cc-stats div { padding: 10px 14px; border-radius: 14px; background: var(--bg) }
    .cc-stats small { display: block; color: var(--mut); font-size: 12px }
    .cc-stats b { font-size: 16px; font-variant-numeric: tabular-nums }
    .cc-stats em { margin-left: 6px; font-style: normal; color: var(--mut); font-size: 12px }

    .cc-foot { display: flex; gap: 10px }
    .cc-foot button { padding: 13px }

    @media (max-width: 900px) {
      .cc-pg { grid-template-columns: 1fr; grid-template-rows: 1fr 1fr }
      .cc-kpis, .cc-stats { grid-template-columns: 1fr 1fr }
    }
    @media (prefers-reduced-motion: reduce) { .cc-graf .ar, .cc-pg { animation: none } }
    </style>`
  );

  const cabecera = `
    <header class="top">
      <button onclick="nav('admin')" style="padding:10px 14px">⬅ Volver</button>
      <div class="brand"><b>Cuentas corrientes</b><small id="ccSub">Clientes que compran a cuenta</small></div>
      <div class="sp"></div>
      <div class="pill reloj">--:--</div>
      <button class="theme" title="Cambiar tema"
        onclick="aplicarTema(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark')">🌙</button>
    </header>`;

  document.body.insertAdjacentHTML(
    "beforeend",
    `
  <!-- VISTA: ADMIN · CUENTAS CORRIENTES -->
  <div id="view-admin-cuentas" class="view app" style="display:none;">
    ${cabecera}
    <main>
      <div class="pr-bar">
        <div class="searchwrap pr-search">
          <span class="ic">🔍</span>
          <input id="ccBuscar" placeholder="Buscar cuenta…" autocomplete="off">
        </div>
        <select class="pr-sel" id="ccVista" aria-label="Mostrar" style="width:190px"></select>
        <button class="go pr-nuevo" id="ccNueva">＋ Nueva cuenta</button>
      </div>
      <div class="card pr-card" id="ccTabla" style="--cols: minmax(220px, 2.2fr) repeat(4, minmax(120px, 1fr))">
        <div class="pr-scroll">
          <div class="pr-head">
            <span>Cuenta</span><span>Deuda inicial</span><span>Compras a cuenta</span><span>Pagos</span><span>Saldo</span>
          </div>
          <div id="ccBody"></div>
        </div>
        <div class="pr-foot" id="ccFoot"></div>
      </div>
    </main>
  </div>

  <!-- MODAL: NUEVA / EDITAR CUENTA -->
  <div class="modal" id="mCuentaForm">
    <div class="box" style="width:460px">
      <h2 id="ccFTit">Nueva cuenta corriente</h2>
      <p id="ccFSub">Cargá el nombre del cliente y lo que ya te debe.</p>
      <label>Nombre del cliente</label>
      <input id="ccNombre" placeholder="Ej: Kiosco Don Pedro" autocomplete="off">
      <label>Deuda inicial ($)</label>
      <input id="ccDeuda" type="number" min="0" step="any" placeholder="0" autocomplete="off">
      <p class="cc-hint" id="ccDeudaHint">Lo que el cliente ya te debe hoy. Si es nuevo, dejalo en 0.</p>
      <label>Nota · opcional</label>
      <input id="ccNota" placeholder="Ej: Paga los viernes" autocomplete="off">
      <div id="ccEstadoBox" style="display:none">
        <label>Estado</label>
        <select class="cc-sel" id="ccEstado">
          <option value="1">Activa · aparece en la caja</option>
          <option value="0">Archivada · no aparece en la caja</option>
        </select>
      </div>
      <div class="err" id="ccFErr"></div>
      <div class="acc">
        <button id="ccFCancel">Cancelar</button>
        <button class="go" id="ccFGuardar">Guardar cuenta</button>
      </div>
    </div>
  </div>

  <!-- MODAL: DETALLE DE UNA CUENTA (grande, con dos páginas) -->
  <div class="modal" id="mCuentaDet">
    <div class="box">
      <div class="cc-dh">
        <div><h2 id="ccDNom">Cuenta</h2><p id="ccDNota"></p></div>
        <button type="button" class="cc-switch" id="ccDSwitch">Ver gráfico <span>→</span></button>
      </div>

      <div class="cc-kpis">
        <div><small>Deuda inicial</small><b id="ccKIni"></b></div>
        <div><small>Compras a cuenta</small><b id="ccKCom"></b></div>
        <div><small>Pagos</small><b id="ccKPag"></b></div>
        <div class="sal" id="ccKSalBox"><small id="ccKSalLbl">Debe</small><b id="ccKSal"></b></div>
      </div>

      <div class="cc-pages">
        <!-- Página 1: deudas para saldar + historial -->
        <section class="cc-pg" id="ccPagDeudas">
          <div class="cc-col">
            <div class="cc-col-h" id="ccDDeuHead"></div>
            <div class="cc-tip-top">Con <b>Saldar</b> elegís qué deuda pagar. Un pago general se descuenta de las más viejas primero.</div>
            <div class="cc-scroll" id="ccDDeudas"></div>
          </div>
          <div class="cc-col">
            <div class="cc-col-h"><div><b>Movimientos</b><small>Compras y pagos, lo más nuevo primero</small></div></div>
            <div class="cc-scroll" id="ccDMovs"></div>
          </div>
        </section>

        <!-- Página 2: gráfico de líneas -->
        <section class="cc-pg graf" id="ccPagGraf" hidden>
          <div class="cc-leg" id="ccGLeg"></div>
          <div class="cc-graf" id="ccGraf"></div>
          <div class="cc-stats" id="ccGStats"></div>
        </section>
      </div>

      <div class="cc-foot">
        <button id="ccDCerrar" style="flex:.6">Cerrar</button>
        <button id="ccDEditar" style="flex:.6">✏️ Editar</button>
        <button class="go" id="ccDPagar" style="flex:1.2">💵 Pago general</button>
      </div>
    </div>
  </div>

  <!-- MODAL: REGISTRAR PAGO -->
  <div class="modal" id="mCuentaPago">
    <div class="box" style="width:460px">
      <h2 id="ccPTit">Registrar pago</h2>
      <p id="ccPSub"></p>
      <div class="cc-dest" id="ccPDest"></div>
      <label>Monto ($)<button type="button" class="cc-lnk" id="ccPTodo">pagó todo</button></label>
      <input id="ccPMonto" type="number" min="0" step="any" placeholder="0" autocomplete="off">
      <label>¿Cómo pagó?</label>
      <select class="cc-sel" id="ccPMetodo"></select>
      <label>Nota · opcional</label>
      <input id="ccPNota" placeholder="Ej: entrega parcial" autocomplete="off">
      <div class="cc-prev" id="ccPPrev"></div>
      <div class="err" id="ccPErr"></div>
      <div class="acc">
        <button id="ccPCancel">Cancelar</button>
        <button class="go" id="ccPGuardar">Guardar pago</button>
      </div>
    </div>
  </div>`
  );
  aplicarTema(document.documentElement.dataset.theme || "light"); // pinta el ícono del tema en los botones nuevos

  $("#ccPMetodo").innerHTML = Object.entries(METODOS)
    .filter(([k]) => k !== "cuenta_corriente")
    .map(([k, v]) => `<option value="${k}">${esc(v)}</option>`)
    .join("");

  // Tarjeta en el panel de administración
  document.querySelector("#view-admin .admin-grid").insertAdjacentHTML(
    "beforeend",
    `<button class="act admin-card" onclick="ccAbrir()">
      <div class="e" style="background:var(--peach);color:var(--peach-t)">📒</div>
      <span><b>Cuentas corrientes</b><small>Clientes que compran a cuenta</small></span>
    </button>`
  );


  // ==========================================================
  // 3. LISTA DE CUENTAS
  // ==========================================================
  function ccFiltradas() {
    const q = norm(cF.q.trim());
    return cuentas.filter((c) => {
      if (cF.vista === "archivadas" ? c.activo : !c.activo) return false;
      if (cF.vista === "deuda" && !(c.saldo > 0)) return false;
      return !q || norm(c.nombre).includes(q) || norm(c.nota).includes(q);
    });
  }

  const saldoChip = (c, conBoton) =>
    c.saldo > 0
      ? `<${conBoton ? `button type="button" data-pago="${c.id}" title="Click para registrar un pago"` : "span"} class="cc-chip debe">Debe ${fmt(c.saldo)}</${conBoton ? "button" : "span"}>`
      : `<span class="cc-chip ok">${c.saldo < 0 ? "A favor " + fmt(-c.saldo) : "Al día"}</span>`;

  function ccRender() {
    const activas = cuentas.filter((c) => c.activo);
    const conDeuda = activas.filter((c) => c.saldo > 0);
    const archivadas = cuentas.length - activas.length;
    $("#ccVista").innerHTML = [
      ["activas", `Activas (${activas.length})`],
      ["deuda", `Con deuda (${conDeuda.length})`],
      ["archivadas", `Archivadas (${archivadas})`],
    ]
      .map(([v, t]) => `<option value="${v}">${t}</option>`)
      .join("");
    $("#ccVista").value = cF.vista;

    const lista = ccFiltradas();
    $("#ccBody").innerHTML = lista.length
      ? lista
          .map(
            (c) => `<div class="pr-row" data-id="${c.id}" tabindex="0" title="${esc(c.nota || "Ver deudas e historial")}">
        <span class="pr-nom">${esc(c.nombre)}</span>
        <span class="pr-precio">${c.deuda_inicial ? fmt(c.deuda_inicial) : "—"}</span>
        <span class="pr-precio">${c.compras ? fmt(c.compras) : "—"}</span>
        <span class="pr-precio">${c.pagos ? fmt(c.pagos) : "—"}</span>
        <span>${saldoChip(c, true)}</span>
      </div>`
          )
          .join("")
      : `<div class="pr-vacio">
          <b>📒</b>
          <span>${cuentas.length ? "No hay cuentas con ese filtro." : "Todavía no abriste ninguna cuenta corriente."}</span>
          ${cuentas.length ? "" : '<button class="go" data-nueva>＋ Abrir la primera</button>'}
        </div>`;

    const deuda = lista.reduce((s, c) => s + Math.max(0, c.saldo), 0);
    $("#ccFoot").innerHTML =
      `<span>${plural(lista.length, "cuenta", "cuentas")}</span>` + (deuda ? `<span>Deuda total: <b>${fmt(deuda)}</b></span>` : "");
    const total = conDeuda.reduce((s, c) => s + c.saldo, 0);
    $("#ccSub").textContent = plural(activas.length, "cuenta activa", "cuentas activas") + (total ? ` · Te deben ${fmt(total)}` : "");
  }

  async function ccCargar() {
    try {
      cuentas = await api("/cuentas");
      ccRender();
    } catch (e) {
      toast(e.message);
    }
  }

  function ccIniciar() {
    cF = { q: "", vista: "activas" };
    $("#ccBuscar").value = "";
    ccCargar();
  }
  window.ccAbrir = () => {
    nav("admin-cuentas");
    ccIniciar();
  };


  // ==========================================================
  // 4. NUEVA / EDITAR CUENTA
  // ==========================================================
  function ccForm(c = null, desdeDet = false) {
    editId = c ? c.id : null;
    editDesdeDet = desdeDet;
    $("#ccFTit").textContent = c ? "Editar cuenta" : "Nueva cuenta corriente";
    $("#ccFSub").textContent = c ? "Corregí los datos de la cuenta." : "Cargá el nombre del cliente y lo que ya te debe.";
    $("#ccNombre").value = c ? c.nombre : "";
    $("#ccDeuda").value = c && c.deuda_inicial ? c.deuda_inicial / 100 : "";
    $("#ccNota").value = c ? c.nota : "";
    $("#ccDeudaHint").textContent = c
      ? "Es lo que debía al abrir la cuenta. Cambiarla ajusta el saldo."
      : "Lo que el cliente ya te debe hoy. Si es nuevo, dejalo en 0.";
    $("#ccEstadoBox").style.display = c ? "block" : "none";
    $("#ccEstado").value = c && !c.activo ? "0" : "1";
    $("#ccFGuardar").textContent = c ? "Guardar cambios" : "Crear cuenta";
    $("#ccFErr").textContent = "";
    abrir("#mCuentaForm");
    setTimeout(() => $("#ccNombre").focus(), 50);
  }

  async function ccGuardar() {
    const err = (t) => ($("#ccFErr").textContent = t);
    const nombre = $("#ccNombre").value.trim();
    const deuda = centavos($("#ccDeuda").value);
    if (!nombre) return err("Poné el nombre del cliente");
    if (!(deuda >= 0)) return err("La deuda inicial no es válida");
    const activo = !editId || $("#ccEstado").value === "1";
    const actual = editId ? cuentas.find((x) => x.id === editId) : null;
    if (actual && actual.activo && !activo && actual.saldo > 0 && !confirm(`Esta cuenta debe ${fmt(actual.saldo)}.\nSi la archivás deja de aparecer en la caja.\n¿Archivarla igual?`)) return;

    $("#ccFGuardar").disabled = true;
    err("");
    try {
      const cuerpo = { nombre, deuda_inicial: deuda, nota: $("#ccNota").value.trim(), activo };
      if (editId) await put(`/cuentas/${editId}`, cuerpo);
      else await post("/cuentas", cuerpo);
      cerrar("#mCuentaForm");
      mostrarExito({
        titulo: editId ? "Cuenta actualizada" : "Cuenta abierta",
        sub: esc(nombre),
        monto: !editId && deuda ? fmt(deuda) : undefined,
        duracion: 1500,
      });
      await ccCargar();
      if (editDesdeDet) ccDetalle(editId, true); // venía del detalle: se reabre actualizado
    } catch (e) {
      err(e.message);
    } finally {
      $("#ccFGuardar").disabled = false;
    }
  }


  // ==========================================================
  // 5. DETALLE: PÁGINAS, DEUDAS E HISTORIAL
  // ==========================================================
  // Cambia entre "Deudas" y "Gráfico" (el botón de flecha del encabezado)
  function ccPagina(p) {
    pag = p;
    $("#ccPagDeudas").hidden = p !== "deudas";
    $("#ccPagGraf").hidden = p !== "grafico";
    const b = $("#ccDSwitch");
    b.classList.toggle("back", p === "grafico");
    b.innerHTML = p === "deudas" ? "Ver gráfico <span>→</span>" : "<span>←</span> Volver a deudas";
    if (p === "grafico") {
      ccLeyenda();
      ccGStats();
      requestAnimationFrame(() => dibujarLinea(true)); // recién visible puede medirse
    }
  }

  // Lista de deudas: pendientes primero (la más vieja arriba); las saldadas, si se piden
  function ccDeudasRender() {
    const pend = detDeudas.filter((d) => d.pendiente > 0);
    const salds = detDeudas.filter((d) => d.pendiente <= 0);
    const totalPend = pend.reduce((s, d) => s + d.pendiente, 0);

    $("#ccDDeuHead").innerHTML =
      `<div><b>Deudas</b><small>${pend.length ? `${plural(pend.length, "pendiente", "pendientes")} · faltan ${fmt(totalPend)}` : "No hay deudas pendientes"}</small></div>` +
      (salds.length ? `<button type="button" class="cc-lnk" id="ccVerSald">${verSaldadas ? "Ocultar saldadas" : `Ver saldadas (${salds.length})`}</button>` : "");

    const lista = verSaldadas ? [...pend, ...salds] : pend;
    $("#ccDDeudas").innerHTML = lista.length
      ? lista
          .map((d) => {
            const saldada = d.pendiente <= 0;
            const pct = d.monto ? Math.round((d.pagado / d.monto) * 100) : 0;
            return `<div class="cc-deu${saldada ? " ok" : ""}">
              <div class="inf"><b>${esc(nombreDeuda(d))}</b>
                <small>${fechaCorta(d.fecha)} · ${fmt(d.monto)}${d.pagado > 0 && !saldada ? ` · pagado ${fmt(d.pagado)}` : ""}</small>
                <div class="cc-bar"><i style="width:${pct}%"></i></div></div>
              <div class="mto">${saldada ? '<span class="cc-chip ok">Saldada</span>' : `<b>${fmt(d.pendiente)}</b><small>falta</small>`}</div>
              ${saldada ? "<span></span>" : `<button type="button" class="go cc-sal" data-saldar="${d.ref}">Saldar</button>`}
            </div>`;
          })
          .join("")
      : '<div class="cc-vacio">🎉 Esta cuenta no tiene deudas pendientes.</div>';
  }

  function ccMovsRender(movimientos, d) {
    const filas = movimientos.map((m) => {
      const venta = m.tipo === "venta";
      const dest = m.aplicado_a == null ? "" : m.aplicado_a === 0 ? "A deuda inicial" : `A ticket #${m.aplicado_a}`;
      const sub = venta ? (m.anulada ? "Ticket anulado: no suma deuda" : "Venta a cuenta") : [dest, m.nota].filter(Boolean).map(esc).join(" · ");
      return `<div class="cc-mov${m.anulada ? " anul" : ""}">
        <span class="f">${fechaCorta(m.fecha)}</span>
        <span class="c"><b>${venta ? `Ticket #${m.venta_id}` : `Pago · ${esc(nombreMetodo(m.metodo))}`}</b><small>${sub}</small></span>
        <span class="m ${venta ? "mas" : "menos"}">${venta ? "+" : "−"} ${fmt(m.monto)}</span>
        <span>${venta ? "" : `<button class="cc-del" data-delpago="${m.id}" title="Borrar este pago">✕</button>`}</span>
      </div>`;
    });
    if (d.deuda_inicial)
      filas.push(`<div class="cc-mov">
        <span class="f">${fechaCorta(d.created_at)}</span>
        <span class="c"><b>Deuda inicial</b><small>Lo que debía al abrir la cuenta</small></span>
        <span class="m mas">+ ${fmt(d.deuda_inicial)}</span><span></span></div>`);
    $("#ccDMovs").innerHTML = filas.length ? filas.join("") : '<div class="cc-vacio">Todavía no hay movimientos.</div>';
  }

  // conservarPagina = true cuando se vuelve de un pago o de editar: no se pierde la página en la que estaba
  async function ccDetalle(id, conservarPagina = false) {
    try {
      const d = await api(`/cuentas/${id}`);
      detId = id;
      detDeudas = d.deudas;
      detSerie = d.serie;
      if (!conservarPagina) {
        pag = "deudas";
        verSaldadas = false;
      }

      $("#ccDNom").textContent = d.nombre;
      $("#ccDNota").textContent = d.nota || (d.activo ? "" : "Cuenta archivada");
      $("#ccKIni").textContent = fmt(d.deuda_inicial);
      $("#ccKCom").textContent = fmt(d.compras);
      $("#ccKPag").textContent = fmt(d.pagos);
      $("#ccKSalBox").classList.toggle("ok", d.saldo <= 0);
      $("#ccKSalLbl").textContent = d.saldo > 0 ? "Debe" : d.saldo < 0 ? "A favor" : "Saldo";
      $("#ccKSal").textContent = fmt(Math.abs(d.saldo));
      $("#ccDPagar").disabled = !(d.saldo > 0);

      ccDeudasRender();
      ccMovsRender(d.movimientos, d);
      abrir("#mCuentaDet");
      ccPagina(pag);
    } catch (e) {
      toast("No se pudo abrir la cuenta: " + e.message);
    }
  }


  // ==========================================================
  // 6. GRÁFICO: CURVA DE DEUDA + MEDIA
  // ==========================================================
  // La línea une cada movimiento con el anterior: SUBE en rojo cuando el cliente compra a cuenta
  // y BAJA en verde cuando paga. Es una curva suave con degradé; además se marca la media de la deuda.
  const COLOR_SUBE = "var(--rose-t)";
  const COLOR_BAJA = "var(--mint-t)";

  function ccLeyenda() {
    $("#ccGLeg").innerHTML = `
      <span><i style="border-top:3px solid ${COLOR_SUBE}"></i>Sube: compras a cuenta</span>
      <span><i style="border-top:3px solid ${COLOR_BAJA}"></i>Baja: pagos</span>
      <span><i style="border-top:2px dashed var(--acc)"></i>Media</span>`;
  }

  // Puntos del gráfico + media + tendencia
  //  · media: saldo promedio ponderado por el tiempo que la cuenta estuvo en cada saldo
  //  · tendencia: recta de mínimos cuadrados sobre el saldo a lo largo del período (y = a + b·u, u de 0 a 1)
  function ccAnalisis() {
    if (!detSerie.length) return null;
    let prev = 0;
    const pts = detSerie.map((p) => {
      prev = Math.max(prev, new Date(p.fecha).getTime()); // una fecha nunca retrocede
      return { ...p, t: prev };
    });
    const t0 = pts[0].t;
    let t1 = Math.max(Date.now(), pts[pts.length - 1].t);
    if (t1 - t0 < 864e5) t1 = t0 + 864e5;

    let area = 0;
    pts.forEach((p, i) => {
      area += p.saldo * ((i + 1 < pts.length ? pts[i + 1].t : t1) - p.t);
    });
    const media = area / (t1 - t0);

    // El saldo vale lo del último movimiento anterior: se muestrea parejo en el tiempo
    const saldoEn = (t) => {
      let v = pts[0].saldo;
      for (const p of pts) {
        if (p.t > t) break;
        v = p.saldo;
      }
      return v;
    };
    let tendencia = null;
    if (pts.length >= 3) {
      const N = 60;
      let sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (let i = 0; i < N; i++) {
        const u = i / (N - 1);
        const v = saldoEn(t0 + u * (t1 - t0));
        sx += u; sy += v; sxx += u * u; sxy += u * v;
      }
      const b = (N * sxy - sx * sy) / (N * sxx - sx * sx); // cuánto cambia la deuda en todo el período
      tendencia = { a: (sy - b * sx) / N, b };
    }
    return { pts, t0, t1, media, tendencia };
  }

  // Resumen debajo del gráfico
  function ccGStats() {
    const an = ccAnalisis();
    const suma = (a) => a.reduce((s, p) => s + p.monto, 0);
    const base = suma(detSerie.filter((p) => p.tipo !== "pago")); // deuda inicial + compras
    const cumple = base ? Math.min(100, Math.round((suma(detSerie.filter((p) => p.tipo === "pago")) / base) * 100)) : null;
    const actual = detSerie.length ? detSerie[detSerie.length - 1].saldo : 0;

    let tend = "<b>—</b><em>faltan movimientos</em>";
    if (an && an.tendencia) {
      const { b } = an.tendencia;
      const porMes = Math.round((b * 30 * 864e5) / (an.t1 - an.t0));
      if (Math.abs(b) / Math.max(an.media, 1) < 0.05) tend = "<b>→ Estable</b>";
      else if (b > 0) tend = `<b style="color:${COLOR_SUBE}">↗ Sube</b><em>${fmt(porMes)} por mes</em>`;
      else tend = `<b style="color:${COLOR_BAJA}">↘ Baja</b><em>${fmt(-porMes)} por mes</em>`;
    }

    $("#ccGStats").innerHTML = `
      <div><small>Deuda actual</small><b>${actual < 0 ? "A favor " + fmt(-actual) : fmt(actual)}</b></div>
      <div><small>Media de la deuda</small><b>${an ? fmt(Math.round(an.media)) : "—"}</b></div>
      <div><small>Tendencia</small>${tend}</div>
      <div><small>Pagado del total</small><b>${cumple == null ? "—" : cumple + "%"}</b></div>`;
  }

  // Tope "redondo" para el eje Y y formato corto de plata
  function techoY(max) {
    if (max <= 0) return 1;
    const mag = 10 ** Math.floor(Math.log10(max));
    for (const f of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) if (f * mag >= max) return f * mag;
    return 10 * mag;
  }
  function cortoPesos(centavos) {
    if (centavos < 0) return "−" + cortoPesos(-centavos);
    const n = centavos / 100;
    const c = (v, s) => v.toFixed(v >= 10 ? 0 : 1).replace(".", ",").replace(/,0$/, "") + s;
    if (n >= 1e6) return "$" + c(n / 1e6, "M");
    if (n >= 1e3) return "$" + c(n / 1e3, "k");
    return "$" + Math.round(n);
  }

  // Curva suave que pasa por cada punto sin "pasarse": en un tramo que sube nunca baja, y viceversa
  // (interpolación monótona de Fritsch–Carlson). Devuelve los puntos de control de cada tramo.
  function curvaSuave(P) {
    const n = P.length;
    if (n < 2) return [];
    const dx = [], m = [];
    for (let i = 0; i < n - 1; i++) {
      dx[i] = P[i + 1].x - P[i].x;
      m[i] = dx[i] > 0 ? (P[i + 1].y - P[i].y) / dx[i] : 0; // pendiente entre puntos
    }
    const t = new Array(n);
    t[0] = m[0];
    t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
      const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
      if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
    }
    return dx.map((d, i) => ({
      c1x: P[i].x + d / 3, c1y: P[i].y + (t[i] * d) / 3,
      c2x: P[i + 1].x - d / 3, c2y: P[i + 1].y - (t[i + 1] * d) / 3,
    }));
  }

  function dibujarLinea(animar = true) {
    const el = $("#ccGraf");
    if (!el || $("#ccPagGraf").hidden) return;
    const W = el.clientWidth, H = el.clientHeight;
    if (W < 120 || H < 120) return;
    const an = ccAnalisis();
    if (!an) {
      el.innerHTML = '<div class="cc-vacio" style="padding-top:80px">Todavía no hay movimientos para graficar.</div>';
      return;
    }
    const { pts, t0, t1, media } = an;

    const tope = techoY(Math.max(0, ...pts.map((p) => p.saldo)));
    const minV = Math.min(0, ...pts.map((p) => p.saldo));
    const piso = minV < 0 ? -techoY(-minV) : 0; // solo baja de 0 si la cuenta quedó a favor

    const m = { l: 58, r: 22, t: 16, b: 32 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b, base = m.t + ih;
    const x = (t) => m.l + ((t - t0) / (t1 - t0)) * iw;
    const y = (v) => m.t + ih - ((v - piso) / (tope - piso)) * ih;
    const colorDe = (p) => (p.tipo === "venta" ? COLOR_SUBE : p.tipo === "pago" ? COLOR_BAJA : "var(--acc)");

    let svg = `<svg width="${W}" height="${H}"><defs><clipPath id="ccclip"><rect x="${m.l}" y="${m.t}" width="${iw}" height="${ih}"/></clipPath></defs>`;

    // Grilla y eje Y
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const v = piso + (tope - piso) * f;
      const yy = y(v);
      const cero = Math.abs(v) < 1;
      svg += `<line class="gl ${cero ? "base" : ""}" x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}"/>
        <text x="${m.l - 8}" y="${yy + 4}" text-anchor="end">${cero ? "$0" : cortoPesos(v)}</text>`;
    }

    // Eje X
    const largo = t1 - t0 > 365 * 864e5;
    for (let i = 0; i <= 5; i++) {
      const t = t0 + ((t1 - t0) * i) / 5;
      const txt = new Date(t).toLocaleDateString("es-AR", largo ? { month: "short", year: "2-digit" } : { day: "numeric", month: "short" });
      svg += `<text x="${x(t)}" y="${H - 9}" text-anchor="${i === 0 ? "start" : i === 5 ? "end" : "middle"}">${txt}</text>`;
    }

    // ----- La línea: curva suave, roja donde sube y verde donde baja, con degradé debajo -----
    const P = pts.map((p) => ({ x: x(p.t), y: y(p.saldo) }));
    const seg = curvaSuave(P);
    const ult = pts[pts.length - 1];
    const xFin = x(t1);
    const f = (n) => n.toFixed(1);
    const curva = (i) => `C${f(seg[i].c1x)},${f(seg[i].c1y)} ${f(seg[i].c2x)},${f(seg[i].c2y)} ${f(P[i + 1].x)},${f(P[i + 1].y)}`;
    const colorTramo = (i) => {
      const d = pts[i + 1].saldo - pts[i].saldo;
      return d > 0 ? COLOR_SUBE : d < 0 ? COLOR_BAJA : "var(--mut)";
    };

    // Relleno: un solo camino por debajo de toda la curva (llega hasta hoy)
    let area = `M${f(P[0].x)},${f(P[0].y)}`;
    for (let i = 0; i < seg.length; i++) area += ` ${curva(i)}`;
    area += ` L${f(xFin)},${f(P[P.length - 1].y)} L${f(xFin)},${base} L${f(P[0].x)},${base} Z`;

    // El color del relleno acompaña a la línea (con muchos movimientos se usa un solo color)
    let stops = `<stop offset="0" style="stop-color:var(--acc)"/><stop offset="1" style="stop-color:var(--acc)"/>`;
    if (seg.length && seg.length <= 150) {
      const ofs = (px) => Math.min(1, Math.max(0, (px - m.l) / (xFin - m.l)));
      stops = seg
        .map((_, i) => `<stop offset="${ofs(P[i].x)}" style="stop-color:${colorTramo(i)}"/><stop offset="${ofs(P[i + 1].x)}" style="stop-color:${colorTramo(i)}"/>`)
        .join("");
    }
    const yTop = Math.min(Math.min(...P.map((q) => q.y)), base - 10);
    svg += `<defs>
      <linearGradient id="ccgc" gradientUnits="userSpaceOnUse" x1="${m.l}" y1="0" x2="${xFin}" y2="0">${stops}</linearGradient>
      <linearGradient id="ccgf" gradientUnits="userSpaceOnUse" x1="0" y1="${yTop}" x2="0" y2="${base}">
        <stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <mask id="ccgm" maskUnits="userSpaceOnUse" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}"><rect x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="url(#ccgf)"/></mask>
    </defs>`;

    const cls = animar ? "ar" : "";
    svg += `<g clip-path="url(#ccclip)">`;
    svg += `<g class="${cls}"><path d="${area}" fill="url(#ccgc)" mask="url(#ccgm)"/></g>`;
    svg += `<line class="lm" x1="${m.l}" x2="${W - m.r}" y1="${y(media)}" y2="${y(media)}"/>`; // media
    svg += `<g class="${cls}">`;
    for (let i = 0; i < seg.length; i++) svg += `<path class="sg" d="M${f(P[i].x)},${f(P[i].y)} ${curva(i)}" style="stroke:${colorTramo(i)}"/>`;
    if (t1 > ult.t) svg += `<line class="sg eq tail" x1="${x(ult.t)}" y1="${y(ult.saldo)}" x2="${xFin}" y2="${y(ult.saldo)}"/>`; // de ahí a hoy sigue igual
    svg += `</g></g>`;

    // Puntos por movimiento y etiqueta de la media
    if (pts.length <= 80) {
      svg += pts.map((p) => `<circle class="dt" cx="${x(p.t)}" cy="${y(p.saldo)}" r="4" style="fill:${colorDe(p)}"/>`).join("");
    }
    svg += `<text class="tm" x="${W - m.r - 6}" y="${y(media) - 7}" text-anchor="end">Media ${cortoPesos(media)}</text>`;
    svg += `<line class="gd" y1="${m.t}" y2="${base}"/><circle class="gp" r="6"/>`;
    el.innerHTML = svg + `</svg><div class="cc-gtip"></div>`;

    // ----- Interacción: guía vertical + detalle del movimiento más cercano -----
    const tip = el.querySelector(".cc-gtip"), gd = el.querySelector(".gd"), gp = el.querySelector(".gp");

    el.onmousemove = (e) => {
      const px = Math.max(m.l, Math.min(W - m.r, e.clientX - el.getBoundingClientRect().left));
      let p = pts[0], mejor = Infinity;
      for (const q of pts) {
        const dist = Math.abs(x(q.t) - px);
        if (dist < mejor) { mejor = dist; p = q; }
      }
      const cx = x(p.t);

      const ev = p.tipo === "inicial" ? "Deuda inicial" : p.tipo === "venta" ? `Compra · Ticket #${p.venta_id}` : `Pago · ${esc(nombreMetodo(p.metodo))}`;
      tip.innerHTML =
        `<b>${fechaLarga(p.fecha)}</b>` +
        `<div class="ev"><span>${ev}</span><span>${p.tipo === "pago" ? "−" : "+"} ${fmt(p.monto)}</span></div>` +
        `<div><span>Deuda después</span><span>${fmt(p.saldo)}</span></div>` +
        `<div><span>Media</span><span>${fmt(Math.round(media))}</span></div>`;
      tip.style.opacity = 1;
      const tw = tip.offsetWidth;
      tip.style.left = Math.max(0, cx + 16 + tw > W ? cx - tw - 16 : cx + 16) + "px";

      gd.setAttribute("x1", cx); gd.setAttribute("x2", cx); gd.setAttribute("opacity", 1);
      gp.setAttribute("cx", cx); gp.setAttribute("cy", y(p.saldo));
      gp.style.fill = colorDe(p); gp.setAttribute("opacity", 1);
    };
    el.onmouseleave = () => {
      tip.style.opacity = 0;
      gd.setAttribute("opacity", 0);
      gp.setAttribute("opacity", 0);
    };
  }

  let resizeT;
  addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      if ($("#mCuentaDet").classList.contains("abierto") && pag === "grafico") dibujarLinea(false);
    }, 120);
  });


  // ==========================================================
  // 7. PAGOS
  // ==========================================================
  // Si es un pago general, cuenta qué deudas cubriría (las más viejas primero)
  function fifoTexto(monto) {
    let resto = monto, completas = 0, parcial = null;
    for (const d of detDeudas) {
      if (resto <= 0) break;
      if (d.pendiente <= 0) continue;
      if (resto >= d.pendiente) {
        resto -= d.pendiente;
        completas++;
      } else {
        parcial = d;
        resto = 0;
      }
    }
    const partes = [];
    if (completas) partes.push(`salda ${plural(completas, "deuda completa", "deudas completas")}`);
    if (parcial) partes.push(`abona parte del ${nombreDeuda(parcial)}`);
    return partes.length ? `Se descuenta de las más viejas: ${partes.join(" y ")}` : "";
  }

  function ccPagoPrev() {
    const el = $("#ccPPrev");
    el.className = "cc-prev";
    const monto = centavos($("#ccPMonto").value);
    if (!(monto > 0)) return (el.textContent = "");
    if (monto > pagoTope) {
      el.classList.add("debe");
      return (el.innerHTML = pagoDeuda
        ? `Se pasa de lo que falta: como máximo <b>${fmt(pagoTope)}</b>`
        : `Se pasa de la deuda: como máximo <b>${fmt(pagoTope)}</b>`);
    }
    const resto = pagoTope - monto;
    const extra = !pagoDeuda && pagoDesdeDet && fifoTexto(monto) ? "<br>" + fifoTexto(monto) : "";
    if (resto === 0) {
      el.classList.add("ok");
      return (el.innerHTML = (pagoDeuda ? "Esa deuda queda saldada" : "La cuenta queda al día") + extra);
    }
    el.classList.add("debe");
    el.innerHTML = pagoDeuda ? `A esa deuda le va a faltar <b>${fmt(resto)}</b>` : `Va a seguir debiendo <b>${fmt(resto)}</b>${extra}`;
  }

  // deuda = null → pago general · deuda = {…} → se salda esa deuda puntual
  function ccPagoAbrir(c, desdeDet, deuda = null) {
    if (!(c.saldo > 0)) return toast("Esta cuenta no tiene deuda");
    pagoCta = c;
    pagoDesdeDet = desdeDet;
    pagoDeuda = deuda;
    pagoTope = deuda ? deuda.pendiente : c.saldo;

    $("#ccPTit").textContent = deuda ? `Saldar ${nombreDeuda(deuda)}` : "Registrar pago";
    $("#ccPSub").innerHTML = `${esc(c.nombre)} · debe <b>${fmt(c.saldo)}</b>`;
    $("#ccPDest").innerHTML = deuda
      ? `Se aplica a <b>${esc(nombreDeuda(deuda))}</b> · falta <b>${fmt(deuda.pendiente)}</b> de ${fmt(deuda.monto)}`
      : "Pago general: se descuenta de las deudas más viejas primero. Para elegir una puntual, usá <b>Saldar</b> en la lista de deudas.";
    $("#ccPMonto").value = deuda ? deuda.pendiente / 100 : "";
    $("#ccPMetodo").value = "efectivo";
    $("#ccPNota").value = "";
    $("#ccPErr").textContent = "";
    ccPagoPrev();
    if (desdeDet) cerrar("#mCuentaDet"); // un solo pop-up a la vez
    abrir("#mCuentaPago");
    setTimeout(() => {
      $("#ccPMonto").focus();
      $("#ccPMonto").select();
    }, 50);
  }

  function ccPagoCerrar() {
    cerrar("#mCuentaPago");
    if (pagoDesdeDet && detId) ccDetalle(detId, true); // vuelve al detalle, en la misma página
  }

  async function ccPagoGuardar() {
    const err = (t) => ($("#ccPErr").textContent = t);
    const monto = centavos($("#ccPMonto").value);
    if (!(monto > 0)) return err("Poné cuánto pagó");
    if (monto > pagoTope)
      return err(pagoDeuda ? `No puede pagar más de lo que falta de esa deuda (${fmt(pagoTope)})` : `No puede pagar más de lo que debe (${fmt(pagoTope)})`);
    const metodo = $("#ccPMetodo").value;
    $("#ccPGuardar").disabled = true;
    err("");
    try {
      const r = await post(`/cuentas/${pagoCta.id}/pagos`, {
        monto,
        metodo,
        nota: $("#ccPNota").value.trim(),
        aplicado_a: pagoDeuda ? pagoDeuda.ref : null,
      });
      const desdeDet = pagoDesdeDet;
      const cta = pagoCta;
      cerrar("#mCuentaPago");
      await ccCargar();
      if (desdeDet) {
        toast(pagoDeuda ? `${nombreDeuda(pagoDeuda)}: pago registrado` : "Pago registrado");
        ccDetalle(cta.id, true);
      } else {
        mostrarExito({
          titulo: "Pago registrado",
          sub: `${esc(cta.nombre)} · ${esc(nombreMetodo(metodo))}`,
          monto: fmt(monto),
          fila: r.saldo > 0 ? { label: "Sigue debiendo", valor: fmt(r.saldo) } : { label: "Cuenta", valor: "Al día" },
          duracion: 1800,
        });
      }
    } catch (e) {
      err(e.message);
    } finally {
      $("#ccPGuardar").disabled = false;
    }
  }


  // ==========================================================
  // 8. EVENTOS
  // ==========================================================
  // ---------- Lista ----------
  $("#ccBuscar").addEventListener("input", (e) => ((cF.q = e.target.value), ccRender()));
  $("#ccVista").addEventListener("change", (e) => ((cF.vista = e.target.value), ccRender()));
  $("#ccNueva").addEventListener("click", () => ccForm());

  $("#ccBody").addEventListener("click", (e) => {
    if (e.target.closest("[data-nueva]")) return ccForm();
    const pill = e.target.closest("[data-pago]");
    if (pill) return ccPagoAbrir(cuentas.find((c) => c.id === Number(pill.dataset.pago)), false);
    const fila = e.target.closest(".pr-row[data-id]");
    if (fila) ccDetalle(Number(fila.dataset.id));
  });
  $("#ccBody").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.target.tagName === "BUTTON") return;
    const fila = e.target.closest(".pr-row[data-id]");
    if (fila) ccDetalle(Number(fila.dataset.id));
  });

  // ---------- Formulario ----------
  $("#ccFCancel").addEventListener("click", () => {
    cerrar("#mCuentaForm");
    if (editDesdeDet) ccDetalle(editId, true);
  });
  $("#ccFGuardar").addEventListener("click", ccGuardar);
  $("#mCuentaForm").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.tagName !== "BUTTON" && e.target.tagName !== "SELECT") {
      e.preventDefault();
      ccGuardar();
    }
  });

  // ---------- Detalle ----------
  $("#ccDSwitch").addEventListener("click", () => ccPagina(pag === "deudas" ? "grafico" : "deudas"));
  $("#ccDCerrar").addEventListener("click", () => {
    detId = null;
    cerrar("#mCuentaDet");
  });
  $("#ccDEditar").addEventListener("click", () => {
    const c = cuentas.find((x) => x.id === detId);
    if (!c) return;
    cerrar("#mCuentaDet");
    ccForm(c, true);
  });
  $("#ccDPagar").addEventListener("click", () => {
    const c = cuentas.find((x) => x.id === detId);
    if (c) ccPagoAbrir(c, true);
  });

  // Saldar una deuda puntual / ver u ocultar las saldadas
  $("#ccDDeudas").addEventListener("click", (e) => {
    const b = e.target.closest("[data-saldar]");
    if (!b) return;
    const d = detDeudas.find((x) => x.ref === Number(b.dataset.saldar));
    const c = cuentas.find((x) => x.id === detId);
    if (c && d) ccPagoAbrir(c, true, d);
  });
  $("#ccDDeuHead").addEventListener("click", (e) => {
    if (!e.target.closest("#ccVerSald")) return;
    verSaldadas = !verSaldadas;
    ccDeudasRender();
  });

  // Borrar un pago mal cargado
  $("#ccDMovs").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-delpago]");
    if (!b || !confirm("¿Borrar este pago? La deuda de la cuenta vuelve a subir.")) return;
    try {
      await api(`/cuentas/${detId}/pagos/${b.dataset.delpago}`, { method: "DELETE" });
      toast("Pago borrado");
      await ccCargar();
      ccDetalle(detId, true);
    } catch (err) {
      toast(err.message);
    }
  });

  // ---------- Pago ----------
  $("#ccPMonto").addEventListener("input", ccPagoPrev);
  $("#ccPTodo").addEventListener("click", () => {
    $("#ccPMonto").value = pagoTope / 100;
    ccPagoPrev();
  });
  $("#ccPCancel").addEventListener("click", ccPagoCerrar);
  $("#ccPGuardar").addEventListener("click", ccPagoGuardar);
  $("#mCuentaPago").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.tagName !== "BUTTON" && e.target.tagName !== "SELECT") {
      e.preventDefault();
      ccPagoGuardar();
    }
  });
})();