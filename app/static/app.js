// ==========================================================
// TPV · app.js
// Índice:
//   1. Configuración y utilidades
//   2. Interfaz: tema, reloj, red y navegación
//   3. Pop-up de éxito (reutilizable)
//   4. Tiempo real (WebSocket de la caja)
//   5. Mostrador: estado, búsqueda, carrito, producto rápido, ticket
//   6. Caja: pendientes, cobro, vuelto, anulación
//   7. Eventos: mostrador, caja y teclado global
//   8. Inicio
//   9. Estadísticas (dashboard de ventas)
// ==========================================================


// ==========================================================
// 1. CONFIGURACIÓN Y UTILIDADES
// ==========================================================
const AUTO_IMPRIMIR = true;
const CLAVE_ADMIN = "1234";

const METODOS = {
    efectivo: "Efectivo",
    mercado_pago: "Mercado Pago",
    transferencia: "Transferencia",
    debito: "Débito",
    credito: "Crédito",
    cuenta_corriente: "Cuenta corriente",
};



const $ = (s) => document.querySelector(s);
const fmt = (c) =>
    new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(c / 100);
const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const abrir = (id) => {
    const m = $(id);
    clearTimeout(m._tCierre); // si estaba cerrándose, se cancela
    m.classList.remove("cerrando");
    m.classList.add("abierto");
};
const cerrar = (id) => {
    const m = $(id);
    if (!m.classList.contains("abierto") || m.classList.contains("cerrando")) return;
    m.classList.add("cerrando"); // fade de salida; después se oculta de verdad
    m._tCierre = setTimeout(() => m.classList.remove("abierto", "cerrando"), 170);
};

// El toast queda solo para errores y avisos (no para éxitos)
let toastT;
function toast(t) {
    const el = $("#toast");
    el.textContent = t;
    el.classList.add("on");
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.remove("on"), 2800);
}

async function api(url, opts) {
    const r = await fetch(url, opts);
    const data = await r.json().catch(() => null);
    if (!r.ok) {
        let msg = data && data.detail;
        if (Array.isArray(msg)) msg = msg.map((e) => e.msg).join(", ");
        throw new Error(msg || "Error " + r.status);
    }
    return data;
}

const post = (url, body) =>
    api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// Devuelve el foco al campo principal de la vista que esté abierta
function enfocarVistaActual() {
    const enCaja = $("#view-caja").style.display === "flex";
    const campo = enCaja ? $("#scanTicket") : $("#buscar");
    if (campo) campo.focus();
}


// ==========================================================
// 2. INTERFAZ: TEMA, RELOJ, RED Y NAVEGACIÓN
// ==========================================================

// ---------- Tema claro / oscuro ----------
function aplicarTema(t) {
    document.documentElement.dataset.theme = t;
    document.querySelectorAll(".theme").forEach((btn) => (btn.textContent = t === "dark" ? "☀️️" : "🌙"));
    try { localStorage.setItem("tema", t); } catch (e) { }
}

// ---------- Reloj ----------
function hora() {
    const t = new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
    document.querySelectorAll(".reloj").forEach((el) => (el.textContent = t));
}

// ---------- Estado de conexión ----------
function red() {
    const on = navigator.onLine;
    document.querySelectorAll(".dot").forEach((el) => el.classList.toggle("off", !on));
    document.querySelectorAll(".lbl-net").forEach((el) => (el.textContent = on ? "En línea" : "Sin conexión"));
}

// ---------- Navegación entre vistas ----------
let adminAuth = false; // true mientras el administrador esté dentro de su panel

function nav(vista) {
    // Las vistas de administración exigen haber puesto la contraseña
    if (vista.startsWith("admin") && !adminAuth) vista = "login-admin";
    // Al salir hacia cualquier otro módulo se cierra la sesión de admin
    if (["home", "venta", "caja"].includes(vista)) adminAuth = false;

    document.querySelectorAll(".view").forEach((v) => (v.style.display = "none"));
    document.getElementById(`view-${vista}`).style.display = "flex";

    if (vista === "login-admin") {
        $("#adminPwd").value = "";
        $("#adminErr").textContent = "";
        setTimeout(() => $("#adminPwd").focus(), 50);
    }
    if (vista === "venta") $("#buscar").focus();
    if (vista === "caja") {
        cargarPendientes();
        $("#scanTicket").focus();
        conectarWebSocketCaja();
    }
}

// ---------- Administrador ----------
// El botón del home lleva a la pantalla de login
function pedirAdmin() {
    nav("login-admin");
}

function entrarAdmin() {
    if ($("#adminPwd").value === CLAVE_ADMIN) {
        adminAuth = true;
        nav("admin");
        return;
    }
    // Contraseña incorrecta: mensaje y sacudida de la tarjeta
    $("#adminErr").textContent = "Contraseña incorrecta";
    $("#adminPwd").value = "";
    $("#adminPwd").focus();
    const card = $("#loginCard");
    card.classList.remove("shake");
    void card.offsetWidth; // reinicia la animación
    card.classList.add("shake");
}

// Secciones del panel de administración. Para sumar una nueva:
// agregá su botón en #view-admin y su entrada acá.
const SECCIONES_ADMIN = {
    empleados: { icono: "👥", titulo: "Empleados", desc: "Personal y accesos" },
    productos: { icono: "📦", titulo: "Productos", desc: "Catálogo, precios y stock" },
    stats: { icono: "📊", titulo: "Estadísticas", desc: "Ventas y tiempos de cobro" },
    compras: { icono: "🛒", titulo: "Compras", desc: "Proveedores y remitos" },
};

function abrirSeccionAdmin(clave) {
    const s = SECCIONES_ADMIN[clave];
    if (!s) return;
    if (clave === "stats") {
        nav("admin-stats");
        iniciarStats();
        return;
    }
    if (clave === "productos") {
        nav("admin-productos");
        iniciarProductos();
        return;
    }
    if (clave === "compras") {
        nav("admin-compras");
        return;
    }
    $("#secIcono").textContent = s.icono;
    $("#secTitulo").textContent = s.titulo;
    $("#secDesc").textContent = s.desc;
    nav("admin-sec");
}


// ==========================================================
// 3. POP-UP DE ÉXITO (REUTILIZABLE)
// ==========================================================
// Uso:
//   mostrarExito({
//     titulo: "¡Cobro exitoso!",     // obligatorio
//     sub: "Ticket #12 · Efectivo",  // opcional (acepta HTML ya escapado)
//     monto: "$1.500",               // opcional, número grande
//     fila: { label: "Vuelto", valor: "$500" }, // opcional
//     tipo: "ok" | "anulado",        // opcional, por defecto "ok"
//     duracion: 2400,                // ms hasta cerrarse solo
//     confetti: true,                // por defecto true en "ok"
//   });
let exitoT;

const ICONOS_EXITO = {
    ok: '<path d="M34 56L49 71L77 40" />',
    anulado: '<path d="M40 40L70 70M70 40L40 70" />',
};

