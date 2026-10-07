// ==========================================================
// TPV · gastos.js  (Admin > Gastos)
// ==========================================================
(() => {
  let gastos = [];
  let prevision = null;
  let gF = { q: "", tipo: "" };
  let editId = null;

  const hoyMes = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  const hoyStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const fechaFmt = (iso) => (iso ? iso.split("-").reverse().join("/") : "—");
  const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  // Enlazar al menú de admin
  const configAdmin = window.SECCIONES_ADMIN || {};
  configAdmin.gastos = { icono: "💸", titulo: "Gastos", desc: "Operativos y fijos" };
  const oldAbrir = window.abrirSeccionAdmin;
  window.abrirSeccionAdmin = (c) => {
    if (c === "gastos") { nav("admin-gastos"); return gsIniciar(); }
    if (oldAbrir) oldAbrir(c);
  };

  function gsFiltrados() {
    const q = norm(gF.q);
    return gastos.filter((g) => {
      if (gF.tipo && g.tipo !== gF.tipo) return false;
      return !q || [g.descripcion, g.categoria].some((x) => norm(x).includes(q));
    });
  }

  function gsRender() {
    const lista = gsFiltrados();
    const total = lista.reduce((s, g) => s + g.monto, 0);

    const cats = [...new Set(gastos.map((g) => g.categoria))].sort();
    $("#gsCats").innerHTML = cats.map((c) => `<option value="${esc(c)}">`).join("");

    $("#gsBody").innerHTML = lista.length ? lista.map((g) => {
      const isPer = g.tipo === "periodico";
      const lblPer = isPer && g.periodicidad ? ` (${g.periodicidad})` : "";
      return `<div class="pr-row">
        <span class="pr-cat-t">${fechaFmt(g.fecha)}</span>
        <span><em class="pr-tag" style="background:${isPer ? 'var(--mint)' : 'var(--bg)'};color:${isPer ? 'var(--mint-t)' : 'var(--mut)'}">${isPer ? 'Fijo' + lblPer : 'Unitario'}</em></span>
        <span class="pr-nom">${esc(g.descripcion)}</span>
        <span class="pr-precio r"><b>${fmt(g.monto)}</b></span>
        <span class="pr-cat-t">${esc(g.categoria)}</span>
        <span class="pr-acc">
          <button class="pr-ic" data-dup="${g.id}" title="Cargar nuevo pago de esto">➕</button>
          <button class="pr-ic" data-edit="${g.id}" title="Editar">✏️</button>
          <button class="pr-ic del" data-del="${g.id}" title="Borrar">🗑</button>
        </span>
      </div>`;
    }).join("") : `<div class="pr-vacio"><b>💸</b><span>No hay gastos en este mes o filtro.</span></div>`;

    $("#gsFoot").innerHTML = `<span>${lista.length} gastos en este mes</span><span>Total registrado: <b>${fmt(total)}</b></span>`;
    $("#gsSub").textContent = `Gastos de ${$("#gsMes").value.split("-").reverse().join("/")}`;
  }

  function gsRenderPrevision() {
    const box = $("#gsPrevisionBox");
    if (!prevision || prevision.proyeccion.length === 0) {
      box.style.display = "none";
      return;
    }
    
    const itemsHtml = prevision.proyeccion.slice(0, 5).map(p => 
      `<span style="background:var(--card); padding:4px 8px; border-radius:8px; font-size:13px; font-weight:600; color:var(--acc-txt); white-space:nowrap;">
        ${esc(p.descripcion)}: ${fmt(p.monto_mensual_estimado)}/mes
      </span>`
    ).join("");

    box.style.display = "block";
    box.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <h3 style="margin:0 0 6px; font-size:18px; color:var(--acc-txt);">🔮 Previsión de Gastos Fijos</h3>
          <p style="margin:0; font-size:14px; color:var(--acc-txt); opacity:0.8;">Carga mensual estimada basándonos en tus últimos pagos de alquiler, sueldos, servicios, etc.</p>
          <div style="display:flex; gap:8px; margin-top:12px; flex-wrap:wrap;">
            ${itemsHtml}
            ${prevision.proyeccion.length > 5 ? `<span style="font-size:13px; color:var(--acc-txt); opacity:0.8; align-self:center;">+ ${prevision.proyeccion.length - 5} más</span>` : ""}
          </div>
        </div>
        <div style="text-align:right; flex:none;">
          <small style="display:block; color:var(--acc-txt); opacity:0.8; font-weight:bold; text-transform:uppercase; font-size:12px;">Total Fijo Mensual</small>
          <b style="font-size:32px; font-weight:900; color:var(--acc-txt);">${fmt(prevision.total_mensual_estimado)}</b>
        </div>
      </div>
    `;
  }

  async function gsCargar() {
    try {
      const mes = $("#gsMes").value;
      const [dataGastos, dataPrev] = await Promise.all([
        api(`/gastos?mes=${mes}`),
        api(`/gastos/prevision`)
      ]);
      gastos = dataGastos;
      prevision = dataPrev;
      gsRender();
      gsRenderPrevision();
    } catch (e) { toast(e.message); }
  }

  function gsIniciar() {
    if (!$("#gsMes").value) $("#gsMes").value = hoyMes();
    $("#gsBuscar").value = ""; gF = { q: "", tipo: "" }; $("#gsTipo").value = "";
    gsCargar();
  }

  function gsAbrirForm(g = null, dup = false) {
    editId = g && !dup ? g.id : null;
    $("#gsTit").textContent = dup ? "Cargar nuevo pago" : (editId ? "Editar gasto" : "Registrar gasto");
    $("#gsFecha").value = g && !dup ? g.fecha : hoyStr();
    $("#gsTexto").value = g ? g.descripcion : "";
    $("#gsMonto").value = g ? g.monto / 100 : "";
    $("#gsCat").value = g ? g.categoria : "";
    
    const tipo = g ? g.tipo : "unitario";
    $("#gsSelectTipo").value = tipo;
    $("#gsPeriodicidad").value = (g && g.periodicidad) ? g.periodicidad : "mensual";
    $("#gsDivPer").style.display = tipo === "periodico" ? "block" : "none";
    
    $("#gsErr").textContent = "";
    abrir("#mGasto");
    setTimeout(() => $(dup ? "#gsMonto" : "#gsTexto").focus(), 50);
  }

  async function gsGuardar() {
    const err = (t) => ($("#gsErr").textContent = t);
    const tipoGasto = $("#gsSelectTipo").value;
    const body = {
      fecha: $("#gsFecha").value,
      descripcion: $("#gsTexto").value.trim(),
      monto: Math.round(Number($("#gsMonto").value) * 100),
      categoria: $("#gsCat").value.trim() || "Otros",
      tipo: tipoGasto,
      periodicidad: tipoGasto === "periodico" ? $("#gsPeriodicidad").value : null
    };

    if (!body.fecha) return err("Poné una fecha");
    if (!body.descripcion) return err("Escribí un concepto");
    if (!(body.monto > 0)) return err("El monto debe ser mayor a 0");

    $("#gsGuardar").disabled = true;
    err("");
    try {
      if (editId) await api(`/gastos/${editId}`, { method: "PUT", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body) });
      else await post("/gastos", body);
      cerrar("#mGasto");
      mostrarExito({ titulo: "Gasto guardado", sub: esc(body.descripcion), monto: fmt(body.monto), duracion: 1500 });
      gsCargar();
    } catch (e) { err(e.message); }
    finally { $("#gsGuardar").disabled = false; }
  }

  // Eventos
  $("#gsMes").addEventListener("change", gsCargar);
  $("#gsBuscar").addEventListener("input", (e) => { gF.q = e.target.value; gsRender(); });
  $("#gsTipo").addEventListener("change", (e) => { gF.tipo = e.target.value; gsRender(); });
  $("#gsNuevo").addEventListener("click", () => gsAbrirForm());
  $("#gsCancel").addEventListener("click", () => cerrar("#mGasto"));
  $("#gsGuardar").addEventListener("click", gsGuardar);
  
  $("#gsSelectTipo").addEventListener("change", (e) => {
    $("#gsDivPer").style.display = e.target.value === "periodico" ? "block" : "none";
  });

  $("#mGasto").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.tagName !== "BUTTON" && e.target.tagName !== "SELECT") { e.preventDefault(); gsGuardar(); }
  });

  $("#gsBody").addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const g = gastos.find(x => String(x.id) === (b.dataset.edit || b.dataset.dup || b.dataset.del));
    if (!g) return;

    if (b.dataset.edit) gsAbrirForm(g, false);
    if (b.dataset.dup) gsAbrirForm(g, true); // Cargar nuevo pago
    if (b.dataset.del) {
      if (!confirm(`¿Borrar el gasto "${g.descripcion}" por ${fmt(g.monto)}?`)) return;
      try {
        await api(`/gastos/${g.id}`, { method: "DELETE" });
        toast("Gasto borrado");
        gsCargar();
      } catch (err) { toast(err.message); }
    }
  });
})();