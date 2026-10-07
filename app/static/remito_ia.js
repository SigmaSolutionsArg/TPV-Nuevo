// ==========================================================
// TPV · remito_ia.js — "Leer con IA" dentro del modal Nuevo remito.
// Se carga DESPUÉS de compras.js. Usa los helpers de app.js: $, api, post, fmt, esc, toast, abrir, cerrar.
// Las compras no tocan el stock: se guarda el remito, sus líneas y los productos nuevos
// (cada producto nuevo pide precio de venta y categoría en un pop-up al guardar).
// ==========================================================
(() => {
  // Al elegir una opción de un <datalist> (la categoría) Chrome dispara un keydown SIN `key`, y la pistola lectora
  // de app.js lo lee (e.key.length) y tira error. Se descarta ese evento antes de que llegue a esos listeners.
  window.addEventListener("keydown", (e) => { if (!e.key) e.stopImmediatePropagation(); }, true);

  let items = [];

  const num = (v) => {
    const n = Number(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  };
  const cent = (x) => Math.round(num(x) * 100);
  const sub = (i) => Math.round(num(i.cantidad) * num(i.costo) * 100);
  const totalCent = () => items.reduce((s, i) => s + sub(i), 0);
  const conflicto = (i) => i.producto_id && !i.coincide && !i.confirmado;
  const clave = (i) => String(i.codigo || "").trim().toLowerCase();

  const css = document.createElement("style");
  css.textContent = `
    .ria-vacio { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-top: 6px; padding: 14px 16px; border: 1px dashed var(--line); border-radius: 16px; color: var(--mut); font-size: 13.5px }
    .ria-card { margin-top: 14px; border: 1px solid var(--line); border-radius: 16px; padding: 12px 12px 6px; overflow-x: auto }
    .ria-cols { grid-template-columns: 104px 112px minmax(190px, 1fr) 66px 110px 110px 28px }
    .ria-grid { display: grid; gap: 8px; align-items: center; min-width: 740px }
    .ria-grid.h { font-size: 11.5px; color: var(--mut); font-weight: 600; padding: 0 0 8px }
    .ria-grid.h .r { text-align: right }
    .ria-item { padding: 5px 0; border-top: 1px solid var(--line) }
    .ria-item:first-child { border-top: 0 }
    .ria-grid input { width: 100%; min-width: 0; height: 38px; padding: 0 10px; font-size: 13.5px; box-sizing: border-box }
    .ria-grid input[type=number] { text-align: right }
    .ria-est { display: block; font-size: 11.5px; font-weight: 700; padding: 6px 4px; border-radius: 9px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
    .ria-est.e { background: var(--acc-soft); color: var(--acc-txt) }
    .ria-est.n { background: rgba(245, 158, 11, .18); color: #b45309 }
    .ria-est.w { background: rgba(239, 68, 68, .16); color: #b91c1c }
    .ria-sub { text-align: right; font-weight: 600; font-size: 13.5px; white-space: nowrap }
    .ria-x { padding: 0; width: 28px; height: 28px; border-radius: 50%; line-height: 1 }
    .ria-warn { display: none; margin: 6px 0 2px; padding: 9px 12px; border-radius: 12px; background: rgba(239, 68, 68, .10); color: #b91c1c; font-size: 12.5px; min-width: 740px; box-sizing: border-box }
    .ria-warn.on { display: flex; align-items: center; gap: 10px; flex-wrap: wrap }
    .ria-warn span { flex: 1 1 320px }
    .ria-warn button { padding: 6px 12px; font-size: 12.5px; border-radius: 10px }
    .ria-pie { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; gap: 10px; flex-wrap: wrap }
    .ria-tot { font-size: 15px }
    .ria-tot b { font-size: 18px }
    .ria-dif { margin: 6px 0 0; font-size: 12.5px; color: var(--mut); text-align: right }
    #mNuevoProd .np-info { margin: 10px 0 4px; padding: 12px 14px; border-radius: 14px; background: var(--bg); font-size: 13.5px; line-height: 1.5 }
    #mNuevoProd .np-info b { font-size: 15px }
  `;
  document.head.appendChild(css);

  // ---------- Pop-up de producto nuevo ----------
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="modal" id="mNuevoProd">
      <div class="box" style="width:480px">
        <h2 id="npTit">Producto nuevo</h2>
        <p id="npSub">Completá los datos para crearlo.</p>
        <div class="np-info" id="npInfo"></div>
        <label>Precio de venta ($)</label>
        <input id="npPrecio" type="number" min="0" step="any" placeholder="0" autocomplete="off">
        <label>Categoría</label>
        <input id="npCat" list="npCats" placeholder="Elegí una o escribí una nueva" autocomplete="off">
        <datalist id="npCats"></datalist>
        <div class="err" id="npErr"></div>
        <div class="acc">
          <button id="npCancel">Cancelar</button>
          <button class="go" id="npOk">Siguiente</button>
        </div>
      </div>
    </div>`
  );

  let resolverNP = null;
  function npCerrar(valor) {
    cerrar("#mNuevoProd");
    const r = resolverNP;
    resolverNP = null;
    if (r) r(valor);
  }
  function npOk() {
    const precio = num($("#npPrecio").value);
    const categoria = $("#npCat").value.trim();
    if (!(precio > 0)) return ($("#npErr").textContent = "Poné el precio de venta");
    if (!categoria) return ($("#npErr").textContent = "Elegí o escribí una categoría");
    npCerrar({ precio, categoria });
  }
  $("#npOk").addEventListener("click", npOk);
  $("#npCancel").addEventListener("click", () => npCerrar(null));
  $("#mNuevoProd").addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation(); // que no cierre también el modal del remito
      return npCerrar(null);
    }
    if (e.key === "Enter" && e.target.tagName !== "BUTTON") {
      e.preventDefault();
      e.stopPropagation();
      npOk();
    }
  });

  function modalNuevo(it, n, total, cats) {
    return new Promise((res) => {
      resolverNP = res;
      $("#npTit").textContent = `Producto nuevo ${n + 1} de ${total}`;
      $("#npInfo").innerHTML = `<b>${esc(it.nombre)}</b><br>Código <b>${esc(it.codigo)}</b>${num(it.costo) ? ` · Costo ${fmt(cent(it.costo))}` : ""}`;
      $("#npCats").innerHTML = cats.map((c) => `<option value="${esc(c)}">`).join("");
      $("#npPrecio").value = it.precio_venta || "";
      $("#npCat").value = it.categoria || "";
      $("#npErr").textContent = "";
      $("#npOk").textContent = n + 1 === total ? "Guardar remito" : "Siguiente";
      abrir("#mNuevoProd");
      setTimeout(() => $("#npPrecio").focus(), 60);
    });
  }

  // Un pop-up por cada producto nuevo (por código). true = seguir guardando, false = canceló
  async function pedirNuevos() {
    const vistos = new Set();
    const nuevos = items.filter((i) => {
      if (i.producto_id || !i.nombre.trim() || vistos.has(clave(i))) return false;
      vistos.add(clave(i));
      return true;
    });
    if (!nuevos.length) return true;
    let cats = [];
    try {
      cats = await api("/productos/categorias");
    } catch (e) {}
    for (let n = 0; n < nuevos.length; n++) {
      const r = await modalNuevo(nuevos[n], n, nuevos.length, cats);
      if (!r) return false;
      items.filter((x) => !x.producto_id && clave(x) === clave(nuevos[n])).forEach((x) => {
        x.precio_venta = r.precio;
        x.categoria = r.categoria;
      });
      if (!cats.includes(r.categoria)) cats.push(r.categoria);
    }
    return true;
  }

  // ---------- Tabla ----------
  const estado = (i) =>
    i.producto_id
      ? conflicto(i)
        ? `<span class="ria-est w" title="El código existe con otro nombre">⚠ Revisar</span>`
        : `<span class="ria-est e" title="${esc(i.nombre_actual || "")}">Existe</span>`
      : `<span class="ria-est n">Nuevo</span>`;

  const aviso = (i) =>
    conflicto(i)
      ? `<span>El código <b>${esc(i.codigo)}</b> ya está en tu base como <b>«${esc(i.nombre_actual)}»</b>, pero el remito dice <b>«${esc(i.nombre)}»</b>.</span>
         <button type="button" data-ok>Es el mismo producto</button>
         <button type="button" data-cambiar>Cambiar código</button>`
      : "";

  function fila(i, k) {
    return `<div class="ria-item" data-k="${k}">
      <div class="ria-grid ria-cols">
        <span class="ria-e">${estado(i)}</span>
        <input data-f="codigo" value="${esc(i.codigo)}" placeholder="Código">
        <input data-f="nombre" value="${esc(i.nombre)}" placeholder="Descripción">
        <input data-f="cantidad" type="number" min="1" step="1" value="${i.cantidad}">
        <input data-f="costo" type="number" min="0" step="any" value="${i.costo}" placeholder="0">
        <b class="ria-sub">${fmt(sub(i))}</b>
        <button type="button" class="ria-x" data-del title="Quitar">✕</button>
      </div>
      <div class="ria-warn ${conflicto(i) ? "on" : ""}">${aviso(i)}</div>
    </div>`;
  }

  // Actualiza solo estado/aviso de una fila (sin tocar los inputs, para no perder el foco)
  function refrescarFila(k) {
    const el = document.querySelector(`#riaFilas [data-k="${k}"]`);
    if (!el) return;
    const i = items[k];
    el.querySelector(".ria-e").innerHTML = estado(i);
    const w = el.querySelector(".ria-warn");
    w.innerHTML = aviso(i);
    w.classList.toggle("on", !!conflicto(i));
    resumen();
  }

  function resumen() {
    const t = $("#riaTotal");
    if (!t) return;
    t.textContent = fmt(totalCent());
    const nuevos = items.filter((i) => !i.producto_id).length;
    const rev = items.filter(conflicto).length;
    $("#riaCuenta").textContent = `${items.length} línea(s) · ${nuevos} nuevo(s)${rev ? ` · ${rev} para revisar` : ""}`;
    const monto = cent($("#cpRMonto").value);
    const dif = monto - totalCent();
    $("#riaDif").textContent =
      monto > 0 && dif !== 0 ? `Monto del remito ${fmt(monto)} · diferencia con las líneas ${dif > 0 ? "+" : "−"}${fmt(Math.abs(dif))} (IVA, descuentos…)` : "";
  }

  function render() {
    $("#cpIA").innerHTML = items.length
      ? `<div class="ria-card">
          <div class="ria-grid ria-cols h"><span>Estado</span><span>Código</span><span>Descripción</span><span class="r">Cant.</span><span class="r">Costo u. $</span><span class="r">Subtotal</span><span></span></div>
          <div id="riaFilas">${items.map(fila).join("")}</div>
        </div>
        <div class="ria-pie">
          <button type="button" id="riaAdd">＋ Agregar línea</button>
          <span class="ria-tot"><span id="riaCuenta"></span> · Total de líneas: <b id="riaTotal"></b></span>
        </div>
        <p class="ria-dif" id="riaDif"></p>
        <p class="cp-hint">Revisá y corregí lo que haga falta. Al guardar, por cada producto "Nuevo" te voy a pedir precio de venta y categoría. El stock no se modifica.</p>`
      : `<div class="ria-vacio">
          <span>Todavía no hay líneas. Analizá la foto con IA o cargalas a mano.</span>
          <button type="button" id="riaAdd">＋ Agregar línea</button>
        </div>`;
    resumen();
  }

  let leyendo = false;
  const TXT_BOTON = "✨ Analizar con IA";
  const hayFoto = () => !!(window.__remitoHayFoto && window.__remitoHayFoto());

  async function leer() {
    if (leyendo) return;
    if (!hayFoto()) return toast("Primero adjuntá la foto del remito");
    if (items.some((i) => String(i.nombre || "").trim()) && !confirm("Ya hay líneas cargadas.\nSi analizás de nuevo, se reemplazan por lo que lea la IA.\n¿Seguir?")) return;
    const b = $("#riaLeer");
    leyendo = true;
    b.disabled = true;
    b.textContent = "Analizando remito…";
    try {
      const foto = await window.__remitoFotoIA(); // la nueva, o la ya guardada si se está editando
      if (!foto) throw new Error("No se pudo obtener la foto del remito");
      const r = await post("/compras/remitos/analizar", { imagenes: [foto] });
      const edit = !!(window.__remitoEditando && window.__remitoEditando());
      items = r.items;
      if (r.numero && !$("#cpRNum").value.trim()) $("#cpRNum").value = r.numero;
      if (r.fecha && !edit) $("#cpRFecha").value = r.fecha; // editando, no se pisa la fecha ya cargada
      if (!$("#cpRMonto").value) {
        const m = r.total > 0 ? r.total : totalCent() / 100;
        if (m > 0) $("#cpRMonto").value = m;
      }
      if (r.proveedor && !edit) {
        const q = r.proveedor.toLowerCase();
        const op = [...$("#cpRProv").options].find((o) => q.includes(o.text.toLowerCase()) || o.text.toLowerCase().includes(q));
        if (op) $("#cpRProv").value = op.value;
      }
      render();
      $("#cpRMonto").dispatchEvent(new Event("input")); // actualiza diferencias y la línea de deuda
      if (!items.length) toast("No se detectaron productos. Probá con una foto más nítida.");
    } catch (e) {
      toast(e.message || "No se pudo analizar el remito");
    } finally {
      leyendo = false;
      b.textContent = TXT_BOTON;
      b.disabled = !hayFoto();
    }
  }

  // Al salir del campo código: ¿ya existe en la base? ¿con el mismo nombre?
  async function verificar(k) {
    const i = items[k];
    const codigo = String(i.codigo || "").trim();
    try {
      const r = codigo
        ? await api(`/compras/remitos/codigo?codigo=${encodeURIComponent(codigo)}&nombre=${encodeURIComponent(i.nombre || "")}`)
        : { existe: false };
      if (items[k] !== i) return; // la fila cambió mientras tanto
      if (r.existe) {
        Object.assign(i, { producto_id: r.producto_id, codigo: r.codigo, nombre_actual: r.nombre_actual, stock_actual: r.stock_actual, coincide: r.coincide, confirmado: false });
      } else {
        Object.assign(i, { producto_id: null, nombre_actual: null, stock_actual: null, coincide: true, confirmado: false });
      }
      refrescarFila(k);
    } catch (e) {
      toast("No se pudo verificar el código: " + e.message);
    }
  }

  $("#cpIA").addEventListener("input", (e) => {
    const inp = e.target.closest("input[data-f]");
    if (!inp) return;
    const el = inp.closest("[data-k]");
    const i = items[Number(el.dataset.k)];
    i[inp.dataset.f] = inp.type === "number" ? num(inp.value) : inp.value;
    el.querySelector(".ria-sub").textContent = fmt(sub(i));
    resumen();
  });
  $("#cpRMonto").addEventListener("input", resumen);
  $("#riaLeer").addEventListener("click", leer);

  $("#cpIA").addEventListener("change", (e) => {
    if (e.target.dataset?.f !== "codigo") return;
    verificar(Number(e.target.closest("[data-k]").dataset.k));
  });

  $("#cpIA").addEventListener("click", (e) => {
    if (e.target.closest("#riaAdd")) {
      items.push({ producto_id: null, codigo: "", nombre: "", cantidad: 1, costo: 0, precio_venta: 0, categoria: "", coincide: true });
      return render();
    }
    const el = e.target.closest("[data-k]");
    if (!el) return;
    const k = Number(el.dataset.k);
    if (e.target.closest("[data-del]")) {
      items.splice(k, 1);
      return render();
    }
    if (e.target.closest("[data-ok]")) {
      items[k].confirmado = true;
      return refrescarFila(k);
    }
    if (e.target.closest("[data-cambiar]")) {
      const c = el.querySelector('[data-f="codigo"]');
      c.focus();
      c.select();
    }
  });

  window.RemitoIA = {
    reset() {
      items = [];
      render();
    },
    // Carga las líneas de un remito ya guardado (modo edición). Ya fueron revisadas: no marcan conflicto.
    cargar(lista) {
      items = (lista || []).map((i) => ({
        producto_id: i.producto_id || null,
        codigo: i.codigo || "",
        nombre: i.nombre || "",
        nombre_actual: i.nombre_actual || null,
        cantidad: i.cantidad,
        costo: i.costo,
        precio_venta: i.precio_venta || 0,
        categoria: "",
        coincide: true,
        confirmado: false,
      }));
      render();
    },
    totalCent,
    pedirNuevos,
    validar() {
      const sin = items.find((i) => i.nombre.trim() && !i.producto_id && !String(i.codigo).trim());
      if (sin) return `Falta el código del producto nuevo «${sin.nombre}»`;
      const dud = items.find(conflicto);
      return dud ? `Revisá el código ${dud.codigo}: ya existe en tu base con otro nombre` : "";
    },
    payload() {
      const validos = items.filter((i) => i.nombre.trim() && Math.round(num(i.cantidad)) >= 1);
      return {
        items: validos.map((i) => ({
          producto_id: i.producto_id || null,
          codigo: String(i.codigo || "").trim(),
          nombre: i.nombre.trim(),
          cantidad: Math.round(num(i.cantidad)),
          costo: cent(i.costo),
          precio_venta: i.producto_id ? 0 : cent(i.precio_venta),
          categoria: i.producto_id ? "" : String(i.categoria || ""),
        })),
      };
    },
  };
  render();
})();