function mostrarExito({ titulo, sub = "", monto = "", fila = null, tipo = "ok", duracion = 2400, confetti = tipo === "ok" }) {
    const card = $("#exCard");
    card.classList.toggle("anulado", tipo === "anulado");

    $("#exIcono").innerHTML = `<svg viewBox="0 0 110 110"><circle cx="55" cy="55" r="48" />${ICONOS_EXITO[tipo] || ICONOS_EXITO.ok}</svg>`;
    $("#exTitulo").textContent = titulo;

    $("#exSub").innerHTML = sub;
    $("#exSub").style.display = sub ? "block" : "none";

    $("#exMonto").textContent = monto;
    $("#exMonto").style.display = monto ? "block" : "none";

    $("#exFila").style.display = fila ? "flex" : "none";
    if (fila) {
        $("#exFilaLabel").textContent = fila.label;
        $("#exFilaValor").textContent = fila.valor;
    }

    const colores = ["var(--acc)", "var(--cta)", "var(--peach-t)", "var(--rose-t)", "var(--mint-t)"];
    $("#exConfetti").innerHTML = confetti
        ? Array.from(
            { length: 18 },
            (_, i) =>
                `<i style="--x:${Math.round(Math.random() * 320 - 160)}px;--y:${Math.round(Math.random() * -70 - 70)}px;` +
                `--r:${Math.round(Math.random() * 720 - 360)}deg;--d:${(Math.random() * 0.25).toFixed(2)}s;` +
                `background:${colores[i % colores.length]}"></i>`
        ).join("")
        : "";

    // Se recrea la barra para que su animación arranque de cero cada vez
    $("#exBar").innerHTML = `<i style="animation-duration:${duracion}ms"></i>`;

    abrir("#mExito");
    clearTimeout(exitoT);
    exitoT = setTimeout(cerrarExito, duracion);
}

function cerrarExito() {
    clearTimeout(exitoT);
    cerrar("#mExito");
    enfocarVistaActual();
}


// ==========================================================
// 4. TIEMPO REAL (WEBSOCKET DE LA CAJA)
// ==========================================================
let wsCaja = null;

function conectarWebSocketCaja() {
    if (wsCaja && wsCaja.readyState !== WebSocket.CLOSED) return;

    const protocolo = window.location.protocol === "https:" ? "wss:" : "ws:";
    wsCaja = new WebSocket(`${protocolo}//${window.location.host}/ventas/ws/caja`);

    wsCaja.onmessage = (event) => {
        if (event.data !== "update_caja") return;
        // Si el cajero está cobrando, no le recargamos la lista para no molestarlo
        if (!$("#mCobro").classList.contains("abierto")) cargarPendientes(true);
    };

    // Si se cae, reintenta a los 3 segundos
    wsCaja.onclose = () => setTimeout(conectarWebSocketCaja, 3000);
}


// ==========================================================
// 5. MOSTRADOR (GENERAR PEDIDOS)
// ==========================================================

// ---------- Estado ----------
let carrito = [];
let sug = [];
let idx = 0;
let timer;
let ticketId = null;
let rapidoSeq = 0; // numera los productos rápidos del carrito (R1, R2, ...)

const totalCarrito = () => carrito.reduce((s, i) => s + i.precio * i.cantidad, 0);

// ---------- Búsqueda de productos ----------
async function buscar() {
    const q = $("#buscar").value.trim();
    if (!q) {
        sug = [];
        return renderSug();
    }
    sug = await api("/productos?q=" + encodeURIComponent(q));
    idx = 0;
    renderSug();
}

function renderSug() {
    const box = $("#sug");
    if (!$("#buscar").value.trim()) return box.classList.remove("on");
    box.classList.add("on");
    box.innerHTML = sug.length
        ? sug
            .map(
                (p, i) => `<button class="s ${i === idx ? "sel" : ""}" data-i="${i}">
        <div class="n">${esc(p.nombre)}<small>${esc(p.codigo)}</small></div>
        <span class="st ${p.stock <= 0 ? "low" : ""}">stock ${p.stock}</span>
        <span class="p">${fmt(p.precio)}</span></button>`
            )
            .join("")
        : '<div style="padding:16px;color:var(--mut)">Sin resultados</div>';
}

function elegir(p) {
    agregar(p);
    $("#buscar").value = "";
    sug = [];
    renderSug();
    $("#buscar").focus();
}

// ---------- Carrito ----------
function agregar(p, cantidad = 1) {
    const l = carrito.find((i) => i.id === p.id);
    if (l) l.cantidad += cantidad;
    else carrito.push({ id: p.id, nombre: p.nombre, precio: p.precio, cantidad });
    renderCarrito();
}

function renderCarrito() {
    $("#carrito").innerHTML = carrito.length
        ? carrito
            .map(
                (i) => `<div class="cols linea">
        <div class="nm" title="${esc(i.nombre)}">${esc(i.nombre)}</div>
        <div class="pu">${fmt(i.precio)}</div>
        <div class="qty"><button data-a="menos" data-id="${i.id}">−</button><b>${i.cantidad}</b><button data-a="mas" data-id="${i.id}">+</button></div>
        <div class="sub">${fmt(i.precio * i.cantidad)}</div>
        <button class="x" data-a="quitar" data-id="${i.id}">✕</button>
      </div>`
            )
            .join("")
        : '<div class="vacio"><b>🧺</b><span>Escaneá o buscá un producto para empezar</span></div>';
    $("#total").textContent = fmt(totalCarrito());
    $("#items").textContent = carrito.reduce((s, i) => s + i.cantidad, 0);
}

function vaciar(confirmar = true) {
    if (confirmar && carrito.length && !confirm("¿Vaciar el carrito?")) return;
    carrito = [];
    renderCarrito();
    $("#buscar").focus();
}

// ---------- Producto rápido ----------
// No se crea en el catálogo: viaja en el carrito y el servidor lo registra
// bajo el producto "RAPIDO" con el nombre y precio escritos acá.
function abrirRapido() {
    ["#rNombre", "#rPrecio"].forEach((s) => ($(s).value = ""));
    $("#rCant").value = 1;
    $("#errRapido").textContent = "";
    abrir("#mRapido");
    $("#rNombre").focus();
}

function guardarRapido() {
    const nombre = $("#rNombre").value.trim();
    const cantidad = parseInt($("#rCant").value, 10);
    const precioPesos = Number($("#rPrecio").value);

    if (!nombre) return ($("#errRapido").textContent = "Poné un nombre");
    if (!(cantidad > 0)) return ($("#errRapido").textContent = "La cantidad tiene que ser mayor a 0");
    if ($("#rPrecio").value === "" || precioPesos < 0) return ($("#errRapido").textContent = "Poné un precio");

    carrito.push({
        id: "R" + ++rapidoSeq,
        rapido: true,
        nombre,
        precio: Math.round(precioPesos * 100),
        cantidad,
    });
    renderCarrito();
    cerrar("#mRapido");
    $("#buscar").focus();
}

// ---------- Generar ticket ----------
async function imprimirTicket(id) {
    if (!id) return;
    try {
        await post("/imprimir/ticket/" + id, {});
    } catch (err) {
        toast("No se pudo imprimir: " + err.message);
    }
}

// Paso 1: F9 o botón "Generar ticket" solo abre la confirmación
function intentarGenerarTicket() {
    if (!carrito.length) return toast("El carrito está vacío");
    $("#confTotal").textContent = fmt(totalCarrito());
    abrir("#mConfirmar");
    $("#btnConfirmarPedido").focus();
}

// Paso 2: al confirmar se guarda en la BD, se imprime y se muestra el éxito
async function confirmarPedido() {
    $("#btnConfirmarPedido").disabled = true;
    const totalPedido = totalCarrito();
    try {
        const res = await post("/ventas", {
            items: carrito.map((i) =>
                i.rapido
                    ? { rapido: true, nombre: i.nombre, precio: i.precio, cantidad: i.cantidad }
                    : { producto_id: i.id, cantidad: i.cantidad }
            ),
        });
        ticketId = res.venta.id;

        cerrar("#mConfirmar");
        carrito = [];
        renderCarrito();

        mostrarExito({
            titulo: "¡Ticket generado!",
            sub: `Ticket <b>#${ticketId}</b>`,
            monto: fmt(totalPedido),
            duracion: 1800,
        });

        if (AUTO_IMPRIMIR) imprimirTicket(ticketId);
    } catch (err) {
        toast(err.message);
    } finally {
        $("#btnConfirmarPedido").disabled = false;
    }
}


