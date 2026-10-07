// ==========================================================
// TPV · empleados.js  (Admin > Empleados)
// ==========================================================
(() => {
  let empleados = [];
  let eF = { q: "", vista: "activos" };
  let editId = null;
  let mapa, marcador;
  let latlng = null;
  
  const DIAS = [
    { k: "lunes", n: "Lun" }, { k: "martes", n: "Mar" }, { k: "miercoles", n: "Mié" },
    { k: "jueves", n: "Jue" }, { k: "viernes", n: "Vie" }, { k: "sabado", n: "Sáb" }, { k: "domingo", n: "Dom" }
  ];
  let horarios = {}; 
  let diaActivo = "lunes"; // Controla qué día se está viendo en el panel

  const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  window.SECCIONES_ADMIN = window.SECCIONES_ADMIN || {};
  window.SECCIONES_ADMIN.empleados = { icono: "👥", titulo: "Empleados", desc: "Personal y accesos" };
  const oldAbrir = window.abrirSeccionAdmin;
  window.abrirSeccionAdmin = (c) => {
    if (c === "empleados") { nav("admin-empleados"); return eIniciar(); }
    if (oldAbrir) oldAbrir(c);
  };

  function eFiltrados() {
    const q = norm(eF.q);
    return empleados.filter(e => {
      if (eF.vista === "activos" && !e.activo) return false;
      if (eF.vista === "inactivos" && e.activo) return false;
      return !q || [e.nombre, e.telefono, e.direccion].some(x => norm(x).includes(q));
    });
  }

  function eRender() {
    const lista = eFiltrados();
    const countTurnos = (hStr) => {
      try { const h = JSON.parse(hStr); return Object.values(h).flat().length; } catch { return 0; }
    };

    $("#empBody").innerHTML = lista.length ? lista.map(e => `
      <div class="pr-row ${e.activo ? '' : 'off'}">
        <span class="pr-nom">${esc(e.nombre)}${e.activo ? '' : '<em class="pr-tag">Inactivo</em>'}</span>
        <span class="pr-cat-t">${esc(e.telefono || "—")}</span>
        <span class="pr-cat-t" title="${esc(e.direccion)}">${esc(e.direccion || "—")} ${e.lat ? '📍' : ''}</span>
        <span class="pr-precio r">${e.sueldo ? fmt(e.sueldo) : "—"}</span>
        <span class="pr-cat-t" style="text-align:center;">${countTurnos(e.horarios)} turnos</span>
        <span class="pr-acc">
          <button class="pr-ic" data-edit="${e.id}" title="Editar">✏️</button>
          ${e.activo 
            ? `<button class="pr-ic del" data-del="${e.id}" title="Desactivar">🗑</button>` 
            : `<button class="pr-ic res" data-res="${e.id}" title="Reactivar">♻️</button>`}
        </span>
      </div>
    `).join("") : `<div class="pr-vacio"><b>👥</b><span>No hay empleados.</span></div>`;

    $("#empSub").textContent = `${lista.length} empleados ${eF.vista}`;
  }

  async function eCargar() {
    try {
      empleados = await api(`/empleados?incluir_inactivos=true`);
      eRender();
    } catch (err) { toast(err.message); }
  }

  function eIniciar() {
    eF.q = ""; $("#empBuscar").value = "";
    eCargar();
  }

  // ==========================================================
  // BUSCADOR DE DIRECCIÓN EN EL MAPA (Geocoding)
  // ==========================================================
  async function buscarEnMapa() {
    const direccion = $("#eDir").value.trim();
    if (!direccion) return toast("Escribí una dirección para buscar");
    
    // Le agregamos ", Argentina" internamente para que OpenStreetMap no se vaya a otro país
    const query = encodeURIComponent(direccion + ", Argentina");
    try {
      const btn = $("#eBuscarDir");
      btn.textContent = "⌛";
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${query}&limit=1`);
      const data = await res.json();
      
      if (data && data.length > 0) {
        latlng = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
        if (marcador) mapa.removeLayer(marcador);
        marcador = L.marker(latlng).addTo(mapa);
        mapa.setView(latlng, 15);
      } else {
        toast("No se encontró la dirección exacta. Probá agregando la ciudad.");
      }
      btn.textContent = "🔍";
    } catch (e) {
      toast("Error al buscar la dirección en el mapa");
      $("#eBuscarDir").textContent = "🔍";
    }
  }

  $("#eBuscarDir").addEventListener("click", buscarEnMapa);
  $("#eDir").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      buscarEnMapa();
    }
  });

  function initMapa() {
    if (!mapa) {
      mapa = L.map('eMapa').setView([-34.8628, -57.8875], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
      }).addTo(mapa);
      
      mapa.on('click', function(e) {
        latlng = e.latlng;
        if (marcador) mapa.removeLayer(marcador);
        marcador = L.marker(latlng).addTo(mapa);
      });
    }
    
    if (marcador) { mapa.removeLayer(marcador); marcador = null; }
    
    setTimeout(() => {
      mapa.invalidateSize();
      if (latlng) {
        marcador = L.marker(latlng).addTo(mapa);
        mapa.setView(latlng, 15);
      } else {
        mapa.setView([-34.8628, -57.8875], 13);
      }
    }, 150);
  }

  // ==========================================================
  // RENDER DE TABS DE HORARIOS (Selector y Panel)
  // ==========================================================
  function renderNavDias() {
    const nav = $("#eDiasNav");
    nav.innerHTML = DIAS.map(d => {
      const turnos = horarios[d.k] || [];
      const isActivo = d.k === diaActivo;
      const tieneHorarios = turnos.length > 0;
      
      let bg = "transparent", color = "var(--mut)", border = "var(--line)";
      if (isActivo) {
        bg = "var(--acc)"; color = "#fff"; border = "var(--acc)";
      } else if (tieneHorarios) {
        bg = "var(--acc-soft)"; color = "var(--acc-txt)"; border = "var(--acc-soft)";
      }
      
      return `<button type="button" data-seldia="${d.k}" style="flex:1; padding:10px 0; border:2px solid ${border}; background:${bg}; color:${color}; font-weight:700; border-radius:14px; transition:all 0.2s;">
        ${d.n}
      </button>`;
    }).join("");
  }

  function renderPanelDia() {
    const d = DIAS.find(x => x.k === diaActivo);
    const turnos = horarios[d.k] || [];
    
    const htmlTurnos = turnos.length ? turnos.map((t, i) => `
      <div style="display:flex; align-items:center; gap:12px; margin-top:12px; background:var(--card); padding:12px 18px; border-radius:16px; border:1px solid var(--line);">
        <input type="time" data-hk="${d.k}" data-hi="${i}" data-f="in" value="${t.in}" style="flex:1; background:var(--bg); border:none; text-align:center; font-size:16px; font-weight:700;">
        <span style="color:var(--mut); font-weight:700;">a</span>
        <input type="time" data-hk="${d.k}" data-hi="${i}" data-f="out" value="${t.out}" style="flex:1; background:var(--bg); border:none; text-align:center; font-size:16px; font-weight:700;">
        <button type="button" data-hdia="${d.k}" data-hi="${i}" style="width:46px; height:46px; padding:0; background:var(--rose); color:var(--rose-t); border-radius:12px; display:grid; place-content:center; font-size:18px;" title="Borrar franja">✕</button>
      </div>
    `).join("") : `<div style="text-align:center; color:var(--mut); padding:32px; font-weight:600; font-size:15px; border:2px dashed var(--line); border-radius:16px; margin-top:12px;">Día franco (Sin turnos)</div>`;

    $("#eDiaPanel").innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h4 style="margin:0; font-size:20px; color:var(--txt);">Turnos del ${d.n}</h4>
        <button type="button" data-hadd="${d.k}" class="go" style="padding:10px 20px; font-size:14px; border-radius:12px;">＋ Agregar Franja</button>
      </div>
      <div style="margin-top:8px;">
        ${htmlTurnos}
      </div>
    `;
  }

  function actualizarHorariosUI() {
    renderNavDias();
    renderPanelDia();
  }

  $("#eHorariosBox").addEventListener("click", (e) => {
    const bSel = e.target.closest("[data-seldia]");
    const bAdd = e.target.closest("[data-hadd]");
    const bDel = e.target.closest("[data-hdia]");
    
    if (bSel) {
      diaActivo = bSel.dataset.seldia;
      actualizarHorariosUI();
    }
    if (bAdd) {
      const dia = bAdd.dataset.hadd;
      if (!horarios[dia]) horarios[dia] = [];
      horarios[dia].push({ in: "09:00", out: "17:00" });
      actualizarHorariosUI();
    }
    if (bDel) {
      const dia = bDel.dataset.hdia;
      const idx = Number(bDel.dataset.hi);
      horarios[dia].splice(idx, 1);
      actualizarHorariosUI();
    }
  });

  // Guardado en vivo del cambio de hora
  $("#eHorariosBox").addEventListener("change", (e) => {
    if (e.target.tagName === "INPUT" && e.target.type === "time") {
      const dia = e.target.dataset.hk;
      const idx = Number(e.target.dataset.hi);
      const campo = e.target.dataset.f; 
      if (!horarios[dia]) horarios[dia] = [];
      if (horarios[dia][idx]) horarios[dia][idx][campo] = e.target.value;
    }
  });

  $("#empCopiarLV").addEventListener("click", () => {
    const turnosLunes = horarios["lunes"] || [];
    if (turnosLunes.length === 0) {
      if (!confirm("El Lunes no tiene turnos. ¿Borrar también los turnos de Martes a Viernes?")) return;
    }
    
    const copia = JSON.stringify(turnosLunes);
    ["martes", "miercoles", "jueves", "viernes"].forEach(dia => {
      horarios[dia] = JSON.parse(copia);
    });
    
    toast("Horarios copiados hasta el viernes");
    actualizarHorariosUI();
  });


  // ==========================================================
  // FORMULARIO PRINCIPAL
  // ==========================================================
  function eAbrirForm(e = null) {
    editId = e ? e.id : null;
    $("#empTit").textContent = e ? "Editar empleado" : "Nuevo empleado";
    $("#eNombre").value = e ? e.nombre : "";
    $("#eTel").value = e ? e.telefono : "";
    $("#eDir").value = e ? e.direccion : "";
    $("#eSueldo").value = (e && e.sueldo) ? e.sueldo / 100 : "";
    
    latlng = (e && e.lat && e.lng) ? { lat: e.lat, lng: e.lng } : null;
    
    try { horarios = e ? JSON.parse(e.horarios) : {}; } catch { horarios = {}; }
    diaActivo = "lunes"; // Reset tab
    actualizarHorariosUI();
    
    $("#empErr").textContent = "";
    abrir("#mEmpleado");
    initMapa();
    setTimeout(() => $("#eNombre").focus(), 100);
  }

  async function eGuardar() {
    const body = {
      nombre: $("#eNombre").value.trim(),
      telefono: $("#eTel").value.trim(),
      direccion: $("#eDir").value.trim(),
      sueldo: $("#eSueldo").value ? Math.round(Number($("#eSueldo").value) * 100) : null,
      lat: latlng ? latlng.lat : null,
      lng: latlng ? latlng.lng : null,
      horarios: JSON.stringify(horarios)
    };

    if (!body.nombre) return $("#empErr").textContent = "El nombre es obligatorio.";

    $("#empGuardar").disabled = true;
    try {
      if (editId) await api(`/empleados/${editId}`, { method: "PUT", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body) });
      else await post("/empleados", body);
      cerrar("#mEmpleado");
      mostrarExito({ titulo: "Empleado guardado", sub: esc(body.nombre), duracion: 1500 });
      eCargar();
    } catch (err) { $("#empErr").textContent = err.message; }
    finally { $("#empGuardar").disabled = false; }
  }

  $("#empBuscar").addEventListener("input", e => { eF.q = e.target.value; eRender(); });
  $("#empVista").addEventListener("change", e => { eF.vista = e.target.value; eRender(); });
  $("#empNuevo").addEventListener("click", () => eAbrirForm());
  $("#empCancel").addEventListener("click", () => cerrar("#mEmpleado"));
  $("#empGuardar").addEventListener("click", eGuardar);

  $("#empBody").addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const emp = empleados.find(x => String(x.id) === (b.dataset.edit || b.dataset.del || b.dataset.res));
    if (!emp) return;

    if (b.dataset.edit) eAbrirForm(emp);
    if (b.dataset.del || b.dataset.res) {
      const activar = !!b.dataset.res;
      if (!activar && !confirm(`¿Desactivar a ${emp.nombre}?`)) return;
      try {
        if (activar) {
          await api(`/empleados/${emp.id}`, { method: "PUT", headers: {"Content-Type": "application/json"}, body: JSON.stringify({ nombre: emp.nombre, activo: true }) });
        } else {
          await api(`/empleados/${emp.id}`, { method: "DELETE" });
        }
        toast(activar ? "Empleado reactivado" : "Empleado desactivado");
        eCargar();
      } catch (err) { toast(err.message); }
    }
  });
})();