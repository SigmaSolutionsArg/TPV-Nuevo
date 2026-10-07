// ==========================================================
// TPV · productos.js  (Admin > Productos)
// Se carga DESPUÉS de app.js y usa sus helpers: $, api, post, fmt, esc, toast, abrir, cerrar, mostrarExito
// Monta su propia vista, su modal y la vista previa de etiquetas, así index.html casi no se toca.
//
// Índice:
//   1. Configuración y utilidades
//   2. Diseño de las etiquetas (CSS compartido entre vista previa e impresión)
//   3. Montaje de la vista
//   4. Tabla: filtros, orden y dibujo
//   5. Alta / edición / desactivar
//   6. Modo etiquetas (selección)
//   7. Vista previa A4 interactiva + impresión
//   8. Eventos
// ==========================================================


// ==========================================================
// 1. CONFIGURACIÓN Y UTILIDADES
// ==========================================================
const STOCK_BAJO = 10; // hasta esta cantidad (sin llegar a 0) se marca como "stock bajo"
const PR_POR_PAGINA = 40;

let prLista = []; // todos los productos (activos e inactivos)
let prEditId = null; // null = creando
// vista: activos | bajo | sin | inactivos | todos
let prF = { q: "", cat: null, vista: "activos", orden: "nombre", dir: 1, pag: 1 };
let prModo = false; // true = modo etiquetas
const prSel = new Set(); // ids de productos elegidos para etiquetas