// ==========================================================
// 6. CAJA (COBROS)
// ==========================================================

// ---------- Estado ----------
let pendientesActivos = [];
let cobroActual = { id: 0, total: 0, metodo: null };
let cuentasCobro = []; // cuentas corrientes activas, para el medio de pago "Cuenta corriente"

// ---------- Lista de tickets pendientes ----------
async function cargarPendientes(silencioso = false) {
    try {
        pendientesActivos = await api("/ventas?estado=pendiente");
        const grid = $("#grid-pendientes");
        $("#contadorPendientes").textContent = pendientesActivos.length;

        if (pendientesActivos.length === 0) {
            grid.innerHTML = `
        <div class="vacio" style="grid-column: 1/-1; margin-top: 60px;">
          <b style="font-size:56px; opacity:0.8;">🙌</b>
          <span style="font-size:20px; font-weight:600; color:var(--txt);">Todo al día</span>
          <span style="font-size:15px;">No hay tickets pendientes de cobro.</span>
        </div>`;
            return;
        }

        grid.innerHTML = pendientesActivos
            .map(
                (v) => `
      <div class="card act" onclick="abrirCobro(${v.id})" style="flex-direction:column; align-items:flex-start; cursor:pointer; padding:20px; border:2px solid transparent; transition:all 0.2s; position:relative; overflow:hidden;">
        <div style="position:absolute; top:0; left:0; width:6px; height:100%; background:var(--rose);"></div>
        <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
          <b style="font-size:18px; color:var(--txt);">Ticket #${v.id}</b>
          <span style="background:var(--bg); color:var(--mut); padding:4px 8px; border-radius:8px; font-size:13px; font-weight:600;">
            ${new Date(v.fecha).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
        <div style="font-size:32px; font-weight:800; color:var(--acc-txt); margin-top:16px; font-variant-numeric:tabular-nums;">
          ${fmt(v.total)}
        </div>
        <div style="margin-top:12px; width:100%; color:var(--acc); font-size:14px; font-weight:600; text-align:right;">
          Cobrar ➔
        </div>
      </div>`
            )
            .join("");
    } catch (e) {
        if (!silencioso) toast("Error cargando pendientes: " + e.message);
    }
}

// ---------- Abrir el cobro de un ticket ----------
async function abrirCobro(ventaId) {
    try {
        const detalle = await api(`/ventas/${ventaId}`);
        cobroActual = { id: detalle.venta.id, total: detalle.venta.total, metodo: null };

        $("#cobroTkId").textContent = "#" + cobroActual.id;
        $("#cobroTkTotal").textContent = fmt(cobroActual.total);

        $("#zonaMonto").style.display = "none";
        $("#zonaCuenta").style.display = "none";
        $("#montoIngresado").value = "";
        $("#txtVuelto").textContent = "$0";
        $("#btnConfirmarCobro").textContent = "✅ Confirmar";

        document.querySelectorAll("#metodosPago button").forEach((b) => {
            b.style.border = "none";
            b.style.opacity = "1";
        });

        $("#mCobro .box").classList.remove("con-lado");
        abrir("#mCobro");
    } catch (e) {
        toast("No se pudo cargar el ticket");
    }
}

// ---------- Método de pago ----------
function seleccionarMetodo(metodo) {
    cobroActual.metodo = metodo;

    document.querySelectorAll("#metodosPago button").forEach((b) => {
        b.style.border = "none";
        b.style.opacity = "0.5";
    });
    event.currentTarget.style.border = "2px solid var(--acc)";
    event.currentTarget.style.opacity = "1";

    $("#zonaCuenta").style.display = "none";
    if (metodo === "efectivo") {
        $("#zonaMonto").style.display = "flex";
        $("#btnConfirmarCobro").textContent = "✅ Confirmar Cobro";
        calcularBotonesVuelto(cobroActual.total / 100);
        setTimeout(() => $("#montoIngresado").focus(), 200);
    } else if (metodo === "cuenta_corriente") {
        $("#zonaMonto").style.display = "none";
        $("#btnConfirmarCobro").textContent = "✅ Confirmar";
        cargarCuentasCobro();
    } else {
        $("#zonaMonto").style.display = "none";
        $("#btnConfirmarCobro").textContent = "✅ Confirmar";
    }

    // Efectivo y cuenta corriente muestran el panel lateral a la derecha
    $("#mCobro .box").classList.toggle("con-lado", metodo === "efectivo" || metodo === "cuenta_corriente");
}

// ---------- Cuenta corriente: elegir a qué cuenta se carga ----------
// ---------- Cuenta corriente: elegir a qué cuenta se carga ----------
let cuentaDetToken = 0; // descarta respuestas viejas si el cajero cambia de cuenta rápido

async function cargarCuentasCobro() {
    const sel = $("#cuentaSel");
    $("#zonaCuenta").style.display = "flex";
    $("#cuentaInfo").textContent = "";
    $("#cuentaHist").innerHTML = "";
    $("#cuentaResumen").innerHTML = "";
    sel.innerHTML = '<option value="">Cargando cuentas…</option>';
    try {
        const cuentas = await api("/cuentas?activas=true");
        if (cobroActual.metodo !== "cuenta_corriente") return; // cambió de medio mientras cargaba
        cuentasCobro = cuentas;
        if (!cuentas.length) {
            sel.innerHTML = '<option value="">No hay cuentas activas</option>';
            $("#cuentaInfo").innerHTML = "Abrí una en <b>Administración › Cuentas corrientes</b>.";
            return;
        }
        sel.innerHTML =
            '<option value="">Elegí una cuenta…</option>' +
            cuentas
                .map((c) => `<option value="${c.id}">${esc(c.nombre)} · ${c.saldo > 0 ? "debe " + fmt(c.saldo) : "al día"}</option>`)
                .join("");
        setTimeout(() => sel.focus(), 100);
    } catch (e) {
        sel.innerHTML = '<option value="">No se pudieron cargar</option>';
        toast("Error cargando cuentas: " + e.message);
    }
}

// Al elegir una cuenta: historial reciente + cómo quedaría la deuda con este ticket
async function actualizarInfoCuenta() {
    const id = Number($("#cuentaSel").value);
    const hist = $("#cuentaHist");
    const res = $("#cuentaResumen");
    const token = ++cuentaDetToken;

    if (!id) {
        hist.innerHTML = "";
        res.innerHTML = "";
        return;
    }
    hist.innerHTML = '<div class="cc-h-vacio">Cargando historial…</div>';
    res.innerHTML = "";

    try {
        const d = await api(`/cuentas/${id}`);
        if (token !== cuentaDetToken || cobroActual.metodo !== "cuenta_corriente") return;

        const fecha = (iso) => new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
        const movs = d.movimientos.filter((m) => !m.anulada).slice(0, 5);

        const filas = movs.map((m) => {
            const venta = m.tipo === "venta";
            return `<div class="cc-h-row">
                <span class="f">${fecha(m.fecha)}</span>
                <span class="c"><b>${venta ? "Ticket #" + m.venta_id : "Pago"}</b>
                    <small>${venta ? "Venta a cuenta" : esc(METODOS[m.metodo] || m.metodo || "")}</small></span>
                <span class="m ${venta ? "mas" : "menos"}">${venta ? "+" : "−"} ${fmt(m.monto)}</span>
            </div>`;
        });
        if (d.deuda_inicial > 0 && movs.length < 5) {
            filas.push(`<div class="cc-h-row">
                <span class="f">${fecha(d.created_at)}</span>
                <span class="c"><b>Deuda inicial</b><small>Al abrir la cuenta</small></span>
                <span class="m mas">+ ${fmt(d.deuda_inicial)}</span>
            </div>`);
        }

        hist.innerHTML = filas.length
            ? `<div class="cc-h-tit">Últimos movimientos</div>${filas.join("")}`
            : '<div class="cc-h-vacio">Esta cuenta todavía no tiene movimientos.</div>';

        const quedaria = d.saldo + cobroActual.total;
        res.innerHTML = `
            <div><span>${d.saldo < 0 ? "Saldo a favor" : "Debe hoy"}</span><b>${fmt(Math.abs(d.saldo))}</b></div>
            <div><span>Este ticket</span><b>+ ${fmt(cobroActual.total)}</b></div>
            <div class="fin ${quedaria <= 0 ? "ok" : ""}"><span>Quedaría debiendo</span><b>${fmt(Math.max(0, quedaria))}</b></div>`;
    } catch (e) {
        if (token === cuentaDetToken) hist.innerHTML = '<div class="cc-h-vacio">No se pudo cargar el historial.</div>';
    }
}

