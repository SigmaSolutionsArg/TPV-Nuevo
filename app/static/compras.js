// ==========================================================
// TPV · compras.js  (Admin > Compras > Proveedores y Remitos)
// Se carga DESPUÉS de app.js y productos.js. Usa sus helpers:
//   $, api, post, fmt, esc, toast, abrir, cerrar, mostrarExito, nav, aplicarTema
// Monta sus propias vistas y modales, y agrega la tarjeta "Compras" al panel de admin.
// Reutiliza el estilo de tablas de productos.css (clases pr-*).
// ==========================================================
(() => {
  // ---------- Estado ----------
  let provs = []; // todos los proveedores (activos e inactivos)
  let rems = []; // remitos
  let pF = { q: "", vista: "activos" };
  let rF = { q: "", prov: "", pago: "" }; // pago: "" (todos) | "deuda" | "pagados"
  let editId = null; // proveedor en edición (null = creando)
  let fotosForm = []; // foto del remito que se está cargando (data URL). Máximo una.
  let remEditId = null; // remito en edición (null = creando uno nuevo)
  let fotoExistente = null; // URL de la foto ya guardada del remito que se edita
  let fotoQuitada = false; // en edición: se quitó la foto guardada
  let pagoId = null; // remito abierto en el mini pop-up de pago
  let pagoModo = "sumar"; // "sumar" un pago | "total" corregir el total pagado
  const hayFoto = () => fotosForm.length > 0 || (!!fotoExistente && !fotoQuitada);
  window.__remitoFotos = () => fotosForm;
  window.__remitoHayFoto = hayFoto;
  window.__remitoEditando = () => remEditId !== null;
  // Foto para la IA: la nueva si hay; si no, la ya guardada (se descarga y se pasa a base64)
  window.__remitoFotoIA = async () => {
    if (fotosForm.length) return fotosForm[0];
    if (fotoExistente && !fotoQuitada) return comprimir(await (await fetch(fotoExistente)).blob());
    return null;
  };

  // ---------- Utilidades ----------
  const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const put = (url, body) =>
    api(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const patch = (url, body) =>
    api(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const fechaFmt = (iso) => (iso ? iso.split("-").reverse().join("/") : "—");
  const hoyISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const ico = (d) =>
    `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICO_EDITAR = ico('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>');
  const ICO_BORRAR = ico('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>');
  const ICO_REACTIVAR = ico('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>');
  const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

  // Reduce la foto (máx. 1600 px) y la pasa a JPG: una foto de celular de 5 MB queda en ~300 KB
  function comprimir(file, max = 2200, calidad = 0.85) {
    return new Promise((ok, mal) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        ok(c.toDataURL("image/jpeg", calidad));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        mal(new Error(`No se pudo leer "${file.name || "la foto"}" (usá una foto JPG o PNG)`));
      };
      img.src = url;
    });
  }

  // ==========================================================
  // MONTAJE
  // ==========================================================
  document.head.insertAdjacentHTML(
    "beforeend",
    `<style>
    #view-admin-proveedores main, #view-admin-remitos main { overflow: visible; gap: 16px }
    #view-admin-proveedores .pr-search input, #view-admin-remitos .pr-search input {
      height: 46px; padding: 0 16px 0 46px; font-size: 15px; border-radius: 14px;
      background: var(--card); border: 2px solid transparent; box-shadow: var(--shadow) }
    #view-admin-proveedores .pr-search input:focus, #view-admin-remitos .pr-search input:focus { border-color: var(--acc) }
    #view-admin-proveedores .pr-search .ic, #view-admin-remitos .pr-search .ic { left: 18px; font-size: 15px }

    .cp-ph { display: flex; align-items: center; gap: 8px; padding: 4px 12px 4px 4px; border-radius: 12px; background: transparent }
    .cp-ph:hover { background: var(--acc-soft) }
    .cp-ph img { width: 36px; height: 36px; object-fit: cover; border-radius: 9px; background: var(--bg) }
    .cp-ph b { font-size: 14px; color: var(--acc-txt) }

    #mRemito .box, #mProveedor .box { max-height: 94vh; overflow-y: auto }
    .cp-top { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 28px; align-items: start }
    .cp-drop { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; width: 100%; height: 230px; padding: 12px; border: 2px dashed var(--line); background: transparent; color: var(--mut); border-radius: 18px; font-size: 14px; font-weight: 600; text-align: center }
    .cp-drop:hover { border-color: var(--acc); color: var(--acc-txt); background: var(--acc-soft) }
    .cp-drop .big { font-size: 34px; line-height: 1 }
    .cp-drop small { font-weight: 400; font-size: 12.5px }
    .cp-prev { position: relative; height: 230px; border-radius: 18px; overflow: hidden; background: var(--bg); border: 1px solid var(--line) }
    .cp-prev img { width: 100%; height: 100%; object-fit: contain; display: block }
    .cp-prev-acc { position: absolute; left: 10px; right: 10px; bottom: 10px; display: flex; gap: 8px }
    .cp-prev-acc button { flex: 1; padding: 8px 10px; font-size: 13px; border-radius: 12px; background: rgba(0, 0, 0, .62); color: #fff }
    .cp-ia { width: 100%; height: 56px; margin-top: 12px; font-size: 16px; border-radius: 16px }
    .cp-ia:disabled { opacity: .45; cursor: not-allowed }
    .cp-hint { margin: 8px 0 0; color: var(--mut); font-size: 12.5px }
    .cp-lnk { margin-left: 8px; padding: 0; background: none; box-shadow: none; color: var(--acc-txt); font-size: 12.5px; font-weight: 600; text-decoration: underline }
    .cp-deuda { margin-top: 8px; min-height: 20px; font-size: 13px; color: var(--mut) }
    .cp-deuda.debe { color: var(--rose-t) }
    .cp-deuda.ok { color: var(--mint-t) }
    #cpRBody .pr-row { cursor: pointer }
    #cpRBody .pr-row:hover { background: var(--acc-soft) }
    .cp-chip { border: 0; font-family: inherit }
    button.cp-chip:hover { filter: brightness(.95); box-shadow: 0 0 0 2px currentColor }
    .cp-foto-nota { margin: 8px 0 0; color: var(--peach-t); font-size: 12.5px }
    #mPagoRemito .box { width: 440px }
    .cp-pg-res { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 14px 0 4px }
    .cp-pg-res div { padding: 10px 12px; border-radius: 14px; background: var(--bg) }
    .cp-pg-res small { display: block; color: var(--mut); font-size: 12px; margin-bottom: 2px }
    .cp-pg-res b { font-size: 15px }
    .cp-pg-res .deb b { color: var(--rose-t) }
    .cp-seg { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 16px; padding: 4px; border-radius: 14px; background: var(--bg) }
    .cp-seg button { padding: 8px 6px; font-size: 13px; background: transparent; border-radius: 11px; color: var(--mut); font-weight: 600 }
    .cp-seg button.on { background: var(--card); color: var(--acc-txt); box-shadow: var(--shadow) }
    .cp-sep { height: 1px; margin: 24px 0 0; background: var(--line) }
    .cp-chip { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 12.5px; font-weight: 700; white-space: nowrap }
    .cp-chip.debe { background: var(--rose); color: var(--rose-t) }
    .cp-chip.ok { background: var(--mint); color: var(--mint-t) }
    @media (max-width: 860px) { .cp-top { grid-template-columns: 1fr } }

    #mFotosRemito .box { width: 760px; max-height: 94vh; overflow-y: auto }
    #cpFLista a { display: block; margin-bottom: 12px }
    #cpFLista img { display: block; width: 100%; border-radius: 16px; background: var(--bg) }
    </style>`
  );

  const cabecera = (titulo, sub, subId, volver) => `
    <header class="top">
      <button onclick="nav('${volver}')" style="padding:10px 14px">⬅ Volver</button>
      <div class="brand"><b>${titulo}</b><small ${subId ? `id="${subId}"` : ""}>${sub}</small></div>
      <div class="sp"></div>
      <div class="pill reloj">--:--</div>
      <button class="theme" title="Cambiar tema"
        onclick="aplicarTema(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark')">🌙</button>
    </header>`;

  document.body.insertAdjacentHTML(
    "beforeend",
    `
  <!-- SUBMENÚ COMPRAS -->
  <div id="view-admin-compras" class="view app" style="display:none;">
    ${cabecera("Compras", "Proveedores y remitos", "", "admin")}
    <main style="align-items:center; justify-content:center;">
      <div class="admin-grid">
        <button class="act admin-card" onclick="cpIr('proveedores')">
          <div class="e" style="background:var(--peach);color:var(--peach-t)">🚚</div>
          <span><b>Proveedores</b><small>Datos de contacto y CUIT</small></span>
        </button>
        <button class="act admin-card" onclick="cpIr('remitos')">
          <div class="e" style="background:var(--mint);color:var(--mint-t)">🧾</div>
          <span><b>Remitos</b><small>Compras con fotos</small></span>
        </button>
      </div>
    </main>
  </div>

  <!-- PROVEEDORES -->
  <div id="view-admin-proveedores" class="view app" style="display:none;">
    ${cabecera("Proveedores", "Lista de proveedores", "cpProvSub", "admin-compras")}
    <main>
      <div class="pr-bar">
        <div class="searchwrap pr-search">
          <span class="ic">🔍</span>
          <input id="cpBuscar" placeholder="Buscar por nombre, CUIT o contacto…" autocomplete="off">
        </div>
        <select class="pr-sel" id="cpVista" aria-label="Mostrar"></select>
        <button class="go pr-nuevo" id="cpNuevo">＋ Nuevo proveedor</button>
      </div>
      <div class="card pr-card" style="--cols: minmax(0,1fr) 150px 170px 150px 90px 76px">
        <div class="pr-scroll">
          <div class="pr-head">
            <span>Proveedor</span><span>CUIT</span><span>Contacto</span><span>Teléfono</span><span class="r">Remitos</span><span></span>
          </div>
          <div id="cpBody"></div>
        </div>
        <div class="pr-foot" id="cpFoot"></div>
      </div>
    </main>
  </div>

  <!-- REMITOS -->
  <div id="view-admin-remitos" class="view app" style="display:none;">
    ${cabecera("Remitos", "Compras a proveedores", "cpRemSub", "admin-compras")}
    <main>
      <div class="pr-bar">
        <div class="searchwrap pr-search">
          <span class="ic">🔍</span>
          <input id="cpRBuscar" placeholder="Buscar por proveedor, número o nota…" autocomplete="off">
        </div>
        <select class="pr-sel" id="cpRFiltroProv" aria-label="Proveedor" style="width:240px"></select>
        <select class="pr-sel" id="cpRFiltroPago" aria-label="Deuda" style="width:190px"></select>
        <button class="go pr-nuevo" id="cpRNuevo">＋ Nuevo remito</button>
      </div>
      <div class="card pr-card" style="--cols: 110px 150px minmax(0,1fr) 110px 130px 150px 100px">
        <div class="pr-scroll">
          <div class="pr-head">
            <span>Fecha</span><span>N° remito</span><span>Proveedor</span><span class="r">Productos</span><span class="r">Monto</span><span>Estado</span><span>Foto</span>
          </div>
          <div id="cpRBody"></div>
        </div>
        <div class="pr-foot" id="cpRFoot"></div>
      </div>
    </main>
  </div>

  <!-- MODAL: PROVEEDOR -->
  <div class="modal" id="mProveedor">
    <div class="box" style="width:520px">
      <h2 id="cpPTitulo">Nuevo proveedor</h2>
      <p id="cpPSub">Se agrega a tu lista de proveedores.</p>
      <label>Nombre o razón social</label>
      <input id="cpNombre" placeholder="Ej: Distribuidora Norte S.R.L." autocomplete="off">
      <div class="row2">
        <div><label>CUIT</label><input id="cpCuit" placeholder="30-12345678-9" autocomplete="off"></div>
        <div><label>Contacto</label><input id="cpContacto" placeholder="Persona de contacto" autocomplete="off"></div>
      </div>
      <div class="row2">
        <div><label>Teléfono</label><input id="cpTel" placeholder="221 555-0000" autocomplete="off"></div>
        <div><label>Email</label><input id="cpEmail" type="email" placeholder="ventas@proveedor.com" autocomplete="off"></div>
      </div>
      <label>Dirección</label>
      <input id="cpDir" placeholder="Calle, número, ciudad" autocomplete="off">
      <label>Notas</label>
      <input id="cpNotas" placeholder="Días de reparto, condiciones de pago…" autocomplete="off">
      <div class="err" id="cpPErr"></div>
      <div class="acc">
        <button id="cpPCerrar">Cancelar</button>
        <button class="go" id="cpPGuardar">Guardar</button>
      </div>
    </div>
  </div>

  <!-- MODAL: NUEVO REMITO -->
  <div class="modal" id="mRemito">
    <div class="box" style="width:1080px;max-width:96vw">
      <h2 id="cpRTitulo">Nuevo remito</h2>
      <p id="cpRSub">Adjuntá la foto y la IA completa los datos, o cargalos a mano.</p>
      <div class="cp-top">
        <div>
          <label>Proveedor</label>
          <select class="pr-sel" id="cpRProv" style="width:100%"></select>
          <div class="row2">
            <div><label>N° de remito</label><input id="cpRNum" placeholder="0001-00012345" autocomplete="off"></div>
            <div><label>Fecha del remito</label><input id="cpRFecha" type="date"></div>
          </div>
          <div class="row2">
            <div><label>Monto total del remito ($)</label><input id="cpRMonto" type="number" min="0" step="any" placeholder="0"></div>
            <div><label>Pagado ($)<button type="button" class="cp-lnk" id="cpRPagoTodo">pagué todo</button></label><input id="cpRPagado" type="number" min="0" step="any" placeholder="0" autocomplete="off"></div>
          </div>
          <div class="cp-deuda" id="cpRDeuda"></div>
          <label>Nota · opcional</label>
          <input id="cpRNota" placeholder="Ej: faltó 1 caja" autocomplete="off">
        </div>
        <div>
          <label>Foto del remito</label>
          <div id="cpFoto"></div>
          <input type="file" id="cpFile" accept="image/*" hidden>
          <p class="cp-foto-nota" id="cpFotoNota" hidden></p>
          <button type="button" class="go cp-ia" id="riaLeer" disabled>✨ Analizar con IA</button>
          <p class="cp-hint">Completa proveedor, número, fecha, monto y las líneas. Revisá todo antes de guardar.</p>
        </div>
      </div>
      <div class="cp-sep"></div>
      <label>Líneas del remito</label>
      <div id="cpIA"></div>
      <div class="err" id="cpRErr"></div>
      <div class="acc">
        <button id="cpRCerrar">Cancelar</button>
        <button class="go" id="cpRGuardar">Guardar remito</button>
      </div>
    </div>
  </div>

  <!-- MODAL: PAGO RÁPIDO DE UN REMITO -->
  <div class="modal" id="mPagoRemito">
    <div class="box">
      <h2 id="cpPgTitulo">Pago del remito</h2>
      <p id="cpPgSub"></p>
      <div class="cp-pg-res">
        <div><small>Monto</small><b id="cpPgMonto"></b></div>
        <div><small>Pagado</small><b id="cpPgPagado"></b></div>
        <div class="deb"><small>Debe</small><b id="cpPgDebe"></b></div>
      </div>
      <div class="cp-seg">
        <button type="button" class="on" data-modo="sumar">Sumar un pago</button>
        <button type="button" data-modo="total">Corregir total pagado</button>
      </div>
      <label><span id="cpPgLabel">Monto del pago ($)</span><button type="button" class="cp-lnk" id="cpPgTodo">saldar todo</button></label>
      <input id="cpPgInput" type="number" min="0" step="any" placeholder="0" autocomplete="off">
      <div class="cp-deuda" id="cpPgPrev"></div>
      <div class="err" id="cpPgErr"></div>
      <div class="acc">
        <button id="cpPgCancel">Cancelar</button>
        <button class="go" id="cpPgOk">Guardar pago</button>
      </div>
    </div>
  </div>

  <!-- MODAL: VER FOTOS DE UN REMITO -->
  <div class="modal" id="mFotosRemito">
    <div class="box">
      <h2 id="cpFTitulo">Remito</h2>
      <p id="cpFSub"></p>
      <div id="cpFLista"></div>
      <div class="acc"><button id="cpFCerrar">Cerrar</button></div>
    </div>
  </div>`
  );
  aplicarTema(document.documentElement.dataset.theme || "light"); // pinta el ícono del tema en los botones nuevos

  // Tarjeta "Compras" en el panel de administración
  document.querySelector("#view-admin .admin-grid").insertAdjacentHTML(
    "beforeend",
    `<button class="act admin-card" onclick="abrirSeccionAdmin('compras')">
      <div class="e" style="background:var(--rose);color:var(--rose-t)">🛒</div>
      <span><b>Compras</b><small>Proveedores y remitos</small></span>
    </button>`
  );

  // ==========================================================
  // PROVEEDORES
  // ==========================================================
  function provFiltrados() {
    const q = norm(pF.q.trim());
    return provs.filter((p) => {
      if (pF.vista === "activos" && !p.activo) return false;
      if (pF.vista === "inactivos" && p.activo) return false;
      return !q || [p.nombre, p.cuit, p.contacto].some((x) => norm(x).includes(q));
    });
  }

  function provFila(p) {
    return `<div class="pr-row ${p.activo ? "" : "off"}">
      <span class="pr-nom">${esc(p.nombre)}${p.activo ? "" : '<em class="pr-tag">Inactivo</em>'}</span>
      <span class="pr-cod">${esc(p.cuit || "—")}</span>
      <span class="pr-cat-t">${esc(p.contacto || "—")}</span>
      <span class="pr-cat-t">${esc(p.telefono || "—")}</span>
      <span class="pr-precio r">${p.cantidad_remitos}</span>
      <span class="pr-acc">
        <button class="pr-ic" data-a="editar" data-id="${p.id}" title="Editar">${ICO_EDITAR}</button>
        ${p.activo
          ? `<button class="pr-ic del" data-a="desactivar" data-id="${p.id}" title="Desactivar">${ICO_BORRAR}</button>`
          : `<button class="pr-ic res" data-a="reactivar" data-id="${p.id}" title="Reactivar">${ICO_REACTIVAR}</button>`}
      </span>
    </div>`;
  }

  function provRender() {
    const cuenta = (v) => provs.filter((p) => v === "todos" || (v === "activos") === p.activo).length;
    $("#cpVista").innerHTML = [["activos", "Activos"], ["inactivos", "Inactivos"], ["todos", "Todos"]]
      .map(([v, t]) => `<option value="${v}">${t} (${cuenta(v)})</option>`)
      .join("");
    $("#cpVista").value = pF.vista;
    $("#cpProvSub").textContent = plural(cuenta("activos"), "proveedor activo", "proveedores activos");

    const lista = provFiltrados();
    $("#cpBody").innerHTML = lista.length
      ? lista.map(provFila).join("")
      : `<div class="pr-vacio">
          <b>${provs.length ? "🔎" : "🚚"}</b>
          <span>${provs.length ? "No hay proveedores con esos filtros." : "Todavía no cargaste proveedores."}</span>
          ${provs.length ? "" : '<button class="go" data-a="nuevo">＋ Crear el primero</button>'}
        </div>`;
    $("#cpFoot").innerHTML = `<span>${plural(lista.length, "proveedor", "proveedores")}</span>`;
  }

  async function provCargar() {
    try {
      provs = await api("/compras/proveedores?incluir_inactivos=true");
      provRender();
    } catch (e) {
      toast("No se pudieron cargar los proveedores: " + e.message);
    }
  }

  function provIniciar() {
    pF = { q: "", vista: "activos" };
    $("#cpBuscar").value = "";
    provCargar();
    setTimeout(() => $("#cpBuscar").focus(), 50);
  }

  function provForm(p = null) {
    editId = p ? p.id : null;
    $("#cpPTitulo").textContent = p ? "Editar proveedor" : "Nuevo proveedor";
    $("#cpPSub").textContent = p ? "Los cambios se aplican al instante." : "Se agrega a tu lista de proveedores.";
    $("#cpNombre").value = p ? p.nombre : "";
    $("#cpCuit").value = p ? p.cuit : "";
    $("#cpContacto").value = p ? p.contacto : "";
    $("#cpTel").value = p ? p.telefono : "";
    $("#cpEmail").value = p ? p.email : "";
    $("#cpDir").value = p ? p.direccion : "";
    $("#cpNotas").value = p ? p.notas : "";
    $("#cpPErr").textContent = "";
    abrir("#mProveedor");
    $("#cpNombre").focus();
  }

  async function provGuardar() {
    const body = {
      nombre: $("#cpNombre").value.trim(),
      cuit: $("#cpCuit").value.trim(),
      contacto: $("#cpContacto").value.trim(),
      telefono: $("#cpTel").value.trim(),
      email: $("#cpEmail").value.trim(),
      direccion: $("#cpDir").value.trim(),
      notas: $("#cpNotas").value.trim(),
    };
    if (!body.nombre) return ($("#cpPErr").textContent = "Poné un nombre");

    $("#cpPGuardar").disabled = true;
    try {
      const editando = editId !== null;
      if (editando) await put(`/compras/proveedores/${editId}`, body);
      else await post("/compras/proveedores", body);
      cerrar("#mProveedor");
      mostrarExito({
        titulo: editando ? "Cambios guardados" : "Proveedor creado",
        sub: esc(body.nombre),
        duracion: 1400,
        confetti: !editando,
      });
      await provCargar();
    } catch (e) {
      $("#cpPErr").textContent = e.message;
    } finally {
      $("#cpPGuardar").disabled = false;
    }
  }

  async function provCambiarActivo(id, activar) {
    const p = provs.find((x) => x.id === id);
    if (!p) return;
    try {
      if (activar) {
        await put(`/compras/proveedores/${id}`, { activo: true });
      } else {
        if (!confirm(`¿Desactivar a "${p.nombre}"?\n\nNo se borra: se conservan sus remitos, pero ya no se puede elegir para remitos nuevos.`)) return;
        await api(`/compras/proveedores/${id}`, { method: "DELETE" });
      }
      mostrarExito({
        tipo: activar ? "ok" : "anulado",
        titulo: activar ? "Proveedor reactivado" : "Proveedor desactivado",
        sub: esc(p.nombre),
        duracion: 1400,
        confetti: false,
      });
      await provCargar();
    } catch (e) {
      toast(e.message);
    }
  }

  // ==========================================================
  // REMITOS
  // ==========================================================
  function remFiltrados() {
    const q = norm(rF.q.trim());
    return rems.filter((r) => {
      if (rF.prov && String(r.proveedor_id) !== rF.prov) return false;
      if (rF.pago === "deuda" && !(r.deuda > 0)) return false;
      if (rF.pago === "pagados" && r.deuda > 0) return false;
      return !q || [r.proveedor, r.numero, r.nota].some((x) => norm(x).includes(q));
    });
  }

  const fotosCelda = (r) =>
    r.fotos.length
      ? `<button class="cp-ph" data-id="${r.id}" title="Ver fotos"><img src="${esc(r.fotos[0])}" alt=""><b>${r.fotos.length}</b></button>`
      : '<span class="pr-cat-t">Sin fotos</span>';

  // La pill es un botón: abre el mini pop-up de pago (sin abrir el remito entero)
  const estadoCelda = (r) =>
    r.deuda > 0
      ? `<button type="button" class="cp-chip debe" data-pago="${r.id}" title="Pagaste ${fmt(r.pagado)} de ${fmt(r.monto)} · Click para gestionar el pago">Debe ${fmt(r.deuda)}</button>`
      : r.monto
        ? `<button type="button" class="cp-chip ok" data-pago="${r.id}" title="Click para gestionar el pago">Pagado</button>`
        : '<span class="pr-cat-t">—</span>';

  function remRender() {
    $("#cpRFiltroProv").innerHTML =
      `<option value="">Todos los proveedores</option>` +
      provs.map((p) => `<option value="${p.id}">${esc(p.nombre)}${p.activo ? "" : " (inactivo)"}</option>`).join("");
    $("#cpRFiltroProv").value = rF.prov;

    const conDeuda = rems.filter((r) => r.deuda > 0).length;
    $("#cpRFiltroPago").innerHTML = [
      ["", `Todos (${rems.length})`],
      ["deuda", `Con deuda (${conDeuda})`],
      ["pagados", `Pagados (${rems.length - conDeuda})`],
    ]
      .map(([v, t]) => `<option value="${v}">${t}</option>`)
      .join("");
    $("#cpRFiltroPago").value = rF.pago;

    const lista = remFiltrados();
    $("#cpRBody").innerHTML = lista.length
      ? lista
          .map(
            (r) => `<div class="pr-row" data-id="${r.id}" tabindex="0" title="Abrir para ver o editar el remito">
        <span class="pr-cat-t">${fechaFmt(r.fecha)}</span>
        <span class="pr-cod">${esc(r.numero || "—")}</span>
        <span class="pr-nom">${esc(r.proveedor)}</span>
        <span class="pr-precio r" title="${plural(r.unidades || 0, "unidad", "unidades")}">${r.cantidad_items || "—"}</span>
        <span class="pr-precio r">${r.monto ? fmt(r.monto) : "—"}</span>
        <span>${estadoCelda(r)}</span>
        <span>${fotosCelda(r)}</span>
      </div>`
          )
          .join("")
      : `<div class="pr-vacio">
          <b>${rems.length ? "🔎" : "🧾"}</b>
          <span>${rems.length ? "No hay remitos con esos filtros." : "Todavía no cargaste remitos."}</span>
          ${rems.length ? "" : '<button class="go" data-a="nuevo">＋ Cargar el primero</button>'}
        </div>`;

    const total = lista.reduce((s, r) => s + r.monto, 0);
    const deuda = lista.reduce((s, r) => s + (r.deuda || 0), 0);
    $("#cpRFoot").innerHTML =
      `<span>${plural(lista.length, "remito", "remitos")}</span>` +
      (total
        ? `<span>Total con monto cargado: <b>${fmt(total)}</b>${deuda ? ` · Deuda: <b style="color:var(--rose-t)">${fmt(deuda)}</b>` : ""}</span>`
        : "");
    $("#cpRemSub").textContent =
      plural(rems.length, "remito cargado", "remitos cargados") + (conDeuda ? ` · ${conDeuda} con deuda` : "");
  }

  async function remCargar() {
    try {
      rems = await api("/compras/remitos?limit=500");
      provs = await api("/compras/proveedores?incluir_inactivos=true");
      remRender();
    } catch (e) {
      toast("No se pudieron cargar los remitos: " + e.message);
    }
  }

  function remIniciar() {
    rF = { q: "", prov: "", pago: "" };
    $("#cpRBuscar").value = "";
    remCargar();
    setTimeout(() => $("#cpRBuscar").focus(), 50);
  }

  function fotoRender() {
    const nueva = fotosForm[0];
    const guardada = !nueva && fotoExistente && !fotoQuitada ? fotoExistente : null;
    const img = nueva || guardada;
    $("#cpFoto").innerHTML = img
      ? `<div class="cp-prev">${guardada ? `<a href="${esc(guardada)}" target="_blank" rel="noopener" title="Abrir en tamaño real">` : ""}<img src="${esc(img)}" alt="Foto del remito">${guardada ? "</a>" : ""}
          <div class="cp-prev-acc"><button type="button" data-add>Cambiar foto</button><button type="button" data-q>Quitar</button></div></div>`
      : '<button type="button" class="cp-drop" data-add><span class="big">📷</span>Adjuntar foto del remito<small>Tocá para elegirla o arrastrala acá</small></button>';
    $("#riaLeer").disabled = !hayFoto(); // sin foto no hay nada que analizar
  }

  async function agregarFotos(files) {
    if (!files.length) return;
    if (files.length > 1) toast("Solo se puede adjuntar una foto por remito: tomé la primera");
    try {
      fotosForm = [await comprimir(files[0])];
      fotoQuitada = false;
    } catch (e) {
      toast(e.message);
    }
    fotoRender();
  }

  // Línea "queda a deber" debajo de Monto / Pagado
  const centavos = (txt) => Math.round(Number(txt || 0) * 100);
  function deudaRender() {
    const el = $("#cpRDeuda");
    const monto = centavos($("#cpRMonto").value);
    const pagado = centavos($("#cpRPagado").value);
    el.className = "cp-deuda";
    if (!(monto > 0)) return (el.textContent = "");
    if (pagado > monto) {
      el.classList.add("debe");
      return (el.textContent = "Lo pagado supera el monto del remito");
    }
    if (pagado < monto) {
      el.classList.add("debe");
      return (el.innerHTML = `Queda a deber <b>${fmt(monto - pagado)}</b>`);
    }
    el.classList.add("ok");
    el.textContent = "Remito pagado completo";
  }

  async function remAbrirEditar(id) {
    try {
      remForm(await api(`/compras/remitos/${id}`));
    } catch (e) {
      toast("No se pudo abrir el remito: " + e.message);
    }
  }

  // r = null → remito nuevo · r = remito completo (con items) → edición
  function remForm(r = null) {
    const activos = provs.filter((p) => p.activo);
    if (!r && !activos.length) return toast("Primero creá un proveedor (Compras > Proveedores)");
    // al editar, el proveedor del remito tiene que aparecer aunque esté inactivo
    const actual = r ? provs.find((p) => p.id === r.proveedor_id) : null;
    const lista = actual && !actual.activo ? [...activos, actual] : activos;
    $("#cpRProv").innerHTML = lista
      .map((p) => `<option value="${p.id}">${esc(p.nombre)}${p.activo ? "" : " (inactivo)"}</option>`)
      .join("");
    if (r) $("#cpRProv").value = String(r.proveedor_id);
    else if (rF.prov && activos.some((p) => String(p.id) === rF.prov)) $("#cpRProv").value = rF.prov;

    remEditId = r ? r.id : null;
    $("#cpRTitulo").textContent = r ? "Editar remito" : "Nuevo remito";
    $("#cpRSub").textContent = r
      ? "Corregí lo que haga falta, incluidos los pagos. Los cambios se aplican al guardar."
      : "Adjuntá la foto y la IA completa los datos, o cargalos a mano.";
    $("#cpRGuardar").textContent = r ? "Guardar cambios" : "Guardar remito";

    $("#cpRNum").value = r ? r.numero : "";
    $("#cpRFecha").value = r ? r.fecha : hoyISO();
    $("#cpRMonto").value = r && r.monto ? r.monto / 100 : "";
    $("#cpRPagado").value = r && r.pagado ? r.pagado / 100 : "";
    $("#cpRNota").value = r ? r.nota : "";
    $("#cpRErr").textContent = "";

    fotosForm = [];
    fotoExistente = r && r.fotos.length ? r.fotos[0] : null;
    fotoQuitada = false;
    const nota = $("#cpFotoNota");
    nota.hidden = !(r && r.fotos.length > 1);
    nota.textContent = nota.hidden ? "" : `Este remito tiene ${r.fotos.length} fotos guardadas. Si cambiás o quitás la foto, se reemplazan todas.`;
    fotoRender();
    deudaRender();

    window.RemitoIA?.reset();
    if (r) window.RemitoIA?.cargar(r.items);
    abrir("#mRemito");
    setTimeout(() => $(r ? "#cpRPagado" : "#cpRNum").focus(), 50);
  }

  async function remGuardar() {
    const err = (t) => ($("#cpRErr").textContent = t);
    const proveedor_id = Number($("#cpRProv").value);
    const fecha = $("#cpRFecha").value;
    const montoTxt = $("#cpRMonto").value;
    if (!proveedor_id) return err("Elegí un proveedor");
    if (!fecha) return err("Poné la fecha del remito");
    const vIA = window.RemitoIA?.validar();
    if (vIA) return err(vIA);
    if (!(Number(montoTxt) > 0)) return err("Poné el monto total del remito");
    const monto = centavos(montoTxt);
    const pagado = centavos($("#cpRPagado").value);
    if (!(pagado >= 0)) return err("El monto pagado no es válido");
    if (pagado > monto) return err("Lo pagado no puede ser mayor al monto del remito");
    if (!hayFoto() && !confirm("No cargaste ninguna foto.\n¿Guardar el remito sin foto?")) return;

    const numero = $("#cpRNum").value.trim();
    $("#cpRGuardar").disabled = true;
    err("");
    try {
      if (window.RemitoIA && !(await window.RemitoIA.pedirNuevos())) return; // pop-ups de precio y categoría
      const cuerpo = {
        proveedor_id,
        numero,
        fecha,
        monto,
        pagado,
        nota: $("#cpRNota").value.trim(),
        ...(window.RemitoIA ? window.RemitoIA.payload() : {}),
      };
      const editando = remEditId !== null;
      if (editando) {
        // foto: no se manda = queda como está · "" = quitar · imagen = reemplazar
        if (fotosForm.length) cuerpo.foto = fotosForm[0];
        else if (fotoQuitada) cuerpo.foto = "";
        await put(`/compras/remitos/${remEditId}`, cuerpo);
      } else {
        await post("/compras/remitos", { ...cuerpo, fotos: fotosForm });
      }
      cerrar("#mRemito");
      const deuda = monto - pagado;
      mostrarExito({
        titulo: editando ? "Cambios guardados" : "Remito guardado",
        sub: (numero ? `Remito <b>${esc(numero)}</b>` : "Remito sin número") + (deuda > 0 ? ` · Queda a deber <b>${fmt(deuda)}</b>` : ""),
        duracion: 1500,
      });
      await remCargar();
    } catch (e) {
      err(e.message);
    } finally {
      $("#cpRGuardar").disabled = false;
    }
  }

  // ---------- Gestión rápida de pago ----------
  function pagoCalc() {
    const r = rems.find((x) => x.id === pagoId);
    const n = centavos($("#cpPgInput").value);
    const hay = $("#cpPgInput").value !== "";
    const nuevo = pagoModo === "sumar" ? r.pagado + (hay ? n : 0) : hay ? n : null;
    return { r, hay, n, nuevo };
  }

  function pagoPrev() {
    const { r, hay, nuevo } = pagoCalc();
    const el = $("#cpPgPrev");
    el.className = "cp-deuda";
    if (nuevo === null || (pagoModo === "sumar" && !hay)) return (el.textContent = "");
    if (nuevo > r.monto) {
      el.classList.add("debe");
      return (el.innerHTML = `Se pasa del monto: como máximo ${pagoModo === "sumar" ? `podés sumar <b>${fmt(Math.max(0, r.monto - r.pagado))}</b>` : `el total pagado es <b>${fmt(r.monto)}</b>`}`);
    }
    if (nuevo === r.monto) {
      el.classList.add("ok");
      return (el.textContent = "Quedará pagado completo");
    }
    el.classList.add("debe");
    el.innerHTML = `Quedará pagado <b>${fmt(nuevo)}</b> · debe <b>${fmt(r.monto - nuevo)}</b>`;
  }

  function pagoModoSet(modo) {
    pagoModo = modo;
    document.querySelectorAll("#mPagoRemito [data-modo]").forEach((b) => b.classList.toggle("on", b.dataset.modo === modo));
    $("#cpPgLabel").textContent = modo === "sumar" ? "Monto del pago ($)" : "Total pagado hasta hoy ($)";
    const r = rems.find((x) => x.id === pagoId);
    $("#cpPgInput").value = modo === "total" && r.pagado ? r.pagado / 100 : "";
    $("#cpPgErr").textContent = "";
    pagoPrev();
    $("#cpPgInput").focus();
    $("#cpPgInput").select();
  }

  function pagoAbrir(id) {
    const r = rems.find((x) => x.id === id);
    if (!r) return;
    pagoId = id;
    $("#cpPgTitulo").textContent = `Remito ${r.numero || "sin número"}`;
    $("#cpPgSub").textContent = `${r.proveedor} · ${fechaFmt(r.fecha)}`;
    $("#cpPgMonto").textContent = fmt(r.monto);
    $("#cpPgPagado").textContent = fmt(r.pagado);
    $("#cpPgDebe").textContent = fmt(Math.max(0, r.monto - r.pagado));
    abrir("#mPagoRemito");
    pagoModoSet(r.deuda > 0 ? "sumar" : "total"); // si ya está saldado, lo normal es corregir
  }

  async function pagoGuardar() {
    const { r, hay, n, nuevo } = pagoCalc();
    const err = (t) => ($("#cpPgErr").textContent = t);
    if (!hay) return err(pagoModo === "sumar" ? "Poné el monto del pago" : "Poné el total pagado (0 si no pagaste nada)");
    if (pagoModo === "sumar" && !(n > 0)) return err("El pago tiene que ser mayor a 0");
    if (nuevo > r.monto) return err(`Lo pagado no puede superar el monto del remito (${fmt(r.monto)})`);
    $("#cpPgOk").disabled = true;
    err("");
    try {
      const res = await patch(`/compras/remitos/${r.id}/pago`, { pagado: nuevo });
      cerrar("#mPagoRemito");
      mostrarExito({
        titulo: "Pago guardado",
        sub: res.deuda > 0 ? `Queda a deber <b>${fmt(res.deuda)}</b>` : "Remito pagado completo",
        duracion: 1400,
        confetti: false,
      });
      await remCargar();
    } catch (e) {
      err(e.message);
    } finally {
      $("#cpPgOk").disabled = false;
    }
  }

  function verFotos(id) {
    const r = rems.find((x) => x.id === id);
    if (!r) return;
    $("#cpFTitulo").textContent = `Remito ${r.numero || "sin número"}`;
    $("#cpFSub").textContent = `${r.proveedor} · ${fechaFmt(r.fecha)}`;
    $("#cpFLista").innerHTML = r.fotos
      .map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener" title="Abrir en tamaño real"><img src="${esc(u)}" alt="Foto del remito"></a>`)
      .join("");
    abrir("#mFotosRemito");
  }

  // ==========================================================
  // NAVEGACIÓN Y EVENTOS
  // ==========================================================
  window.cpIr = (destino) => {
    if (destino === "proveedores") {
      nav("admin-proveedores");
      provIniciar();
    } else {
      nav("admin-remitos");
      remIniciar();
    }
  };

  let t1, t2;
  // Proveedores
  $("#cpBuscar").addEventListener("input", (e) => {
    clearTimeout(t1);
    t1 = setTimeout(() => ((pF.q = e.target.value), provRender()), 120);
  });
  $("#cpVista").addEventListener("change", (e) => ((pF.vista = e.target.value), provRender()));
  $("#cpNuevo").addEventListener("click", () => provForm());
  $("#cpBody").addEventListener("click", (e) => {
    const b = e.target.closest("[data-a]");
    if (!b) return;
    const id = Number(b.dataset.id);
    if (b.dataset.a === "nuevo") provForm();
    if (b.dataset.a === "editar") provForm(provs.find((p) => p.id === id));
    if (b.dataset.a === "desactivar") provCambiarActivo(id, false);
    if (b.dataset.a === "reactivar") provCambiarActivo(id, true);
  });
  $("#cpPGuardar").addEventListener("click", provGuardar);
  $("#cpPCerrar").addEventListener("click", () => cerrar("#mProveedor"));
  $("#mProveedor").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.target.tagName === "BUTTON") return;
    e.preventDefault();
    provGuardar();
  });

  // Remitos
  $("#cpRBuscar").addEventListener("input", (e) => {
    clearTimeout(t2);
    t2 = setTimeout(() => ((rF.q = e.target.value), remRender()), 120);
  });
  $("#cpRFiltroProv").addEventListener("change", (e) => ((rF.prov = e.target.value), remRender()));
  $("#cpRFiltroPago").addEventListener("change", (e) => ((rF.pago = e.target.value), remRender()));
  $("#cpRNuevo").addEventListener("click", () => remForm());
  $("#cpRBody").addEventListener("click", (e) => {
    const pill = e.target.closest("[data-pago]");
    if (pill) return pagoAbrir(Number(pill.dataset.pago)); // gestión rápida, sin abrir el remito
    const f = e.target.closest(".cp-ph");
    if (f) return verFotos(Number(f.dataset.id));
    if (e.target.closest("[data-a='nuevo']")) return remForm();
    const fila = e.target.closest(".pr-row[data-id]");
    if (fila) remAbrirEditar(Number(fila.dataset.id));
  });
  $("#cpRBody").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.target.tagName === "BUTTON") return;
    const fila = e.target.closest(".pr-row[data-id]");
    if (fila) remAbrirEditar(Number(fila.dataset.id));
  });
  // Mini pop-up de pago
  document.querySelectorAll("#mPagoRemito [data-modo]").forEach((b) => b.addEventListener("click", () => pagoModoSet(b.dataset.modo)));
  $("#cpPgInput").addEventListener("input", pagoPrev);
  $("#cpPgTodo").addEventListener("click", () => {
    const r = rems.find((x) => x.id === pagoId);
    $("#cpPgInput").value = (pagoModo === "sumar" ? Math.max(0, r.monto - r.pagado) : r.monto) / 100;
    pagoPrev();
  });
  $("#cpPgOk").addEventListener("click", pagoGuardar);
  $("#cpPgCancel").addEventListener("click", () => cerrar("#mPagoRemito"));
  $("#mPagoRemito").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.target.tagName === "BUTTON") return;
    e.preventDefault();
    pagoGuardar();
  });
  $("#cpRGuardar").addEventListener("click", remGuardar);
  $("#cpRCerrar").addEventListener("click", () => cerrar("#mRemito"));
  $("#mRemito").addEventListener("keydown", (e) => {
    if (e.target.closest("#cpIA")) return; // Enter en la tabla no guarda el remito
    if (e.key !== "Enter" || e.target.tagName === "BUTTON" || e.target.tagName === "SELECT") return;
    e.preventDefault();
    remGuardar();
  });
  $("#cpFoto").addEventListener("click", (e) => {
    if (e.target.closest("[data-add]")) return $("#cpFile").click();
    if (e.target.closest("[data-q]")) {
      fotosForm = [];
      if (remEditId !== null) fotoQuitada = true; // al guardar se borra la foto que tenía
      fotoRender();
    }
  });
  $("#cpFoto").addEventListener("dragover", (e) => e.preventDefault());
  $("#cpFoto").addEventListener("drop", async (e) => {
    e.preventDefault();
    await agregarFotos([...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith("image/")));
  });
  $("#cpRMonto").addEventListener("input", deudaRender);
  $("#cpRPagado").addEventListener("input", deudaRender);
  $("#cpRPagoTodo").addEventListener("click", () => {
    const m = $("#cpRMonto").value;
    if (!(Number(m) > 0)) return toast("Primero poné el monto total del remito");
    $("#cpRPagado").value = m;
    deudaRender();
  });
  $("#cpFile").addEventListener("change", async (e) => {
    const files = e.target.files;
    if (files.length) await agregarFotos(files);
    e.target.value = ""; // permite volver a elegir la misma foto
  });
  $("#cpFCerrar").addEventListener("click", () => cerrar("#mFotosRemito"));
})();