const prNorm = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const prPut = (url, body) =>
  api(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const prEstadoStock = (n) => (n <= 0 ? "sin" : n <= STOCK_BAJO ? "bajo" : "ok");

const ICO = (d) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICO_EDITAR = ICO('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>');
const ICO_BORRAR = ICO('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>');
const ICO_REACTIVAR = ICO('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>');
const ICO_ETIQUETA = ICO('<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.2"/>');


// ==========================================================
// 2. DISEÑO DE LAS ETIQUETAS
// ==========================================================
// Hoja A4 con 8 mm arriba y abajo:
//   Pequeña 46×25 mm → 4×11 = 44 por hoja
//   Mediana 190×54 mm (ancho completo) → 5 por hoja
//   Grande  190×138 mm → 2 por hoja (con descuento, pensada para blanco y negro)
const ETQ_TIPOS = {
  pequena: { nombre: "Pequeña", plural: "Pequeñas", cls: "t-p", cols: 4, filas: 11 },
  mediana: { nombre: "Mediana", plural: "Medianas", cls: "t-m", cols: 1, filas: 5 },
  promo: { nombre: "Grande", plural: "Grandes", cls: "t-o", cols: 1, filas: 2 },
};

// Este CSS se usa igual en la vista previa y en la ventana de impresión.
// Los colores van fijos (no dependen del tema oscuro/claro): es papel.
const ETIQ_CSS = `
.hoja, .hoja * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box }
.hoja { width: 210mm; height: 296mm; background: #fff; color: #111; padding: 8mm 0; display: grid; justify-content: center; align-content: start; overflow: hidden; font-family: "Inter", "Segoe UI", system-ui, sans-serif }
.hoja.t-p { grid-template-columns: repeat(4, 46mm); grid-auto-rows: 25mm }
.hoja.t-m { grid-template-columns: 190mm; grid-auto-rows: 54mm }
.hoja.t-o { grid-template-columns: 190mm; grid-auto-rows: 138mm }
.et { position: relative; overflow: hidden; box-shadow: inset 0 0 0 .2mm #d3d1da }
.et-name { font-weight: 800; line-height: 1.1; letter-spacing: -.01em; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical }
.et-price { font-weight: 800; letter-spacing: -.03em; white-space: nowrap; line-height: 1 }

/* Pequeña: centrada, nombre protagonista */
.et-p .et-in { height: 100%; padding: 1.8mm 2mm; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1.8mm; text-align: center }
.et-p .et-name { width: 100%; -webkit-line-clamp: 3 }

/* Mediana: ancho completo, para precios grandes */
.et-m { padding: 1.5mm }
.et-m .et-in { height: 100%; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 6mm; padding: 0 9mm; border: .5mm solid #111; border-radius: 4mm; background: #fff }
.et-m .et-izq { min-width: 0; display: flex; flex-direction: column; gap: 3mm }
.et-m .et-gracias { display: flex; align-items: center; gap: 2.5mm; font-size: 8.5pt; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; color: #5a5766 }
.et-m .et-gracias::before { content: ""; width: 10mm; height: .5mm; background: #111 }
.et-m .et-price { padding-left: 7mm; border-left: .5mm solid #d3d1da }

/* Grande: 2 por hoja, pensada para blanco y negro */
.et-o { padding: 2mm }
.et-o .et-in { height: 100%; display: flex; flex-direction: column; border: 1.2mm solid #000; border-radius: 6mm; overflow: hidden; background: #fff; color: #000 }
.et-o .et-top { display: flex; align-items: center; justify-content: space-between; background: #000; color: #fff; padding: 5mm 10mm }
.et-o .et-top small { font-size: 30pt; font-weight: 900; letter-spacing: .22em }
.et-o .et-top b { font-size: 48pt; font-weight: 900; letter-spacing: -.03em; line-height: 1 }
.et-o .et-mid { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 4mm 12mm; gap: 3mm }
.et-o .et-name { width: 100%; font-weight: 900 }
.et-o .et-ant { font-size: 20pt; font-weight: 600 }
.et-o .et-ant s { text-decoration-thickness: .7mm }
.et-o .et-price { font-weight: 900 }
.et-o .et-pie { border-top: .5mm dashed #000; text-align: center; padding: 3mm; font-size: 12pt; font-weight: 700; letter-spacing: .2em; text-transform: uppercase }
`;

// ---------- HTML de una etiqueta ----------
const etqFs = (base, txt, maxChars) => (txt.length > maxChars ? ((base * maxChars) / txt.length).toFixed(1) : base) + "pt";
const etqPrecioPromo = (it) => Math.round((it.p.precio * (100 - it.desc)) / 10000) * 100; // en centavos, a peso entero

function etqHtml(it, vivo) {
  const p = it.p;
  const attrs = vivo ? ` data-uid="${it.uid}" draggable="true" title="Tocá para duplicar o quitar · arrastrá para reordenar"` : "";
  const pr = fmt(p.precio);

  if (it.tipo === "pequena") {
    return `<div class="et et-p"${attrs}><div class="et-in">
      <div class="et-name" style="font-size:${etqFs(9.5, p.nombre, 34)}">${esc(p.nombre)}</div>
      <div class="et-price" style="font-size:${etqFs(17, pr, 8)}">${pr}</div></div></div>`;
  }
  if (it.tipo === "mediana") {
    return `<div class="et et-m"${attrs}><div class="et-in">
      <div class="et-izq">
        <div class="et-name" style="font-size:${etqFs(24, p.nombre, 28)}">${esc(p.nombre)}</div>
        <div class="et-gracias">Gracias por elegirnos</div>
      </div>
      <div class="et-price" style="font-size:${etqFs(44, pr, 8)}">${pr}</div></div></div>`;
  }
  const nuevo = fmt(etqPrecioPromo(it));
  return `<div class="et et-o"${attrs}><div class="et-in">
    <div class="et-top"><small>OFERTA</small><b>-${it.desc}%</b></div>
    <div class="et-mid">
      <div class="et-name" style="font-size:${etqFs(36, p.nombre, 26)}">${esc(p.nombre)}</div>
      <div class="et-ant">Antes <s>${pr}</s></div>
      <div class="et-price" style="font-size:${etqFs(96, nuevo, 7)}">${nuevo}</div>
    </div>
    <div class="et-pie">Gracias por elegirnos</div></div></div>`;
}


// ==========================================================
// 3. MONTAJE DE LA VISTA
// ==========================================================
function montarProductos() {
  document.head.insertAdjacentHTML("beforeend", `<style id="etqCss">${ETIQ_CSS}</style>`);
  document.body.insertAdjacentHTML(
    "beforeend",
    `
  <div id="view-admin-productos" class="view app" style="display:none;">
    <header class="top">
      <button onclick="nav('admin')" style="padding:10px 14px">⬅ Volver</button>
      <div class="brand"><b>Productos</b><small id="prSub">Catálogo, precios y stock</small></div>
      <div class="sp"></div>
      <div class="pill reloj">--:--</div>
      <button class="theme" title="Cambiar tema"
        onclick="aplicarTema(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark')">🌙</button>
    </header>

    <main>
      <div class="pr-bar">
        <div class="searchwrap pr-search">
          <span class="ic">🔍</span>
          <input id="prBuscar" placeholder="Buscar por nombre o código…" autocomplete="off">
        </div>
        <select class="pr-sel" id="prCat" aria-label="Categoría"></select>
        <select class="pr-sel" id="prVista" aria-label="Mostrar"></select>
        <button class="pr-etq" id="prEtq"></button>
        <button class="go pr-nuevo" id="prNuevo" title="Crear un producto nuevo">＋ Nuevo producto</button>
      </div>

      <div class="pr-banner" id="prBanner">
        <div><b>Modo etiquetas</b><small>Elegí los productos que querés imprimir. Podés buscar y filtrar: la selección se conserva.</small></div>
        <div class="r">
          <span class="n" id="prSelCount">0 seleccionados</span>
          <button id="prSelTodo">Seleccionar todo</button>
          <button id="prSelLimpiar">Quitar selección</button>
          <button id="prSalir">Cancelar</button>
        </div>
      </div>

      <div class="card pr-card">
        <div class="pr-scroll">
          <div class="pr-head" id="prHead">
            <span class="pr-chk"><i class="pr-box" id="prBoxAll" role="checkbox" aria-label="Seleccionar todo"></i></span>
            <span class="ord c-cod" data-o="codigo">Código<i></i></span>
            <span class="ord" data-o="nombre">Producto<i></i></span>
            <span class="ord c-cat" data-o="categoria">Categoría<i></i></span>
            <span class="ord r" data-o="precio">Precio<i></i></span>
            <span class="ord r" data-o="stock">Stock<i></i></span>
            <span class="pr-acc-h"></span>
          </div>
          <div id="prBody"></div>
        </div>
        <div class="pr-foot" id="prFoot"></div>
      </div>
    </main>
  </div>

  <div class="modal" id="mProducto">
    <div class="box" style="width:480px">
      <h2 id="pTitulo">Nuevo producto</h2>
      <p id="pSub">Se agrega al catálogo.</p>
      <label>Código (escaneá o escribí)</label>
      <input id="pCodigo" placeholder="Código de barras o interno" autocomplete="off">
      <label>Nombre</label>
      <input id="pNombre" placeholder="Ej: Gaseosa Cola 2,25 L x6" autocomplete="off">
      <div class="row2">
        <div><label>Precio ($)</label><input id="pPrecio" type="number" min="0" step="any" placeholder="0"></div>
        <div><label>Stock</label><input id="pStock" type="number" step="1" value="0"></div>
      </div>
      <label>Categoría</label>
      <input id="pCategoria" list="prCategorias" placeholder="Elegí una o escribí una nueva" autocomplete="off">
      <datalist id="prCategorias"></datalist>
      <div class="err" id="pErr"></div>
      <div class="acc">
        <button id="pCerrar">Cancelar</button>
        <button class="go" id="pGuardar">Guardar</button>
      </div>
    </div>
  </div>

  <!-- Vista previa de etiquetas (pantalla completa) -->
  <div id="mEtiquetas" class="etq-ov app" style="display:none;">
    <header class="top">
      <button id="etqVolver" style="padding:10px 14px">⬅ Volver a la selección</button>
      <div class="brand"><b>Vista previa</b><small id="etqSub">Hojas A4</small></div>
      <div class="sp"></div>
      <div class="etq-zoom">
        <button id="etqZm" title="Alejar">−</button><span id="etqZt">100%</span><button id="etqZp" title="Acercar">+</button>
        <button id="etqZf">Ajustar</button>
      </div>
    </header>
    <div class="etq-body">
      <div class="etq-scroll" id="etqScroll"><div id="etqPages"></div></div>
      <aside class="etq-panel card" id="etqPanel">
        <div class="etq-sec">
          <h4>Tamaño de las etiquetas</h4>
          <div class="etq-seg" id="etqTipoAll"></div>
          <div class="etq-fila" id="etqFilaDesc">
            <label for="etqDescAll">Descuento</label>
            <div class="etq-in"><input id="etqDescAll" type="number" min="1" max="90" value="20"><span>%</span></div>
          </div>
        </div>
        <div class="etq-sec"><h4>Etiqueta elegida</h4><div id="etqSelBox"></div></div>
        <div class="etq-pie">
          <div class="etq-res" id="etqRes"></div>
          <button class="go" id="etqImprimir">Imprimir o guardar PDF</button>
        </div>
      </aside>
    </div>
  </div>`
  );
  aplicarTema(document.documentElement.dataset.theme || "light"); // pinta el ícono del tema en los botones nuevos
  conectarEventosProductos();
  prPintarSel();
}


// ==========================================================
// 4. TABLA: FILTROS, ORDEN Y DIBUJO
// ==========================================================
function prCoincideVista(p, v) {
  if (v === "todos") return true;
  if (v === "inactivos") return !p.activo;
  if (!p.activo) return false;
  if (v === "bajo") return p.stock > 0 && p.stock <= STOCK_BAJO;
  if (v === "sin") return p.stock <= 0;
  return true; // activos
}

function prFiltrada(ignorarCategoria = false) {
  const q = prNorm(prF.q.trim());
  return prLista.filter((p) => {
    if (!prCoincideVista(p, prF.vista)) return false;
    if (!ignorarCategoria && prF.cat && p.categoria !== prF.cat) return false;
    if (q && !prNorm(p.nombre).includes(q) && !prNorm(p.codigo).includes(q)) return false;
    return true;
  });
}

function prOrdenar(lista) {
  const { orden, dir } = prF;
  return lista.sort((a, b) => {
    const x = a[orden], y = b[orden];
    const r = typeof x === "number" ? x - y : String(x).localeCompare(String(y), "es", { numeric: true, sensitivity: "base" });
    return (r || a.nombre.localeCompare(b.nombre, "es")) * dir;
  });
}

function prRender() {
  // Si la categoría elegida ya no existe (se renombró o quedó vacía), se quita el filtro
  if (prF.cat && !prLista.some((p) => p.categoria === prF.cat)) prF.cat = null;

  prRenderControles();

  document.querySelectorAll("#prHead .ord").forEach((th) => {
    const on = th.dataset.o === prF.orden;
    th.classList.toggle("on", on);
    th.querySelector("i").textContent = on ? (prF.dir === 1 ? "▲" : "▼") : "";
  });

  const lista = prOrdenar(prFiltrada());
  const paginas = Math.max(1, Math.ceil(lista.length / PR_POR_PAGINA));
  prF.pag = Math.min(prF.pag, paginas);
  const ini = (prF.pag - 1) * PR_POR_PAGINA;
  const pagina = lista.slice(ini, ini + PR_POR_PAGINA);

  $("#prBody").innerHTML = pagina.length ? pagina.map(prFila).join("") : prVacio();

  $("#prFoot").innerHTML = lista.length
    ? `<span>${ini + 1}–${ini + pagina.length} de ${lista.length}</span>
       <div class="pr-pag"><button data-p="-1" title="Anterior" ${prF.pag <= 1 ? "disabled" : ""}>‹</button>
       <span>${prF.pag} / ${paginas}</span>
       <button data-p="1" title="Siguiente" ${prF.pag >= paginas ? "disabled" : ""}>›</button></div>`
    : `<span>0 productos</span>`;

  prPintarSel();
}

function prFila(p) {
  const est = prEstadoStock(p.stock);
  return `<div class="pr-row ${p.activo ? "" : "off"}" data-id="${p.id}">
    <span class="pr-chk"><i class="pr-box" role="checkbox"></i></span>
    <span class="pr-cod c-cod">${esc(p.codigo)}</span>
    <span class="pr-nom">${esc(p.nombre)}${p.activo ? "" : '<em class="pr-tag">Inactivo</em>'}</span>
    <span class="pr-cat-t c-cat">${esc(p.categoria)}</span>
    <span class="pr-precio r">${fmt(p.precio)}</span>
    <span class="pr-stk r ${est}">${p.stock}</span>
    <span class="pr-acc">
      <button class="pr-ic" data-a="editar" data-id="${p.id}" title="Editar">${ICO_EDITAR}</button>
      ${p.activo
        ? `<button class="pr-ic del" data-a="desactivar" data-id="${p.id}" title="Desactivar">${ICO_BORRAR}</button>`
        : `<button class="pr-ic res" data-a="reactivar" data-id="${p.id}" title="Reactivar">${ICO_REACTIVAR}</button>`}
    </span>
  </div>`;
}

function prVacio() {
  const sinProductos = !prLista.length;
  return `<div class="pr-vacio">
    <b>${sinProductos ? "📦" : "🔎"}</b>
    <span>${sinProductos ? "Todavía no cargaste productos." : "No hay productos con esos filtros."}</span>
    ${sinProductos
      ? `<button class="go" data-a="nuevo">＋ Crear el primero</button>`
      : `<button data-a="limpiar">Quitar filtros</button>`}
  </div>`;
}

// Resumen del encabezado + las opciones de los dos desplegables
function prRenderControles() {
  const activos = prLista.filter((p) => p.activo);
  const valor = activos.reduce((s, p) => s + Math.max(p.stock, 0) * p.precio, 0);
  $("#prSub").textContent = `${activos.length} productos activos · stock valorizado ${fmt(valor)}`;

  // Categorías (con cuántos productos tiene cada una según los demás filtros)
  const base = prFiltrada(true);
  const conteo = {};
  base.forEach((p) => (conteo[p.categoria] = (conteo[p.categoria] || 0) + 1));
  const cats = [...new Set(prLista.map((p) => p.categoria))].sort((a, b) => a.localeCompare(b, "es"));
  $("#prCat").innerHTML =
    `<option value="">Todas las categorías</option>` +
    cats.map((c) => `<option value="${esc(c)}">${esc(c)} (${conteo[c] || 0})</option>`).join("");
  $("#prCat").value = prF.cat || "";
  $("#prCategorias").innerHTML = cats.map((c) => `<option value="${esc(c)}">`).join("");

  // Mostrar: activos / stock bajo / sin stock / inactivos / todos
  const n = (v) => prLista.filter((p) => prCoincideVista(p, v)).length;
  $("#prVista").innerHTML = [["activos", "Activos"], ["bajo", "Stock bajo"], ["sin", "Sin stock"], ["inactivos", "Inactivos"], ["todos", "Todos"]]
    .map(([v, t]) => `<option value="${v}">${t} (${n(v)})</option>`)
    .join("");
  $("#prVista").value = prF.vista;
}

async function prCargar() {
  try {
    prLista = await api("/productos?incluir_inactivos=true");
    prRender();
  } catch (e) {
    toast("No se pudieron cargar los productos: " + e.message);
  }
}

function iniciarProductos() {
  prF = { ...prF, q: "", cat: null, pag: 1 };
  $("#prBuscar").value = "";
  $("#mEtiquetas").style.display = "none";
  etq.items = [];
  etq.sel = null;
  prModo = false;
  prSel.clear();
  prCargar();
  setTimeout(() => $("#prBuscar").focus(), 50);
}


// ==========================================================
// 5. ALTA / EDICIÓN / DESACTIVAR
// ==========================================================
function prAbrirForm(p = null) {
  if (prModo) return; // en modo etiquetas no se crea ni se edita
  prEditId = p ? p.id : null;
  $("#pTitulo").textContent = p ? "Editar producto" : "Nuevo producto";
  $("#pSub").textContent = p ? "Los cambios se aplican al instante." : "Se agrega al catálogo.";
  $("#pCodigo").value = p ? p.codigo : "";
  $("#pNombre").value = p ? p.nombre : "";
  $("#pPrecio").value = p ? p.precio / 100 : "";
  $("#pStock").value = p ? p.stock : 0;
  $("#pCategoria").value = p ? p.categoria : prF.cat || "";
  $("#pErr").textContent = "";
  abrir("#mProducto");
  $("#pCodigo").focus();
}

async function prGuardar() {
  const codigo = $("#pCodigo").value.trim();
  const nombre = $("#pNombre").value.trim();
  const precioPesos = Number($("#pPrecio").value);
  const stock = $("#pStock").value === "" ? 0 : parseInt($("#pStock").value, 10);
  const categoria = $("#pCategoria").value.trim() || "Sin categoría";
  const err = (t) => ($("#pErr").textContent = t);

  if (!codigo) return err("Poné un código");
  if (!nombre) return err("Poné un nombre");
  if ($("#pPrecio").value === "" || !(precioPesos >= 0)) return err("Poné un precio válido");
  if (!Number.isInteger(stock)) return err("El stock tiene que ser un número entero");

  const body = { codigo, nombre, precio: Math.round(precioPesos * 100), stock, categoria };
  $("#pGuardar").disabled = true;
  try {
    const editando = prEditId !== null;
    if (editando) await prPut(`/productos/${prEditId}`, body);
    else await post("/productos", body);

    cerrar("#mProducto");
    mostrarExito({
      titulo: editando ? "Cambios guardados" : "Producto creado",
      sub: esc(nombre),
      monto: fmt(body.precio),
      duracion: 1400,
      confetti: !editando,
    });
    await prCargar();
  } catch (e) {
    err(e.message);
  } finally {
    $("#pGuardar").disabled = false;
  }
}

async function prCambiarActivo(id, activar) {
  const p = prLista.find((x) => x.id === id);
  if (!p) return;
  try {
    if (activar) {
      await prPut(`/productos/${id}`, { activo: true });
    } else {
      if (!confirm(`¿Desactivar "${p.nombre}"?\n\nNo se borra: deja de aparecer en el mostrador pero se conserva el historial de ventas.`)) return;
      await api(`/productos/${id}`, { method: "DELETE" });
    }
    mostrarExito({
      tipo: activar ? "ok" : "anulado",
      titulo: activar ? "Producto reactivado" : "Producto desactivado",
      sub: esc(p.nombre),
      duracion: 1400,
      confetti: false,
    });
    await prCargar();
  } catch (e) {
    toast(e.message);
  }
}


// ==========================================================
// 6. MODO ETIQUETAS (SELECCIÓN)
// ==========================================================
// Un solo botón hace de "Generar etiquetas" y de "Confirmar".
function prBotonEtiquetas() {
  if (!prModo) {
    prModo = true;
    prPintarSel();
    $("#prBuscar").focus();
    return;
  }
  if (prSel.size) etqAbrir();
}

function prSalirModo() {
  prModo = false;
  prSel.clear();
  prPintarSel();
}

// Selecciona (o quita) TODOS los productos de la lista filtrada, no solo los de la página visible
function prToggleTodo() {
  const ids = prFiltrada().map((p) => p.id);
  if (!ids.length) return;
  const todos = ids.every((id) => prSel.has(id));
  ids.forEach((id) => (todos ? prSel.delete(id) : prSel.add(id)));
  prPintarSel();
}

// Refleja el estado (modo, selección, botones) en pantalla sin volver a dibujar la tabla
function prPintarSel() {
  $("#view-admin-productos").classList.toggle("modo-etq", prModo);
  $("#prBanner").style.display = prModo ? "flex" : "none";
  $("#prNuevo").disabled = prModo;

  const n = prSel.size;
  const btn = $("#prEtq");
  btn.classList.toggle("go", prModo);
  btn.disabled = prModo && n === 0;
  btn.innerHTML = prModo ? `Confirmar${n ? ` (${n})` : ""}` : `${ICO_ETIQUETA} Generar etiquetas`;
  if (!prModo) return;

  document.querySelectorAll("#prBody .pr-row").forEach((r) => {
    r.classList.toggle("sel", prSel.has(Number(r.dataset.id)));
  });

  const ids = prFiltrada().map((p) => p.id);
  const marcados = ids.filter((id) => prSel.has(id)).length;
  const todos = ids.length > 0 && marcados === ids.length;

  $("#prSelCount").textContent = `${n} seleccionado${n === 1 ? "" : "s"}`;
  $("#prSelTodo").textContent = todos ? `Quitar los ${ids.length} de la lista` : `Seleccionar todo (${ids.length})`;
  $("#prSelTodo").disabled = !ids.length;
  $("#prSelLimpiar").disabled = n === 0;
}


// ==========================================================
// 7. VISTA PREVIA A4 INTERACTIVA + IMPRESIÓN
// ==========================================================
// items: [{ uid, p: producto, tipo: "pequena"|"mediana"|"promo", desc: % }]
// Cada elemento es UNA etiqueta en la hoja: duplicar agrega otra al lado.
// Todas las etiquetas comparten el mismo tamaño (etq.tipoDef): no se mezclan.
let etq = { items: [], sel: null, zoom: null, descDef: 20, tipoDef: "mediana", cont: 0 };
let etqArrastrando = null;

const etqUid = () => ++etq.cont;
const etqItem = (uid) => etq.items.find((i) => i.uid === uid) || null;
const etqSeg = (act) =>
  Object.entries(ETQ_TIPOS).map(([k, t]) => `<button data-t="${k}" class="${act === k ? "on" : ""}">${t.nombre}</button>`).join("");
const etqDescOk = (v) => Math.min(90, Math.max(1, parseInt(v, 10)));

function etqAbrir() {
  // Se conservan las etiquetas ya editadas (duplicadas, orden) de productos que siguen elegidos; se suman las nuevas
  const elegidos = prOrdenar(prLista.filter((p) => prSel.has(p.id)));
  const porId = new Map(elegidos.map((p) => [p.id, p]));
  const previos = etq.items.filter((i) => porId.has(i.p.id)).map((i) => ({ ...i, p: porId.get(i.p.id), tipo: etq.tipoDef, desc: etq.descDef }));
  const ya = new Set(previos.map((i) => i.p.id));
  const nuevos = elegidos.filter((p) => !ya.has(p.id)).map((p) => ({ uid: etqUid(), p, tipo: etq.tipoDef, desc: etq.descDef }));
  etq.items = [...previos, ...nuevos];
  if (!etqItem(etq.sel)) etq.sel = null;

  $("#mEtiquetas").style.display = "flex";
  $("#etqDescAll").value = etq.descDef;
  etqActualizar();
}

function etqVolver() {
  $("#mEtiquetas").style.display = "none";
  $("#prBuscar").focus();
}

// Organiza las etiquetas en hojas: una hoja nunca mezcla tamaños
function etqPaginas() {
  const out = [];
  for (const [clave, t] of Object.entries(ETQ_TIPOS)) {
    const lista = etq.items.filter((i) => i.tipo === clave);
    const cap = t.cols * t.filas;
    for (let i = 0; i < lista.length; i += cap) out.push({ clave, t, cap, items: lista.slice(i, i + cap) });
  }
  return out;
}

function etqEscala() {
  if (etq.zoom) return etq.zoom;
  const ancho = $("#etqScroll").clientWidth - 64;
  return Math.max(0.3, Math.min(1.1, ancho / 794));
}

function etqRenderPaginas() {
  const s = etqEscala();
  $("#etqZt").textContent = Math.round(s * 100) + "%";
  const pgs = etqPaginas();
  if (!pgs.length) {
    $("#etqPages").innerHTML = `<div class="etq-vacio">No quedan etiquetas. Volvé a la selección para elegir productos.</div>`;
    return;
  }
  $("#etqPages").innerHTML = pgs
    .map(
      (pg, i) => `<div class="etq-pag">
      <div class="etq-cap">Hoja ${i + 1} de ${pgs.length} · ${pg.t.plural} · ${pg.items.length} de ${pg.cap}</div>
      <div class="etq-esc" style="width:${Math.round(794 * s)}px;height:${Math.round(1119 * s)}px">
        <section class="hoja ${pg.t.cls}" style="transform:scale(${s})">${pg.items.map((it) => etqHtml(it, true)).join("")}</section>
      </div></div>`
    )
    .join("");
  etqMarcarSel();
}

function etqMarcarSel() {
  document.querySelectorAll("#etqPages .et").forEach((el) => el.classList.toggle("sel", Number(el.dataset.uid) === etq.sel));
}

function etqRenderGlobal() {
  $("#etqTipoAll").innerHTML = etqSeg(etq.tipoDef);
  $("#etqFilaDesc").style.display = etq.tipoDef === "promo" ? "flex" : "none"; // descuento solo con las Grandes
}

function etqRenderSel() {
  const it = etqItem(etq.sel);
  const box = $("#etqSelBox");
  if (!it) {
    box.innerHTML = `<p class="etq-hint">Tocá una etiqueta de la hoja para duplicarla o quitarla. También podés arrastrarla para cambiar el orden.</p>`;
    return;
  }
  box.innerHTML = `
    <div class="etq-sel-nom">${esc(it.p.nombre)}</div>
    <small class="etq-sel-cod">${esc(it.p.codigo)}</small>
    <div class="etq-btns"><button id="etqDup">Duplicar</button><button class="del" id="etqDel">Quitar</button></div>`;
}

function etqRenderResumen() {
  const n = etq.items.length;
  const hojas = etqPaginas().length;
  const por = Object.entries(ETQ_TIPOS)
    .map(([k, t]) => {
      const c = etq.items.filter((i) => i.tipo === k).length;
      return c ? `${c} ${(c === 1 ? t.nombre : t.plural).toLowerCase()}` : null;
    })
    .filter(Boolean)
    .join(" · ");
  const txt = `${n} etiqueta${n === 1 ? "" : "s"} en ${hojas} hoja${hojas === 1 ? "" : "s"} A4`;
  $("#etqRes").innerHTML = `<b>${txt}</b><small>${por || "Sin etiquetas"}</small>`;
  $("#etqSub").textContent = txt;
  $("#etqImprimir").disabled = n === 0;
}

function etqActualizar() {
  etqRenderGlobal();
  etqRenderSel();
  etqRenderPaginas();
  etqRenderResumen();
}

// ---------- Acciones sobre las etiquetas ----------
function etqSetTipoTodos(t) {
  etq.items.forEach((i) => (i.tipo = t));
  etq.tipoDef = t;
  etqActualizar();
}

function etqDuplicar() {
  const i = etq.items.findIndex((x) => x.uid === etq.sel);
  if (i < 0) return;
  const copia = { ...etq.items[i], uid: etqUid() };
  etq.items.splice(i + 1, 0, copia);
  etq.sel = copia.uid; // queda elegida la copia: tocando de nuevo "Duplicar" se suman más
  etqActualizar();
}

function etqQuitar() {
  const i = etq.items.findIndex((x) => x.uid === etq.sel);
  if (i < 0) return;
  etq.items.splice(i, 1);
  etq.sel = etq.items.length ? etq.items[Math.min(i, etq.items.length - 1)].uid : null;
  etqActualizar();
}

// ---------- Impresión: arma una ventana con las hojas A4 y abre el diálogo de impresión ----------
// Desde ahí se puede imprimir o elegir "Guardar como PDF".
function etqImprimir() {
  if (!etq.items.length) return;
  const w = window.open("", "_blank");
  if (!w) return toast("El navegador bloqueó la ventana. Permití las ventanas emergentes para imprimir.");
  const hojas = etqPaginas()
    .map((pg) => `<section class="hoja ${pg.t.cls}">${pg.items.map((it) => etqHtml(it, false)).join("")}</section>`)
    .join("");
  w.document.open();
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Etiquetas</title>
<style>${ETIQ_CSS}
@page { size: A4; margin: 0 }
html, body { margin: 0; background: #e9e8ee }
.hoja { margin: 0 auto 8mm; box-shadow: 0 2px 12px rgba(0,0,0,.2) }
@media print {
  html, body { background: #fff }
  .hoja { margin: 0; box-shadow: none; break-after: page; page-break-after: always }
  .hoja:last-child { break-after: auto; page-break-after: auto }
}
</style></head><body>${hojas}
<script>addEventListener("load", function () { setTimeout(function () { print(); }, 400); });<\/script>
</body></html>`);
  w.document.close();
}


// ==========================================================
// 8. EVENTOS
// ==========================================================
function conectarEventosProductos() {
  // ---------- Tabla ----------
  let t;
  $("#prBuscar").addEventListener("input", (e) => {
    clearTimeout(t);
    t = setTimeout(() => {
      prF.q = e.target.value;
      prF.pag = 1;
      prRender();
    }, 120);
  });
  $("#prBuscar").addEventListener("keydown", (e) => {
    if (e.key === "Escape" && e.target.value) {
      e.target.value = "";
      prF.q = "";
      prF.pag = 1;
      prRender();
      e.stopPropagation(); // el primer Escape solo limpia la búsqueda
    }
  });

  $("#prCat").addEventListener("change", (e) => {
    prF.cat = e.target.value || null;
    prF.pag = 1;
    prRender();
  });
  $("#prVista").addEventListener("change", (e) => {
    prF.vista = e.target.value;
    prF.pag = 1;
    prRender();
  });

  $("#prHead").addEventListener("click", (e) => {
    const th = e.target.closest(".ord");
    if (!th) return;
    const campo = th.dataset.o;
    prF.dir = prF.orden === campo ? -prF.dir : 1;
    prF.orden = campo;
    prRender();
  });

  $("#prBody").addEventListener("click", (e) => {
    const b = e.target.closest("[data-a]");
    if (b && b.dataset.a === "limpiar") {
      prF = { ...prF, q: "", cat: null, vista: "activos", pag: 1 };
      $("#prBuscar").value = "";
      return prRender();
    }
    if (prModo) {
      // En modo etiquetas, tocar cualquier parte de la fila la elige o la quita
      const fila = e.target.closest(".pr-row");
      if (!fila) return;
      const id = Number(fila.dataset.id);
      if (prSel.has(id)) prSel.delete(id);
      else prSel.add(id);
      return prPintarSel();
    }
    if (!b) return;
    const id = Number(b.dataset.id);
    if (b.dataset.a === "editar") prAbrirForm(prLista.find((p) => p.id === id));
    if (b.dataset.a === "desactivar") prCambiarActivo(id, false);
    if (b.dataset.a === "reactivar") prCambiarActivo(id, true);
    if (b.dataset.a === "nuevo") prAbrirForm();
  });

  $("#prFoot").addEventListener("click", (e) => {
    const b = e.target.closest("[data-p]");
    if (!b) return;
    prF.pag += Number(b.dataset.p);
    prRender();
  });

  // ---------- Alta / edición ----------
  $("#prNuevo").addEventListener("click", () => prAbrirForm());
  $("#pGuardar").addEventListener("click", prGuardar);
  $("#pCerrar").addEventListener("click", () => cerrar("#mProducto"));
  // Enter guarda; en el código salta al nombre (la pistola lectora termina con Enter)
  $("#mProducto").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.target.tagName === "BUTTON") return;
    e.preventDefault();
    if (e.target.id === "pCodigo") $("#pNombre").focus();
    else prGuardar();
  });

  // ---------- Modo etiquetas ----------
  $("#prEtq").addEventListener("click", prBotonEtiquetas);
  $("#prSelTodo").addEventListener("click", prToggleTodo);
  $("#prSelLimpiar").addEventListener("click", () => {
    prSel.clear();
    prPintarSel();
  });
  $("#prSalir").addEventListener("click", prSalirModo);

  // ---------- Vista previa ----------
  $("#etqVolver").addEventListener("click", etqVolver);
  $("#etqImprimir").addEventListener("click", etqImprimir);
  $("#etqZm").addEventListener("click", () => {
    etq.zoom = Math.max(0.3, +(etqEscala() - 0.1).toFixed(2));
    etqRenderPaginas();
  });
  $("#etqZp").addEventListener("click", () => {
    etq.zoom = Math.min(1.5, +(etqEscala() + 0.1).toFixed(2));
    etqRenderPaginas();
  });
  $("#etqZf").addEventListener("click", () => {
    etq.zoom = null;
    etqRenderPaginas();
  });
  let rz;
  addEventListener("resize", () => {
    clearTimeout(rz);
    rz = setTimeout(() => {
      if ($("#mEtiquetas").style.display === "flex" && !etq.zoom) etqRenderPaginas();
    }, 120);
  });

  // Panel lateral
  $("#etqPanel").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.t && b.closest("#etqTipoAll")) return etqSetTipoTodos(b.dataset.t);
    if (b.id === "etqDup") return etqDuplicar();
    if (b.id === "etqDel") return etqQuitar();
  });
  $("#etqPanel").addEventListener("input", (e) => {
    if (e.target.id !== "etqDescAll") return;
    const v = e.target.value;
    if (!/^\d+$/.test(v)) return; // vacío o inválido: se espera a que escriba un número
    etq.descDef = etqDescOk(v);
    etq.items.forEach((i) => (i.desc = etq.descDef));
    etqRenderPaginas();
  });
  $("#etqPanel").addEventListener("change", (e) => {
    // Al salir del campo se corrige el valor mostrado (queda dentro de 1–90)
    if (e.target.id === "etqDescAll") e.target.value = etq.descDef;
  });

  // Hojas: elegir y reordenar arrastrando
  const pages = $("#etqPages");
  pages.addEventListener("click", (e) => {
    const el = e.target.closest(".et[data-uid]");
    if (!el) return;
    etq.sel = Number(el.dataset.uid);
    etqMarcarSel();
    etqRenderSel();
  });
  pages.addEventListener("dragstart", (e) => {
    const el = e.target.closest(".et[data-uid]");
    if (!el) return;
    etqArrastrando = Number(el.dataset.uid);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(etqArrastrando));
    el.classList.add("arrastrando");
  });
  pages.addEventListener("dragover", (e) => {
    const el = e.target.closest(".et[data-uid]");
    const origen = etqItem(etqArrastrando);
    const destino = el ? etqItem(Number(el.dataset.uid)) : null;
    document.querySelectorAll("#etqPages .et.sobre").forEach((x) => x.classList.remove("sobre"));
    if (!origen || !destino || origen.uid === destino.uid) return;
    e.preventDefault();
    el.classList.add("sobre");
  });
  pages.addEventListener("drop", (e) => {
    const el = e.target.closest(".et[data-uid]");
    const origen = etqItem(etqArrastrando);
    const destino = el ? etqItem(Number(el.dataset.uid)) : null;
    if (!origen || !destino || origen.uid === destino.uid) return;
    e.preventDefault();
    const desde = etq.items.indexOf(origen);
    const hasta = etq.items.indexOf(destino);
    etq.items.splice(desde, 1);
    etq.items.splice(hasta, 0, origen);
    etq.sel = origen.uid;
    etqArrastrando = null;
    etqActualizar();
  });
  pages.addEventListener("dragend", () => {
    etqArrastrando = null;
    document.querySelectorAll("#etqPages .et").forEach((x) => x.classList.remove("arrastrando", "sobre"));
  });

  // Teclado: Esc vuelve / cancela el modo, Supr quita la etiqueta elegida
  document.addEventListener("keydown", (e) => {
    const enCampo = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || "");
    if ($("#mEtiquetas").style.display === "flex") {
      if (e.key === "Escape") etqVolver();
      else if (e.key === "Delete" && !enCampo) etqQuitar();
      return;
    }
    if (e.key === "Escape" && prModo && $("#view-admin-productos").style.display === "flex" && !document.querySelector(".modal.abierto")) {
      prSalirModo();
    }
  });
}

montarProductos();