// ---------- Calculador de vuelto ----------
function calcularBotonesVuelto(totalPesos) {
    const montos = [];
    for (const paso of [100, 500, 1000, 5000]) {
        const m = Math.ceil(totalPesos / paso) * paso;
        if (m > totalPesos && !montos.includes(m)) montos.push(m);
    }

    $("#botonesVuelto").innerHTML = montos
        .map(
            (m) =>
                `<button style="background:var(--card); color:var(--txt); font-weight:600; padding:10px; font-size:16px;"
      onclick="$('#montoIngresado').value=${m}; actualizarVuelto();">$${m}</button>`
        )
        .join("");
}

function actualizarVuelto() {
    const inputVal = Number($("#montoIngresado").value);
    if (!inputVal || inputVal <= 0) {
        $("#txtVuelto").textContent = "$0";
        return;
    }
    const vuelto = inputVal * 100 - cobroActual.total;
    $("#txtVuelto").textContent = vuelto > 0 ? fmt(vuelto) : "$0";
}

// ---------- Confirmar el cobro ----------
async function confirmarCobro() {
    if (!cobroActual.metodo) return toast("Elegí un método de pago");

    let pagado = cobroActual.total;
    if (cobroActual.metodo === "efectivo" && $("#montoIngresado").value) {
        pagado = Number($("#montoIngresado").value) * 100;
        if (pagado < cobroActual.total) return toast("El pago ingresado es insuficiente");
    }

    const cuerpo = { pagos: [{ metodo: cobroActual.metodo, monto: pagado }] };
    let cuentaNombre = "";
    if (cobroActual.metodo === "cuenta_corriente") {
        const cuentaId = Number($("#cuentaSel").value);
        if (!cuentaId) return toast("Elegí la cuenta corriente del cliente");
        cuerpo.cuenta_id = cuentaId;
        cuentaNombre = (cuentasCobro.find((c) => c.id === cuentaId) || {}).nombre || "";
    }

    try {
        $("#btnConfirmarCobro").disabled = true;
        const res = await post(`/caja/cobrar/${cobroActual.id}`, cuerpo);

        const { id, total, metodo } = cobroActual;
        cerrar("#mCobro");
        mostrarExito({
            titulo: cuentaNombre ? "Cargado a cuenta" : "¡Cobro exitoso!",
            sub: `Ticket <b>#${id}</b> · ${esc(METODOS[metodo] || metodo)}${cuentaNombre ? " · " + esc(cuentaNombre) : ""}`,
            monto: fmt(total),
            fila: res.vuelto > 0 ? { label: "Vuelto", valor: fmt(res.vuelto) } : null,
            duracion: 2400,
        });
        cargarPendientes();
    } catch (e) {
        toast(e.message || "Error al cobrar");
    } finally {
        $("#btnConfirmarCobro").disabled = false;
    }
}

// ---------- Anular el ticket desde la caja ----------
async function anularCobroActivo() {
    if (!cobroActual.id) return;

    const id = cobroActual.id;
    if (!confirm(`¿Seguro que querés ANULAR el Ticket #${id}?\n\nLos productos van a volver al stock y el ticket se cancelará.`)) {
        return;
    }

    try {
        await post(`/ventas/${id}/anular`, {});
        cerrar("#mCobro");
        mostrarExito({
            tipo: "anulado",
            titulo: "Ticket anulado",
            sub: `Ticket <b>#${id}</b> · stock devuelto`,
            duracion: 1800,
        });
        cargarPendientes();
    } catch (e) {
        toast(e.message || "Error al anular ticket");
    }
}


// ==========================================================
// 7. EVENTOS
// ==========================================================

// ---------- Pistola lectora (mostrador y caja) ----------
// La pistola escribe como un teclado muy rápido y termina con Enter.
// 1) Si el foco no está en el campo de escaneo, el primer carácter lo redirige ahí.
// 2) Se mide la velocidad de tipeo para distinguir un escaneo de alguien escribiendo.
const scanBuf = { t0: 0, tLast: 0, n: 0 };

document.addEventListener(
    "keydown",
    (e) => {
        if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) return;
        const ahora = performance.now();
        if (ahora - scanBuf.tLast > 120) {
            scanBuf.t0 = ahora;
            scanBuf.n = 0;
        }
        scanBuf.tLast = ahora;
        scanBuf.n++;
    },
    true
);

// ¿Lo último que se escribió llegó a velocidad de pistola?
function vinoDePistola() {
    if (performance.now() - scanBuf.tLast > 400 || scanBuf.n < 4) return false;
    return (scanBuf.tLast - scanBuf.t0) / (scanBuf.n - 1) < 50; // ms por carácter
}

function campoDeEscaneo() {
    if ($("#view-venta").style.display === "flex") return $("#buscar");
    if ($("#view-caja").style.display === "flex") return $("#scanTicket");
    return null;
}

document.addEventListener("keydown", (e) => {
    if (e.key.length !== 1 || e.key === " " || e.ctrlKey || e.altKey || e.metaKey) return;
    const campo = campoDeEscaneo();
    if (!campo || document.activeElement === campo) return;

    // Si el cajero está escribiendo en otro campo (nombre, monto, clave...), no se toca
    const a = document.activeElement;
    if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable)) return;

    // El cartel de éxito no debe frenar el siguiente escaneo; cualquier otro modal sí
    const modal = document.querySelector(".modal.abierto");
    if (modal) {
        if (modal.id !== "mExito") return;
        cerrarExito();
    }
    campo.focus(); // el carácter que disparó este evento cae dentro del campo
});

// ---------- Mostrador: buscador ----------
$("#sug").addEventListener("mousedown", (e) => {
    e.preventDefault();
    const b = e.target.closest(".s");
    if (b) elegir(sug[b.dataset.i]);
});

$("#buscar").addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => buscar().catch((e) => toast(e.message)), 150);
});
$("#buscar").addEventListener("blur", () => $("#sug").classList.remove("on"));
$("#buscar").addEventListener("focus", renderSug);
$("#buscar").addEventListener("keydown", async (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!sug.length) return;
        idx = (idx + (e.key === "ArrowDown" ? 1 : -1) + sug.length) % sug.length;
        return renderSug();
    }
    if (e.key !== "Enter") return;
    e.preventDefault();
    clearTimeout(timer);
    const pistola = vinoDePistola(); // se mide antes de esperar al servidor
    try {
        await buscar();
        const bruto = $("#buscar").value.trim();
        const exacto = sug.find((x) => x.codigo.toLowerCase() === bruto.toLowerCase());
        // Escribiendo a mano se acepta la primera sugerencia; con pistola solo el código exacto
        const p = exacto || (pistola ? null : sug[idx]);
        if (p) return elegir(p);
        if (pistola) {
            $("#buscar").value = ""; // para que el próximo escaneo no se pegue a este
            sug = [];
            renderSug();
            toast(`Código ${bruto} no encontrado`);
        } else {
            toast("No se encontró el producto");
        }
    } catch (err) {
        toast(err.message);
    }
});

