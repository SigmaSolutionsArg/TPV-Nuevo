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