// ---------- Mostrador: carrito y botones ----------
// Los IDs se comparan como texto porque los rápidos son "R1", "R2", ...
$("#carrito").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const id = b.dataset.id;
    const l = carrito.find((i) => String(i.id) === id);
    if (!l) return;
    if (b.dataset.a === "mas") l.cantidad++;
    if (b.dataset.a === "menos") l.cantidad--;
    if (b.dataset.a === "quitar" || l.cantidad <= 0) carrito = carrito.filter((i) => String(i.id) !== id);
    renderCarrito();
});

$("#btnVaciar").addEventListener("click", () => vaciar());
$("#btnRapido").addEventListener("click", abrirRapido);
$("#btnTicket").addEventListener("click", intentarGenerarTicket);
$("#btnTicket2").addEventListener("click", intentarGenerarTicket);
$("#btnConfirmarPedido").addEventListener("click", confirmarPedido);

// ---------- Mostrador: producto rápido ----------
$("#rGuardar").addEventListener("click", guardarRapido);
$("#rCerrar").addEventListener("click", () => {
    cerrar("#mRapido");
    $("#buscar").focus();
});
$("#mRapido").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        guardarRapido();
    }
});

// ---------- Administrador: login ----------
$("#adminPwd").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        entrarAdmin();
    }
});

// ---------- Caja: lector de código de barras ----------
$("#scanTicket").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const texto = e.target.value.trim();
    const id = parseInt(texto.replace(/\D/g, ""));
    e.target.value = ""; // se limpia siempre, para que el próximo escaneo no se pegue
    if (id) abrirCobro(id);
    else if (texto) toast("Código de ticket no válido");
});

// ---------- Caja: cobro ----------
$("#montoIngresado").addEventListener("input", actualizarVuelto);
$("#btnConfirmarCobro").addEventListener("click", confirmarCobro);
$("#cuentaSel").addEventListener("change", actualizarInfoCuenta);

// ---------- Teclado global ----------
document.addEventListener("keydown", (e) => {
    if (e.key === "F2") {
        e.preventDefault();
        $("#buscar").focus();
    }
    if (e.key === "F4") {
        e.preventDefault();
        abrirRapido();
    }
    if (e.key === "F9") {
        e.preventDefault();
        intentarGenerarTicket();
    }
    if (e.key === "Escape") {
        const m = document.querySelector(".modal.abierto");
        if (m && m.id === "mExito") {
            cerrarExito();
        } else if (m) {
            cerrar(`#${m.id}`);
            $("#buscar").focus();
        } else {
            $("#buscar").value = "";
            sug = [];
            renderSug();
        }
    }
});

// ---------- Inputs numéricos: sin flechas del teclado ni rueda del mouse ----------
document.addEventListener(
    "keydown",
    (e) => {
        if ((e.key === "ArrowUp" || e.key === "ArrowDown") && e.target.type === "number") e.preventDefault();
    },
    true
);
document.addEventListener(
    "wheel",
    () => {
        const a = document.activeElement;
        if (a && a.type === "number") a.blur();
    },
    { passive: true }
);


// ==========================================================
// TPV · stats.js  (Estadísticas para mayorista: foco en unidades)
// Se carga DESPUÉS de app.js y usa sus helpers: $, api, fmt, esc, toast, METODOS
// ==========================================================
let stRango = "30";
let stMetrica = "unidades"; // unidades | tickets | monto  (gráfico principal)
let stTop = "unidades"; // unidades | monto               (ranking)
let stCat = null; // categoría filtrada en el ranking
let stDatos = null;
let stCharts = {}; // id -> config, para redibujar al cambiar el tamaño

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MESES_LARGO = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const DIAS_CORTO = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const DIAS_LARGO = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const PALETA = ["var(--acc)", "var(--mint-t)", "var(--peach-t)", "var(--rose-t)", "#5b9bc4", "#c9a24a", "#8a6fb5", "#6fae9a", "var(--mut)"];

// ---------- Utilidades ----------
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fechaDe = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
};
const fmtFecha = (iso) => {
    const d = fechaDe(iso);
    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
};
const fmtN = (n) => new Intl.NumberFormat("es-AR").format(Math.round(n));
const fmtDec = (n) => (n == null ? "—" : new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(n));

function rangoPreset(r) {
    const hoy = new Date();
    let desde = new Date(hoy);
    if (r === "7") desde.setDate(hoy.getDate() - 6);
    else if (r === "30") desde.setDate(hoy.getDate() - 29);
    else if (r === "mes") desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    else if (r === "anio") desde = new Date(hoy.getFullYear(), 0, 1);
    return [isoLocal(desde), isoLocal(hoy)];
}

const corto = (n, suf) => n.toFixed(n >= 10 ? 0 : 1).replace(".", ",").replace(/,0$/, "") + suf;
function fmtCortoN(n) {
    if (n >= 1e6) return corto(n / 1e6, "M");
    if (n >= 1e3) return corto(n / 1e3, "k");
    return String(Math.round(n * 10) / 10).replace(".", ",");
}
const fmtCorto = (centavos) => "$" + fmtCortoN(centavos / 100); // $1,2M · $45k · $850

function fmtDur(seg) {
    if (seg == null) return "—";
    seg = Math.round(seg);
    if (seg < 60) return seg + " s";
    const m = Math.floor(seg / 60);
    if (m < 60) return seg % 60 ? `${m} min ${seg % 60} s` : `${m} min`;
    return `${Math.floor(m / 60)} h ${m % 60} min`;
}

// Tope "redondo" para el eje Y
function techo(max) {
    if (max <= 0) return 1;
    const mag = 10 ** Math.floor(Math.log10(max));
    for (const f of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) if (f * mag >= max) return f * mag;
    return 10 * mag;
}

function deltaHTML(actual, previo) {
    if (!previo) return actual ? '<span class="delta flat">Sin período previo</span>' : "";
    const p = ((actual - previo) / previo) * 100;
    const cls = p > 0.5 ? "up" : p < -0.5 ? "down" : "flat";
    const ic = p > 0.5 ? "▲" : p < -0.5 ? "▼" : "•";
    return `<span class="delta ${cls}">${ic} ${Math.abs(p).toFixed(0)}%</span>`;
}

// ---------- Gráfico SVG (área suave o barras), ocupa todo su contenedor ----------
// config: { datos:[{label, valor, tip}], tipo:"area"|"barras", fmtY }
function dibujarChart(el, cfg) {
    const { datos, tipo = "area", fmtY = fmtCortoN } = cfg;
    const W = el.clientWidth, H = el.clientHeight;
    if (W < 60 || H < 90 || !datos.length) return;

    const m = { l: 46, r: 14, t: 14, b: 28 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b, n = datos.length;
    const maxV = Math.max(...datos.map((d) => d.valor), 0);
    const tope = techo(maxV);
    const paso = iw / n;
    const x = (i) => (tipo === "barras" ? m.l + (i + 0.5) * paso : m.l + (n === 1 ? iw / 2 : (i * iw) / (n - 1)));
    const y = (v) => m.t + ih - (v / tope) * ih;
    const base = m.t + ih;

    let svg = `<svg width="${W}" height="${H}"><defs><linearGradient id="g-${el.id}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="var(--acc)" stop-opacity=".42"/><stop offset="1" stop-color="var(--acc)" stop-opacity="0"/></linearGradient></defs>`;

    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
        const yy = y(tope * f);
        svg += `<line class="gl ${f ? "" : "base"}" x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}"/>
      <text x="${m.l - 8}" y="${yy + 4}" text-anchor="end">${f ? fmtY(tope * f) : "0"}</text>`;
    }
    const cada = Math.ceil(n / Math.max(1, Math.floor(iw / 56)));
    datos.forEach((d, i) => {
        if (i % cada === 0) svg += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${d.label}</text>`;
    });

    if (tipo === "barras") {
        const bw = Math.min(paso * 0.66, 56);
        const iMax = maxV > 0 ? datos.findIndex((d) => d.valor === maxV) : -1;
        svg += `<rect class="hl" y="${m.t}" height="${ih}" width="${paso}" rx="8" opacity="0"/>`;
        svg += datos
            .map((d, i) => {
                const h = Math.max(base - y(d.valor), d.valor > 0 ? 2 : 0);
                return `<rect class="bar ${i === iMax ? "mx" : ""}" x="${x(i) - bw / 2}" y="${base - h}" width="${bw}" height="${h}" rx="${Math.min(7, bw / 2)}" style="animation-delay:${Math.min(i * 12, 300)}ms"/>`;
            })
            .join("");
    } else {
        let linea = `M${x(0)},${y(datos[0].valor)}`;
        for (let i = 1; i < n; i++) {
            const mx = (x(i - 1) + x(i)) / 2;
            linea += ` C${mx},${y(datos[i - 1].valor)} ${mx},${y(datos[i].valor)} ${x(i)},${y(datos[i].valor)}`;
        }
        svg += `<path class="area" d="${linea} L${x(n - 1)},${base} L${x(0)},${base} Z" fill="url(#g-${el.id})"/>`;
        svg += `<path class="line" d="${linea}"/>`;
        if (n <= 31) svg += datos.map((d, i) => `<circle class="dt" cx="${x(i)}" cy="${y(d.valor)}" r="3.2"/>`).join("");
        svg += `<line class="gd" y1="${m.t}" y2="${base}" opacity="0"/><circle class="gp" r="6" opacity="0"/>`;
    }
    el.innerHTML = svg + `</svg><div class="ct"></div>`;

    // ----- Interacción -----
    const tip = el.querySelector(".ct"), gd = el.querySelector(".gd"), gp = el.querySelector(".gp"), hl = el.querySelector(".hl");
    el.onmousemove = (e) => {
        const px = e.clientX - el.getBoundingClientRect().left;
        let i = tipo === "barras" ? Math.floor((px - m.l) / paso) : Math.round(((px - m.l) / iw) * (n - 1));
        i = Math.max(0, Math.min(n - 1, i));
        const d = datos[i];
        tip.innerHTML = d.tip;
        tip.style.opacity = 1;
        const tw = tip.offsetWidth, th = tip.offsetHeight;
        tip.style.left = Math.max(0, Math.min(x(i) - tw / 2, W - tw)) + "px";
        tip.style.top = Math.max(0, y(d.valor) - th - 14) + "px";
        if (gd) {
            gd.setAttribute("x1", x(i)); gd.setAttribute("x2", x(i)); gd.setAttribute("opacity", 1);
            gp.setAttribute("cx", x(i)); gp.setAttribute("cy", y(d.valor)); gp.setAttribute("opacity", 1);
        }
        if (hl) { hl.setAttribute("x", x(i) - paso / 2); hl.setAttribute("opacity", 1); }
    };
    el.onmouseleave = () => {
        tip.style.opacity = 0;
        [gd, gp, hl].forEach((e) => e && e.setAttribute("opacity", 0));
    };
}

function pintarCharts() {
    for (const [id, cfg] of Object.entries(stCharts)) {
        const el = document.getElementById(id);
        if (el) dibujarChart(el, cfg);
    }
}

let stResizeT;
addEventListener("resize", () => {
    clearTimeout(stResizeT);
    stResizeT = setTimeout(() => {
        if ($("#view-admin-stats").style.display === "flex") pintarCharts();
    }, 120);
});

// ---------- Piezas ----------
const cab = (titulo, sub, extra = "") => `<div class="dh"><div><h3>${titulo}</h3><small>${sub}</small></div>${extra}</div>`;
const vacio = (t) => `<div class="vacio-c">${t}</div>`;

function barrasRango(rangos, color = "var(--mint-t)") {
    const max = Math.max(...rangos.map((r) => r.cantidad), 1);
    return rangos
        .map((r) => `<div class="rg"><span>${r.label}</span><div class="tr"><i style="--w:${((r.cantidad / max) * 100).toFixed(1)}%;background:${color}"></i></div><em>${r.cantidad}</em></div>`)
        .join("");
}

function chartDonut(metodos) {
    const total = metodos.reduce((s, m) => s + m.monto, 0);
    if (!total) return vacio("Todavía no hay cobros en este período.");
    const R = 52, C = 2 * Math.PI * R;
    let off = 0;
    const arcos = metodos
        .map((m, i) => {
            const largo = (m.monto / total) * C, trazo = Math.max(largo - 2, 0.1);
            const el = `<circle cx="70" cy="70" r="${R}" fill="none" stroke-width="20" style="stroke:${PALETA[i % PALETA.length]}" stroke-dasharray="${trazo} ${C - trazo}" stroke-dashoffset="${-off}"/>`;
            off += largo;
            return el;
        })
        .join("");
    const leyenda = metodos
        .map((m, i) => `<div><span class="sw" style="background:${PALETA[i % PALETA.length]}"></span><span class="n">${esc(METODOS[m.metodo] || m.metodo)}</span><b>${fmt(m.monto)}</b><em>${Math.round((m.monto / total) * 100)}%</em></div>`)
        .join("");
    return `<div class="pay"><svg class="donut" viewBox="0 0 140 140"><g transform="rotate(-90 70 70)">${arcos}</g>
    <text x="70" y="72">${fmtCorto(total)}</text><text class="s" x="70" y="88">cobrado</text></svg><div class="leg">${leyenda}</div></div>`;
}

// ---------- Hero: serie en el tiempo (unidades / tickets / facturación) ----------
function datosHero(d, m) {
    const val = (o) => (m === "unidades" ? o.unidades : m === "tickets" ? o.tickets : o.total);
    const f = (v) => (m === "monto" ? fmt(v) : `${fmtN(v)} ${m === "unidades" ? "u." : "tickets"}`);
    const tip = (t, o) => `<b>${t}</b><span>${f(val(o))}</span>${m !== "unidades" ? "" : `<span>${o.tickets} tickets</span>`}`;

    if (d.dias === 1)
        return { tipo: "barras", datos: d.horas.map((o, h) => ({ label: h + "h", valor: val(o), tip: tip(`${h}:00 a ${h + 1}:00`, o) })) };

    if (d.serie.length <= 62)
        return {
            tipo: "area",
            datos: d.serie.map((o) => {
                const fe = fechaDe(o.fecha);
                return { label: `${fe.getDate()}/${fe.getMonth() + 1}`, valor: val(o), tip: tip(`${DIAS_CORTO[(fe.getDay() + 6) % 7]} ${fe.getDate()} ${MESES[fe.getMonth()]}`, o) };
            }),
        };

    const semanas = [];
    for (let i = 0; i < d.serie.length; i += 7) {
        const tr = d.serie.slice(i, i + 7), fe = fechaDe(tr[0].fecha);
        const o = { unidades: 0, tickets: 0, total: 0 };
        tr.forEach((s) => { o.unidades += s.unidades; o.tickets += s.tickets; o.total += s.total; });
        semanas.push({ label: `${fe.getDate()}/${fe.getMonth() + 1}`, valor: val(o), tip: tip(`Semana del ${fe.getDate()} ${MESES[fe.getMonth()]}`, o) });
    }
    return { tipo: "area", datos: semanas };
}

function heroInner(d) {
    const k = d.kpis, m = stMetrica;
    const actual = m === "unidades" ? k.unidades : m === "tickets" ? k.ventas : k.total;
    const previo = m === "unidades" ? k.unidades_anterior : m === "tickets" ? k.ventas_anterior : k.total_anterior;
    const f = (v) => (m === "monto" ? fmt(v) : fmtN(v));
    const h = datosHero(d, m);
    stCharts.hero = { ...h, fmtY: m === "monto" ? fmtCorto : fmtCortoN };
    const unidad = { unidades: "unidades", tickets: "tickets", monto: "facturados" }[m];
    const seg = [["unidades", "Unidades"], ["tickets", "Tickets"], ["monto", "Facturación"]]
        .map(([v, t]) => `<button data-met="${v}" class="${m === v ? "on" : ""}">${t}</button>`).join("");

    return `${cab("Evolución de ventas", d.dias === 1 ? "Por hora" : d.serie.length <= 62 ? "Día por día" : "Semana por semana", `<div class="seg">${seg}</div>`)}
    <div class="hero-n"><span class="big">${f(actual)}</span><span class="unit">${unidad}</span>${deltaHTML(actual, previo)}</div>
    <div class="hero-sub">${previo ? `Período anterior: ${f(previo)}` : "Sin ventas en el período anterior para comparar"}</div>
    <div class="cv" id="hero"></div>`;
}

// ---------- KPIs ----------
function kpisInner(d) {
    const k = d.kpis;
    const fila = (v, t, extra = "") => `<div class="mrow"><div class="mv"><b>${v}</b>${extra}</div><span>${t}</span></div>`;
    const aviso = k.anuladas || k.pendientes ? ` · ${k.anuladas} anulados · ${k.pendientes} pendientes` : "";
    return (
        fila(fmtN(k.ventas), "Tickets cobrados" + aviso, deltaHTML(k.ventas, k.ventas_anterior)) +
        fila(fmtDec(k.unidades_por_ticket), "Unidades por ticket", "") +
        fila(fmt(k.total), "Facturación", deltaHTML(k.total, k.total_anterior)) +
        fila(fmtN(k.productos_distintos), "Productos distintos vendidos")
    );
}

// ---------- Categorías ----------
function catsInner(d) {
    const cats = d.categorias;
    const total = cats.reduce((s, c) => s + c.unidades, 0);
    const cabecera = cab("Ventas por categoría", stCat ? `Filtrando el ranking por <b>${esc(stCat)}</b> · tocá de nuevo para quitar` : "Tocá una categoría para filtrar el ranking");
    if (!total) return cabecera + vacio("Cuando haya ventas cobradas, acá aparecen las categorías.");

    const barra = cats.map((c, i) => `<i style="flex:${c.unidades};background:${PALETA[i % PALETA.length]}" title="${esc(c.categoria)}"></i>`).join("");
    const filas = cats
        .map((c, i) => `<button class="cat ${stCat === c.categoria ? "on" : ""} ${stCat && stCat !== c.categoria ? "dim" : ""}" data-cat="${esc(c.categoria)}">
      <span class="sw" style="background:${PALETA[i % PALETA.length]}"></span>
      <span class="cn"><b>${esc(c.categoria)}</b><small>${c.productos} productos · ${fmt(c.monto)}</small></span>
      <span class="cu"><b>${fmtN(c.unidades)} u.</b><small>${Math.round((c.unidades / total) * 100)}%</small></span>
      ${c.unidades_prev ? deltaHTML(c.unidades, c.unidades_prev) : '<span class="delta up">Nueva</span>'}
    </button>`).join("");
    return `${cabecera}<div class="sbar">${barra}</div><div class="cats">${filas}</div>`;
}

// ---------- Ranking de productos ----------
function rankingInner(d) {
    const porU = stTop === "unidades";
    const lista = d.productos
        .filter((p) => !stCat || p.categoria === stCat)
        .sort((a, b) => (porU ? b.unidades - a.unidades || b.monto - a.monto : b.monto - a.monto || b.unidades - a.unidades))
        .slice(0, 10);
    const seg = `<div class="seg"><button data-top="unidades" class="${porU ? "on" : ""}">Unidades</button><button data-top="monto" class="${porU ? "" : "on"}">Facturación</button></div>`;
    const cabecera = cab("Productos estrella", stCat ? esc(stCat) : "Todas las categorías", seg);
    if (!lista.length) return cabecera + vacio("No hay ventas para mostrar.");

    const met = (p) => (porU ? p.unidades : p.monto);
    const max = met(lista[0]) || 1;
    const filas = lista
        .map((p, i) => `<div class="rk ${i === 0 ? "first" : ""}" style="--w:${((met(p) / max) * 100).toFixed(1)}%">
      <span class="pos">${i + 1}</span>
      <span class="nom">${esc(p.nombre)}<small>${esc(p.categoria)} · en ${p.tickets} tickets</small></span>
      <span class="val">${porU ? fmtN(p.unidades) + " u." : fmt(p.monto)}<small>${porU ? fmt(p.monto) : fmtN(p.unidades) + " u."}</small></span>
      ${p.unidades_prev ? deltaHTML(p.unidades, p.unidades_prev) : '<span class="delta up">Nuevo</span>'}
    </div>`).join("");
    return cabecera + `<div class="rank">${filas}</div>`;
}

// ---------- Mapa de calor (día de la semana x hora) ----------
function heatmapInner(d) {
    const mapa = d.mapa;
    const porHora = Array.from({ length: 24 }, (_, h) => mapa.reduce((s, r) => s + r[h], 0));
    let h0 = porHora.findIndex((v) => v > 0), h1 = 23 - [...porHora].reverse().findIndex((v) => v > 0);
    if (h0 < 0) { h0 = 8; h1 = 20; }
    while (h1 - h0 < 7 && (h1 < 23 || h0 > 0)) (h1 < 23 ? h1++ : h0--);
    const max = Math.max(...mapa.flat(), 0);
    let pico = null;
    mapa.forEach((r, di) => r.forEach((v, h) => { if (v === max && max > 0 && !pico) pico = [di, h]; }));

    const cols = h1 - h0 + 1;
    let celdas = '<span></span>' + Array.from({ length: cols }, (_, i) => `<span class="hh">${h0 + i}h</span>`).join("");
    mapa.forEach((r, di) => {
        celdas += `<span class="hd">${DIAS_CORTO[di]}</span>`;
        for (let h = h0; h <= h1; h++) {
            const v = r[h];
            const bg = v ? `color-mix(in srgb, var(--acc) ${Math.max(14, Math.round((v / max) * 100))}%, var(--bg))` : "var(--bg)";
            celdas += `<span class="hc" style="background:${bg}" title="${DIAS_LARGO[di]} ${h}:00 · ${fmtN(v)} unidades"></span>`;
        }
    });
    const sub = pico ? `Pico: ${DIAS_LARGO[pico[0]]} ${pico[1]}:00 a ${pico[1] + 1}:00 · ${fmtN(max)} unidades` : "Unidades vendidas por día y hora";
    return `${cab("Cuándo se vende más", sub)}<div class="hm" style="grid-template-columns:36px repeat(${cols},minmax(0,1fr))">${celdas}</div>`;
}

function semanaInner(d) {
    const tot = d.mapa.map((r) => r.reduce((s, v) => s + v, 0));
    const max = Math.max(...tot, 0);
    const mejor = max > 0 ? tot.indexOf(max) : -1;
    stCharts.semana = {
        tipo: "barras",
        datos: tot.map((v, i) => ({ label: DIAS_CORTO[i], valor: v, tip: `<b>${DIAS_LARGO[i]}</b><span>${fmtN(v)} unidades</span>` })),
    };
    return `${cab("Por día de la semana", mejor >= 0 ? `Mejor día: ${DIAS_LARGO[mejor]}` : "Unidades por día")}<div class="cv" id="semana"></div>`;
}

// ---------- Tamaño de pedido ----------
function pedidoInner(p) {
    const c = cab("Tamaño de los pedidos", "Unidades que lleva cada ticket");
    if (!p.cantidad) return c + vacio("Todavía no hay pedidos cobrados.");
    return `${c}<div class="tc-n">${fmtDec(p.promedio)} <span class="unit">u. por pedido</span></div>
    <div class="tc-sub">Típico (mediana): ${fmtDec(p.mediana)} u. · el más grande: ${fmtN(p.maximo)} u.</div>
    <div class="rgs">${barrasRango(p.rangos, "var(--acc)")}</div>`;
}

// ---------- Tiempo de cobro ----------
function tiempoCobroInner(t) {
    const c = cab("Tiempo hasta el cobro", "Del ticket a la caja");
    if (!t.cantidad) return c + vacio("Todavía no hay cobros para medir.");
    return `${c}<div class="tc-n">${fmtDur(t.mediana)}</div><div class="tc-sub">Típico (mediana) · ${t.cantidad} tickets</div>
    <div class="tc-3"><div><b>${fmtDur(t.promedio)}</b><span>Promedio</span></div><div><b>${fmtDur(t.minimo)}</b><span>Más rápido</span></div><div><b>${fmtDur(t.maximo)}</b><span>Más lento</span></div></div>
    <div class="rgs">${barrasRango(t.rangos)}</div>`;
}

// ---------- Stock ----------
function riesgoInner(s) {
    const c = cab("Stock en riesgo", `Se acaba en ${s.dias_riesgo} días o menos, al ritmo del período`, s.riesgo_total ? `<span class="delta down">${s.riesgo_total}</span>` : "");
    if (!s.riesgo.length) return c + vacio("Ningún producto vendido está por quedarse sin stock. 👌");
    const filas = s.riesgo.map((r) => {
        const cls = r.dias < 3 ? "down" : r.dias < 7 ? "warn" : "up";
        const txt = r.stock <= 0 ? "Sin stock" : r.dias < 1 ? "Menos de 1 día" : `${fmtDec(r.dias)} días`;
        return `<div class="li"><span class="nom">${esc(r.nombre)}<small>${esc(r.categoria)} · vende ${fmtDec(r.ritmo)} u./día</small></span>
      <span class="val">${fmtN(r.stock)} u.<small>en stock</small></span><span class="delta ${cls}">${txt}</span></div>`;
    }).join("");
    return c + `<div class="lis">${filas}</div>`;
}

function paradosInner(s) {
    const c = cab("Sin movimiento", "Con stock pero sin ventas en el período", s.parados_total ? `<span class="delta flat">${s.parados_total}</span>` : "");
    if (!s.parados.length) return c + vacio("Todo el stock se está moviendo. 🎉");
    const filas = s.parados.map((r) => `<div class="li"><span class="nom">${esc(r.nombre)}<small>${esc(r.categoria)}</small></span>
    <span class="val">${fmtN(r.stock)} u.<small>parado</small></span></div>`).join("");
    return c + `<div class="lis">${filas}</div>`;
}

// ---------- Armado del dashboard ----------
function renderStats(d) {
    stCharts = {};
    $("#stRangoTxt").textContent = d.dias === 1 ? fmtFecha(d.desde) : `${fmtFecha(d.desde)} al ${fmtFecha(d.hasta)}`;

    const meses = d.meses.map((m) => {
        const [y, n] = m.mes.split("-").map(Number);
        return { label: MESES[n - 1], valor: m.unidades, tip: `<b>${MESES_LARGO[n - 1]} ${y}</b><span>${fmtN(m.unidades)} unidades</span><span>${m.tickets} tickets · ${fmt(m.total)}</span>` };
    });
    stCharts.meses = { tipo: "barras", datos: meses };

    $("#stDash").innerHTML = `
    <section class="card dc c8" id="stHero">${heroInner(d)}</section>
    <section class="card mini c4">${kpisInner(d)}</section>

    <section class="card dc c5" id="stCats">${catsInner(d)}</section>
    <section class="card dc c7" id="stProductos">${rankingInner(d)}</section>

    <section class="card dc c8">${heatmapInner(d)}</section>
    <section class="card dc c4">${semanaInner(d)}</section>

    <section class="card dc c4">${pedidoInner(d.pedido)}</section>
    <section class="card dc c4">${cab("Cómo pagan", "Facturación por método")}${chartDonut(d.metodos)}</section>
    <section class="card dc c4">${tiempoCobroInner(d.tiempo_cobro)}</section>

    <section class="card dc c6">${riesgoInner(d.stock)}</section>
    <section class="card dc c6">${paradosInner(d.stock)}</section>

    <section class="card dc c12">${cab("Unidades por mes", "Últimos 12 meses")}<div class="cv" id="meses"></div></section>`;
    pintarCharts();
}

// ---------- Carga ----------
async function cargarStats() {
    const desde = $("#stDesde").value, hasta = $("#stHasta").value;
    if (!desde || !hasta) return;
    const vista = $("#view-admin-stats");
    vista.classList.add("cargando");
    try {
        stDatos = await api(`/stats/dashboard?desde=${desde}&hasta=${hasta}`);
        if (stCat && !stDatos.categorias.some((c) => c.categoria === stCat)) stCat = null;
        renderStats(stDatos);
    } catch (e) {
        toast("No se pudieron cargar las estadísticas: " + e.message);
    } finally {
        vista.classList.remove("cargando");
    }
}

function setRangoStats(r) {
    stRango = r;
    document.querySelectorAll("#stChips .chip").forEach((c) => c.classList.toggle("on", c.dataset.r === r));
    if (r !== "custom") {
        const [d, h] = rangoPreset(r);
        $("#stDesde").value = d;
        $("#stHasta").value = h;
    }
    cargarStats();
}

function iniciarStats() {
    setRangoStats(stRango);
}

$("#stChips").addEventListener("click", (e) => {
    const c = e.target.closest(".chip");
    if (c) setRangoStats(c.dataset.r);
});
$("#stDesde").addEventListener("change", () => setRangoStats("custom"));
$("#stHasta").addEventListener("change", () => setRangoStats("custom"));
$("#stRefrescar").addEventListener("click", cargarStats);

// Interacciones del dashboard sin recargar datos
$("#stDash").addEventListener("click", (e) => {
    if (!stDatos) return;
    const met = e.target.closest("[data-met]");
    if (met) {
        stMetrica = met.dataset.met;
        $("#stHero").innerHTML = heroInner(stDatos);
        return pintarCharts();
    }
    const top = e.target.closest("[data-top]");
    if (top) {
        stTop = top.dataset.top;
        return ($("#stProductos").innerHTML = rankingInner(stDatos));
    }
    const cat = e.target.closest("[data-cat]");
    if (cat) {
        stCat = stCat === cat.dataset.cat ? null : cat.dataset.cat;
        $("#stCats").innerHTML = catsInner(stDatos);
        $("#stProductos").innerHTML = rankingInner(stDatos);
    }
});
// ==========================================================
// 8. INICIO
// ==========================================================
let temaInicial = "light";
try { temaInicial = localStorage.getItem("tema") || "light"; } catch (e) { }
aplicarTema(temaInicial);

setInterval(hora, 1000);
hora();

addEventListener("online", red);
addEventListener("offline", red);
red();

renderCarrito();