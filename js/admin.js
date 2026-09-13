/* Panel del administrador: resumen, tanqueos, recargas, vehículos, conductores */
(async function () {
  if (window.KE_SIN_CONFIG) return;
  const { $, $$, cfg, fmtCOP, fmtNum, fmtFecha, fmtFechaHora, mesDe, diaDe, hoyISO, nombreMes, aDatetimeLocal,
          escapeHtml, toast, requireAuth, logout, comprimirImagen, urlFoto, descargarCSV, mensajeError } = KE;

  const { perfil } = await requireAuth("admin");
  $("#userName").textContent = perfil.nombre;
  $("#btnLogout").addEventListener("click", logout);
  $("#btnRecargar").addEventListener("click", () => cargarTodo(true));

  const S = { perfiles: [], vehiculos: [], recargas: [], tanqueos: [], charts: {} };
  const nombreDe = (id) => (S.perfiles.find((p) => p.id === id) || {}).nombre || "—";
  const vehiculoDe = (placa) => S.vehiculos.find((v) => v.placa === placa) || {};
  const cuentaGasto = (t) => t.estado !== "rechazado";
  const conductores = () => S.perfiles.filter((p) => p.activo);

  // ============================================================
  //  Carga de datos
  // ============================================================
  async function cargarTodo(aviso = false) {
    const [p, v, r, t] = await Promise.all([
      sb.from("perfiles").select("*").order("nombre"),
      sb.from("vehiculos").select("*").order("placa"),
      sb.from("recargas").select("*").order("fecha", { ascending: false }).order("creado_en", { ascending: false }),
      sb.from("tanqueos").select("*").order("fecha_tanqueo", { ascending: false }),
    ]);
    const err = [p, v, r, t].find((x) => x.error);
    if (err) { toast(mensajeError(err.error), "error"); return; }
    S.perfiles = p.data; S.vehiculos = v.data; S.recargas = r.data; S.tanqueos = t.data;
    renderTodo();
    if (aviso) toast("Datos actualizados", "success");
  }

  function renderTodo() {
    renderResumen();
    llenarFiltros();
    renderTanqueos();
    renderRecargas();
    renderVehiculos();
    renderConductores();
    const pend = S.tanqueos.filter((t) => t.estado === "pendiente").length;
    const b = $("#badgePendientes"); b.textContent = pend; b.hidden = !pend;
  }

  // ============================================================
  //  Pestañas
  // ============================================================
  function mostrarTab(nombre) {
    $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === nombre));
    $$(".tab").forEach((s) => s.classList.toggle("active", s.id === `tab-${nombre}`));
    window.scrollTo(0, 0);
  }
  $("#tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) mostrarTab(b.dataset.tab); });
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-goto]"); if (b) mostrarTab(b.dataset.goto); });

  // ============================================================
  //  Modal genérico
  // ============================================================
  function abrirModal(html) {
    const root = $("#modalRoot");
    root.innerHTML = `<div class="modal-backdrop"><div class="modal">${html}</div></div>`;
    root.querySelector(".modal-backdrop").addEventListener("click", (e) => { if (e.target.classList.contains("modal-backdrop")) cerrarModal(); });
    root.querySelectorAll("[data-cerrar]").forEach((b) => b.addEventListener("click", cerrarModal));
    document.body.style.overflow = "hidden";
    return root.querySelector(".modal");
  }
  function cerrarModal() { $("#modalRoot").innerHTML = ""; document.body.style.overflow = ""; }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") cerrarModal(); });

  const opciones = (lista, sel, vacio) =>
    (vacio ? `<option value="">${vacio}</option>` : "") +
    lista.map((o) => `<option value="${escapeHtml(o.value)}" ${String(o.value) === String(sel ?? "") ? "selected" : ""}>${escapeHtml(o.label)}</option>`).join("");
  const opcPlacas = (sel) => opciones(S.vehiculos.map((v) => ({ value: v.placa, label: `${v.placa} · ${v.marca_modelo}` })), sel);
  const opcConductores = (sel, vacio) => opciones(conductores().map((p) => ({ value: p.id, label: p.nombre })), sel, vacio);
  const opcTipos = (sel) => opciones(cfg.TIPOS_COMBUSTIBLE.map((t) => ({ value: t, label: t })), sel);

  // ============================================================
  //  RESUMEN
  // ============================================================
  function renderResumen() {
    const hoy = hoyISO(), mesActual = hoy.slice(0, 7), anio = hoy.slice(0, 4);
    const validos = S.tanqueos.filter(cuentaGasto);
    const totalRecargas = S.recargas.reduce((a, r) => a + Number(r.valor), 0);
    const gastoTotal = validos.reduce((a, t) => a + Number(t.valor_total), 0);
    const delMes = validos.filter((t) => mesDe(t.fecha_tanqueo) === mesActual);
    const gastoMes = delMes.reduce((a, t) => a + Number(t.valor_total), 0);
    const galMes = delMes.reduce((a, t) => a + Number(t.galones), 0);
    const pendientes = S.tanqueos.filter((t) => t.estado === "pendiente");
    const saldo = totalRecargas - gastoTotal;

    $("#kpis").innerHTML = `
      <div class="kpi ${saldo < 0 ? "red" : "green"}"><div class="label">Saldo disponible</div><div class="value">${fmtCOP(saldo)}</div><div class="sub">recargas − tanqueos</div></div>
      <div class="kpi"><div class="label">Total recargado</div><div class="value">${fmtCOP(totalRecargas)}</div><div class="sub">${S.recargas.length} recargas</div></div>
      <div class="kpi"><div class="label">Gasto acumulado</div><div class="value">${fmtCOP(gastoTotal)}</div><div class="sub">${validos.length} tanqueos</div></div>
      <div class="kpi amber"><div class="label">Gasto ${nombreMes(mesActual)}</div><div class="value">${fmtCOP(gastoMes)}</div><div class="sub">${fmtNum(galMes, 2)} galones · ${delMes.length} tanqueos</div></div>
      <div class="kpi ${pendientes.length ? "amber" : ""}"><div class="label">Pendientes por revisar</div><div class="value">${pendientes.length}</div><div class="sub">${fmtCOP(pendientes.reduce((a, t) => a + Number(t.valor_total), 0))}</div></div>`;

    // Gráfica mensual
    const meses = [];
    const d = new Date(Number(anio), Number(mesActual.slice(5)) - 1, 1);
    for (let i = 11; i >= 0; i--) { const m = new Date(d.getFullYear(), d.getMonth() - i, 1); meses.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`); }
    const porMes = Object.fromEntries(meses.map((m) => [m, 0]));
    validos.forEach((t) => { const m = mesDe(t.fecha_tanqueo); if (m in porMes) porMes[m] += Number(t.valor_total); });
    grafica("chartMeses", "bar", meses.map(nombreMes), [{ label: "Gasto (COP)", data: meses.map((m) => porMes[m]), backgroundColor: "#0b3d91" }]);

    // Por vehículo (año actual)
    const delAnio = validos.filter((t) => mesDe(t.fecha_tanqueo).startsWith(anio));
    const porVeh = {};
    delAnio.forEach((t) => { porVeh[t.placa] = porVeh[t.placa] || { gasto: 0, gal: 0, n: 0, km: [] }; porVeh[t.placa].gasto += Number(t.valor_total); porVeh[t.placa].gal += Number(t.galones); porVeh[t.placa].n++; if (t.kilometraje) porVeh[t.placa].km.push(t.kilometraje); });
    const placas = S.vehiculos.map((v) => v.placa).filter((p) => porVeh[p]);
    grafica("chartVehiculos", "doughnut", placas, [{ data: placas.map((p) => porVeh[p].gasto), backgroundColor: ["#0b3d91", "#f59e0b", "#16a34a", "#dc2626", "#7c3aed", "#0891b2", "#db2777"] }]);

    $("#tablaResumenVeh").innerHTML = `<thead><tr><th>Placa</th><th>Vehículo</th><th>Conductor</th><th class="num">Tanqueos</th><th class="num">Galones</th><th class="num">Gasto</th><th class="num">$/galón prom.</th><th class="num">Km recorridos*</th></tr></thead><tbody>` +
      (placas.length ? placas.map((p) => { const v = vehiculoDe(p), s = porVeh[p]; const km = s.km.length > 1 ? Math.max(...s.km) - Math.min(...s.km) : null;
        return `<tr><td><strong>${p}</strong></td><td>${escapeHtml(v.marca_modelo || "")}</td><td>${escapeHtml(nombreDe(v.conductor_id))}</td><td class="num">${s.n}</td><td class="num">${fmtNum(s.gal, 2)}</td><td class="num">${fmtCOP(s.gasto)}</td><td class="num">${fmtCOP(s.gasto / s.gal)}</td><td class="num">${km !== null ? fmtNum(km, 0) : "—"}</td></tr>`; }).join("")
      : `<tr><td colspan="8" class="muted center">Sin tanqueos este año</td></tr>`) + `</tbody>`;

    $("#tablaUltimos").innerHTML = cabeceraTanqueos() + `<tbody>` + S.tanqueos.slice(0, 8).map(filaTanqueo).join("") + `</tbody>`;
  }

  function grafica(id, tipo, labels, datasets) {
    if (S.charts[id]) S.charts[id].destroy();
    const ctx = $("#" + id);
    if (!ctx) return;
    S.charts[id] = new Chart(ctx, {
      type: tipo, data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: tipo === "doughnut", position: "right" }, tooltip: { callbacks: { label: (c) => ` ${fmtCOP(c.parsed.y ?? c.parsed)}` } } },
        scales: tipo === "bar" ? { y: { ticks: { callback: (v) => "$" + fmtNum(v / 1000, 0) + "k" } } } : {},
      },
    });
  }

  // ============================================================
  //  TANQUEOS
  // ============================================================
  const cabeceraTanqueos = () => `<thead><tr><th>Fecha</th><th>Recibo</th><th>Placa</th><th>Conductor</th><th>Combustible</th><th class="num">Galones</th><th class="num">$/galón</th><th class="num">Total</th><th>Estado</th><th>Foto</th></tr></thead>`;
  const filaTanqueo = (t) => `<tr class="clickable" data-id="${t.id}">
      <td>${fmtFechaHora(t.fecha_tanqueo)}</td><td>${escapeHtml(t.numero_recibo)}</td><td><strong>${escapeHtml(t.placa)}</strong></td>
      <td>${escapeHtml(nombreDe(t.conductor_id))}</td><td>${escapeHtml(t.tipo_combustible)}</td>
      <td class="num">${fmtNum(t.galones, 3)}</td><td class="num">${fmtCOP(t.valor_galon)}</td><td class="num"><strong>${fmtCOP(t.valor_total)}</strong></td>
      <td><span class="badge ${t.estado}">${t.estado}</span></td><td>${t.foto_path ? "📷" : '<span class="muted">—</span>'}${t.origen === "ocr" ? " 🔎" : ""}</td></tr>`;

  function llenarFiltros() {
    const fp = $("#fPlaca"), fc = $("#fConductor");
    const vp = fp.value, vc = fc.value;
    fp.innerHTML = `<option value="">Todas</option>` + S.vehiculos.map((v) => `<option value="${v.placa}">${v.placa}</option>`).join("");
    fc.innerHTML = `<option value="">Todos</option>` + S.perfiles.map((p) => `<option value="${p.id}">${escapeHtml(p.nombre)}</option>`).join("");
    fp.value = vp; fc.value = vc;
  }

  function tanqueosFiltrados() {
    const placa = $("#fPlaca").value, cond = $("#fConductor").value, estado = $("#fEstado").value;
    const desde = $("#fDesde").value, hasta = $("#fHasta").value, texto = $("#fTexto").value.trim().toLowerCase();
    return S.tanqueos.filter((t) => {
      if (placa && t.placa !== placa) return false;
      if (cond && t.conductor_id !== cond) return false;
      if (estado && t.estado !== estado) return false;
      const dia = diaDe(t.fecha_tanqueo);
      if (desde && dia < desde) return false;
      if (hasta && dia > hasta) return false;
      if (texto && !`${t.numero_recibo} ${t.estacion || ""} ${t.ciudad || ""} ${t.observaciones || ""}`.toLowerCase().includes(texto)) return false;
      return true;
    });
  }

  function renderTanqueos() {
    const lista = tanqueosFiltrados();
    const total = lista.filter(cuentaGasto).reduce((a, t) => a + Number(t.valor_total), 0);
    const gal = lista.filter(cuentaGasto).reduce((a, t) => a + Number(t.galones), 0);
    $("#resumenFiltro").textContent = `${lista.length} registros · ${fmtNum(gal, 2)} galones · ${fmtCOP(total)} (sin rechazados)`;
    $("#tablaTanqueos").innerHTML = cabeceraTanqueos() + `<tbody>` +
      (lista.length ? lista.map(filaTanqueo).join("") : `<tr><td colspan="10" class="muted center">No hay tanqueos con esos filtros</td></tr>`) + `</tbody>`;
  }
  ["fPlaca", "fConductor", "fEstado", "fDesde", "fHasta", "fTexto"].forEach((id) => $("#" + id).addEventListener("input", renderTanqueos));
  $("#btnLimpiarFiltros").addEventListener("click", () => { ["fPlaca", "fConductor", "fEstado", "fDesde", "fHasta", "fTexto"].forEach((id) => ($("#" + id).value = "")); renderTanqueos(); });

  document.addEventListener("click", (e) => {
    const tr = e.target.closest("#tablaTanqueos tr[data-id], #tablaUltimos tr[data-id]");
    if (tr) abrirTanqueo(tr.dataset.id);
  });

  $("#btnExportar").addEventListener("click", () => {
    const filas = [["Fecha tanqueo", "Número recibo", "Placa", "Vehículo", "Conductor", "Tipo combustible", "Galones", "Valor galón", "Valor total", "Kilometraje", "Estación", "Ciudad", "Estado", "Motivo rechazo", "Observaciones", "Origen datos", "Revisado por", "Fecha revisión", "Registrado en"]];
    tanqueosFiltrados().forEach((t) => filas.push([fmtFechaHora(t.fecha_tanqueo), t.numero_recibo, t.placa, vehiculoDe(t.placa).marca_modelo, nombreDe(t.conductor_id), t.tipo_combustible,
      String(t.galones).replace(".", ","), Math.round(t.valor_galon), Math.round(t.valor_total), t.kilometraje ?? "", t.estacion ?? "", t.ciudad ?? "", t.estado, t.motivo_rechazo ?? "", t.observaciones ?? "",
      t.origen === "ocr" ? "Lectura automática" : "Manual", t.revisado_por ? nombreDe(t.revisado_por) : "", t.revisado_en ? fmtFechaHora(t.revisado_en) : "", fmtFechaHora(t.creado_en)]));
    descargarCSV(`tanqueos_kernel_energy_${hoyISO()}.csv`, filas);
  });

  // ---------- Detalle / edición de un tanqueo ----------
  function formularioTanqueo(t) {
    const fechaLocal = t.fecha_tanqueo ? aDatetimeLocal(new Date(t.fecha_tanqueo)) : aDatetimeLocal();
    return `
      <div class="grid grid-2">
        <div class="field"><label>Fecha y hora *</label><input type="datetime-local" name="fecha_tanqueo" value="${fechaLocal}" required></div>
        <div class="field"><label>Número de recibo *</label><input type="text" name="numero_recibo" value="${escapeHtml(t.numero_recibo || "")}" required maxlength="40"></div>
        <div class="field"><label>Placa *</label><select name="placa" required>${opcPlacas(t.placa)}</select></div>
        <div class="field"><label>Conductor *</label><select name="conductor_id" required>${opcConductores(t.conductor_id, "Selecciona…")}</select></div>
        <div class="field"><label>Tipo de combustible *</label><select name="tipo_combustible">${opcTipos(t.tipo_combustible || "Diésel (ACPM)")}</select></div>
        <div class="field"><label>Kilometraje</label><input type="number" name="kilometraje" value="${t.kilometraje ?? ""}" min="0" step="1"></div>
        <div class="field"><label>Galones *</label><input type="number" name="galones" value="${t.galones ?? ""}" min="0.001" step="0.001" required></div>
        <div class="field"><label>Valor por galón (COP) *</label><input type="number" name="valor_galon" value="${t.valor_galon ? Math.round(t.valor_galon) : ""}" min="1" step="1" required></div>
        <div class="field"><label>Estación</label><input type="text" name="estacion" value="${escapeHtml(t.estacion || "")}" maxlength="80"></div>
        <div class="field"><label>Ciudad</label><input type="text" name="ciudad" value="${escapeHtml(t.ciudad || "")}" maxlength="60"></div>
      </div>
      <div class="field"><label>Observaciones</label><input type="text" name="observaciones" value="${escapeHtml(t.observaciones || "")}" maxlength="200"></div>
      <div class="total-box"><span>Valor total</span><span data-total>${fmtCOP(t.valor_total || 0)}</span></div>`;
  }
  function enlazarTotal(form) {
    const calc = () => { const g = parseFloat(form.galones.value) || 0, v = parseFloat(form.valor_galon.value) || 0; form.querySelector("[data-total]").textContent = fmtCOP(Math.round(g * v)); };
    form.galones.addEventListener("input", calc); form.valor_galon.addEventListener("input", calc);
  }
  function leerFormularioTanqueo(form) {
    return {
      fecha_tanqueo: new Date(form.fecha_tanqueo.value).toISOString(),
      numero_recibo: form.numero_recibo.value.trim(),
      placa: form.placa.value,
      conductor_id: form.conductor_id.value,
      tipo_combustible: form.tipo_combustible.value,
      galones: parseFloat(form.galones.value),
      valor_galon: parseFloat(form.valor_galon.value),
      kilometraje: form.kilometraje.value ? parseInt(form.kilometraje.value, 10) : null,
      estacion: form.estacion.value.trim() || null,
      ciudad: form.ciudad.value.trim() || null,
      observaciones: form.observaciones.value.trim() || null,
    };
  }

  async function abrirTanqueo(id) {
    const t = S.tanqueos.find((x) => x.id === id);
    if (!t) return;
    const modal = abrirModal(`
      <div class="modal-head">
        <div><h2>Recibo ${escapeHtml(t.numero_recibo)} · ${escapeHtml(t.placa)}</h2>
          <span class="badge ${t.estado}">${t.estado}</span>
          <span class="muted small"> · Enviado por ${escapeHtml(nombreDe(t.conductor_id))} el ${fmtFechaHora(t.creado_en)}</span>
          ${t.revisado_por ? `<span class="muted small"> · Revisado por ${escapeHtml(nombreDe(t.revisado_por))} el ${fmtFechaHora(t.revisado_en)}</span>` : ""}
          ${t.motivo_rechazo ? `<div class="small" style="color:var(--red)">Motivo de rechazo: ${escapeHtml(t.motivo_rechazo)}</div>` : ""}
        </div>
        <button class="close" data-cerrar aria-label="Cerrar">×</button>
      </div>
      <div class="detalle">
        <div>
          <div class="foto-box" id="fotoBox"><span class="muted">${t.foto_path ? "Cargando foto…" : "Sin foto adjunta"}</span></div>
          <div class="row mt"><a id="linkFoto" class="btn sm" target="_blank" rel="noopener" hidden>Abrir foto en tamaño completo</a>
            ${t.origen === "ocr" ? `<span class="badge admin" title="Los datos fueron leídos automáticamente de la foto">🔎 Leído automáticamente</span>` : ""}</div>
          ${t.texto_ocr ? `<details class="mt"><summary>Texto reconocido en el recibo</summary><div class="ocr-texto mt">${escapeHtml(t.texto_ocr)}</div>
            ${t.campos_ocr ? `<div class="muted small mt">Valores leídos por la app: ${escapeHtml(Object.entries(t.campos_ocr).map(([k, v]) => `${k}=${v}`).join(" · "))}</div>` : ""}</details>` : ""}
        </div>
        <form id="formDetalle">${formularioTanqueo(t)}
          <div class="actions">
            ${t.estado !== "aprobado" ? `<button type="button" class="btn success" data-accion="aprobar">✓ Aprobar</button>` : ""}
            ${t.estado !== "rechazado" ? `<button type="button" class="btn danger" data-accion="rechazar">✗ Rechazar</button>` : ""}
            <button type="submit" class="btn primary">Guardar cambios</button>
            <button type="button" class="btn ghost" data-accion="eliminar">Eliminar</button>
          </div>
        </form>
      </div>`);

    const form = modal.querySelector("#formDetalle");
    enlazarTotal(form);

    if (t.foto_path) {
      const url = await urlFoto(t.foto_path);
      const box = modal.querySelector("#fotoBox");
      if (url) { box.innerHTML = `<img src="${url}" alt="Recibo">`; const a = modal.querySelector("#linkFoto"); a.href = url; a.hidden = false; }
      else box.innerHTML = `<span class="muted">No se pudo cargar la foto</span>`;
    }

    async function actualizar(cambios, msg) {
      const { error } = await sb.from("tanqueos").update(cambios).eq("id", id);
      if (error) { toast(mensajeError(error), "error"); return false; }
      toast(msg, "success"); cerrarModal(); await cargarTodo(); return true;
    }

    form.addEventListener("submit", async (e) => { e.preventDefault(); await actualizar(leerFormularioTanqueo(form), "Tanqueo actualizado"); });
    form.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-accion]"); if (!b) return;
      const ahora = new Date().toISOString();
      if (b.dataset.accion === "aprobar") {
        await actualizar({ ...leerFormularioTanqueo(form), estado: "aprobado", motivo_rechazo: null, revisado_por: perfil.id, revisado_en: ahora }, "Tanqueo aprobado");
      } else if (b.dataset.accion === "rechazar") {
        const motivo = prompt("Motivo del rechazo (el conductor lo verá):", t.motivo_rechazo || "");
        if (motivo === null) return;
        await actualizar({ estado: "rechazado", motivo_rechazo: motivo.trim() || "Sin motivo", revisado_por: perfil.id, revisado_en: ahora }, "Tanqueo rechazado");
      } else if (b.dataset.accion === "eliminar") {
        if (!confirm("¿Eliminar definitivamente este tanqueo y su foto? Esta acción no se puede deshacer.")) return;
        const { error } = await sb.from("tanqueos").delete().eq("id", id);
        if (error) { toast(mensajeError(error), "error"); return; }
        if (t.foto_path) await sb.storage.from(cfg.BUCKET_RECIBOS).remove([t.foto_path]);
        toast("Tanqueo eliminado", "success"); cerrarModal(); await cargarTodo();
      }
    });
  }

  // ---------- Registro manual por el administrador ----------
  $("#btnNuevoTanqueo").addEventListener("click", () => {
    const modal = abrirModal(`
      <div class="modal-head"><h2>Registrar tanqueo manualmente</h2><button class="close" data-cerrar aria-label="Cerrar">×</button></div>
      <p class="muted small">Úsalo cuando el conductor no pudo enviarlo desde su celular. Queda aprobado de inmediato.</p>
      <form id="formNuevo">${formularioTanqueo({})}
        <div class="field mt"><label>Foto del recibo (opcional)</label><input type="file" name="foto" accept="image/*"></div>
        <div class="actions"><button type="submit" class="btn primary">Guardar tanqueo</button><button type="button" class="btn" data-cerrar>Cancelar</button></div>
      </form>`);
    const form = modal.querySelector("#formNuevo");
    enlazarTotal(form);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector("[type=submit]"); btn.disabled = true;
      const datos = leerFormularioTanqueo(form);
      let foto_path = null;
      const file = form.foto.files[0];
      if (file) {
        try {
          const blob = await comprimirImagen(file);
          foto_path = `${perfil.id}/${Date.now()}_${datos.placa}.jpg`;
          const up = await sb.storage.from(cfg.BUCKET_RECIBOS).upload(foto_path, blob, { contentType: "image/jpeg" });
          if (up.error) throw up.error;
        } catch (err) { toast("Foto: " + mensajeError(err), "error"); btn.disabled = false; return; }
      }
      const { error } = await sb.from("tanqueos").insert({ ...datos, foto_path, estado: "aprobado", revisado_por: perfil.id, revisado_en: new Date().toISOString() });
      if (error) { toast(mensajeError(error), "error"); btn.disabled = false; return; }
      toast("Tanqueo registrado", "success"); cerrarModal(); await cargarTodo();
    });
  });

  // ============================================================
  //  RECARGAS
  // ============================================================
  $("#rMedio").innerHTML = cfg.MEDIOS_RECARGA.map((m) => `<option>${m}</option>`).join("");
  $("#rFecha").value = hoyISO();

  function renderRecargas() {
    const total = S.recargas.reduce((a, r) => a + Number(r.valor), 0);
    $("#totalRecargas").textContent = fmtCOP(total);
    $("#tablaRecargas").innerHTML = `<thead><tr><th>Fecha</th><th class="num">Valor</th><th>Medio</th><th>Referencia</th><th>Descripción</th><th>Registrado por</th><th></th></tr></thead><tbody>` +
      (S.recargas.length ? S.recargas.map((r) => `<tr>
        <td>${fmtFecha(r.fecha)}</td><td class="num"><strong>${fmtCOP(r.valor)}</strong></td><td>${escapeHtml(r.medio || "")}</td>
        <td>${escapeHtml(r.referencia || "")}</td><td>${escapeHtml(r.descripcion || "")}</td><td>${escapeHtml(nombreDe(r.creado_por))}</td>
        <td><button class="btn sm ghost" data-del-recarga="${r.id}">Eliminar</button></td></tr>`).join("")
      : `<tr><td colspan="7" class="muted center">Aún no hay recargas</td></tr>`) + `</tbody>`;
  }

  $("#formRecarga").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { error } = await sb.from("recargas").insert({
      fecha: $("#rFecha").value, valor: parseFloat($("#rValor").value), medio: $("#rMedio").value,
      referencia: $("#rReferencia").value.trim() || null, descripcion: $("#rDescripcion").value.trim() || null, creado_por: perfil.id,
    });
    if (error) { toast(mensajeError(error), "error"); return; }
    toast("Recarga guardada", "success");
    ["rValor", "rReferencia", "rDescripcion"].forEach((id) => ($("#" + id).value = ""));
    await cargarTodo();
  });

  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-del-recarga]"); if (!b) return;
    if (!confirm("¿Eliminar esta recarga?")) return;
    const { error } = await sb.from("recargas").delete().eq("id", b.dataset.delRecarga);
    if (error) { toast(mensajeError(error), "error"); return; }
    toast("Recarga eliminada", "success"); await cargarTodo();
  });

  // ============================================================
  //  VEHÍCULOS
  // ============================================================
  function renderVehiculos() {
    $("#tablaVehiculos").innerHTML = `<thead><tr><th>Placa</th><th>Tipo</th><th>Marca / modelo</th><th>Año</th><th>Color</th><th>Combustible</th><th>Conductor asignado</th><th>Estado</th></tr></thead><tbody>` +
      S.vehiculos.map((v) => `<tr class="clickable" data-placa="${v.placa}">
        <td><strong>${v.placa}</strong></td><td>${escapeHtml(v.tipo)}</td><td>${escapeHtml(v.marca_modelo)}</td><td>${v.anio ?? ""}</td><td>${escapeHtml(v.color || "")}</td>
        <td>${escapeHtml(v.combustible_predeterminado || "")}</td><td>${v.conductor_id ? escapeHtml(nombreDe(v.conductor_id)) : '<span class="muted">Sin asignar</span>'}</td>
        <td>${v.activo ? '<span class="badge aprobado">activo</span>' : '<span class="badge inactivo">inactivo</span>'}</td></tr>`).join("") + `</tbody>`;
  }
  document.addEventListener("click", (e) => { const tr = e.target.closest("#tablaVehiculos tr[data-placa]"); if (tr) abrirVehiculo(tr.dataset.placa); });
  $("#btnNuevoVehiculo").addEventListener("click", () => abrirVehiculo(null));

  function abrirVehiculo(placa) {
    const v = placa ? vehiculoDe(placa) : { activo: true, tipo: "Camioneta", combustible_predeterminado: "Diésel (ACPM)" };
    const modal = abrirModal(`
      <div class="modal-head"><h2>${placa ? "Editar vehículo " + placa : "Nuevo vehículo"}</h2><button class="close" data-cerrar aria-label="Cerrar">×</button></div>
      <form id="formVeh">
        <div class="grid grid-2">
          <div class="field"><label>Placa *</label><input name="placa" value="${escapeHtml(v.placa || "")}" required maxlength="10" style="text-transform:uppercase" ${placa ? "readonly" : ""}></div>
          <div class="field"><label>Tipo *</label><select name="tipo">${opciones(["Camioneta", "Automóvil", "Camión", "Motocicleta", "Otro"].map((x) => ({ value: x, label: x })), v.tipo)}</select></div>
          <div class="field"><label>Marca / modelo *</label><input name="marca_modelo" value="${escapeHtml(v.marca_modelo || "")}" required maxlength="60"></div>
          <div class="field"><label>Año</label><input name="anio" type="number" value="${v.anio ?? ""}" min="1990" max="2100"></div>
          <div class="field"><label>Color</label><input name="color" value="${escapeHtml(v.color || "")}" maxlength="30"></div>
          <div class="field"><label>Combustible habitual</label><select name="combustible_predeterminado">${opcTipos(v.combustible_predeterminado)}</select></div>
          <div class="field"><label>Conductor asignado</label><select name="conductor_id">${opcConductores(v.conductor_id, "Sin asignar")}</select></div>
          <div class="field"><label>Estado</label><select name="activo">${opciones([{ value: "true", label: "Activo" }, { value: "false", label: "Inactivo" }], String(v.activo))}</select></div>
        </div>
        <div class="actions">
          <button type="submit" class="btn primary">Guardar</button>
          ${placa ? `<button type="button" class="btn ghost" data-accion="eliminar">Eliminar</button>` : ""}
          <button type="button" class="btn" data-cerrar>Cancelar</button>
        </div>
      </form>`);
    const form = modal.querySelector("#formVeh");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const datos = {
        placa: form.placa.value.trim().toUpperCase().replace(/\s+/g, ""), tipo: form.tipo.value, marca_modelo: form.marca_modelo.value.trim(),
        anio: form.anio.value ? parseInt(form.anio.value, 10) : null, color: form.color.value.trim() || null,
        combustible_predeterminado: form.combustible_predeterminado.value, conductor_id: form.conductor_id.value || null, activo: form.activo.value === "true",
      };
      const { error } = await sb.from("vehiculos").upsert(datos, { onConflict: "placa" });
      if (error) { toast(mensajeError(error), "error"); return; }
      toast("Vehículo guardado", "success"); cerrarModal(); await cargarTodo();
    });
    form.addEventListener("click", async (e) => {
      if (!e.target.closest("[data-accion=eliminar]")) return;
      if (!confirm(`¿Eliminar el vehículo ${placa}? Si tiene tanqueos registrados, mejor márcalo como inactivo.`)) return;
      const { error } = await sb.from("vehiculos").delete().eq("placa", placa);
      if (error) { toast(/foreign key/i.test(error.message) ? "No se puede eliminar: tiene tanqueos asociados. Márcalo como inactivo." : mensajeError(error), "error"); return; }
      toast("Vehículo eliminado", "success"); cerrarModal(); await cargarTodo();
    });
  }

  // ============================================================
  //  CONDUCTORES / USUARIOS
  // ============================================================
  function renderConductores() {
    $("#tablaConductores").innerHTML = `<thead><tr><th>Nombre</th><th>Correo</th><th>Teléfono</th><th>Rol</th><th>Vehículos asignados</th><th>Estado</th><th>Creado</th></tr></thead><tbody>` +
      S.perfiles.map((p) => `<tr class="clickable" data-uid="${p.id}">
        <td><strong>${escapeHtml(p.nombre)}</strong></td><td>${escapeHtml(p.email || "")}</td><td>${escapeHtml(p.telefono || "")}</td>
        <td><span class="badge ${p.rol}">${p.rol}</span></td>
        <td>${S.vehiculos.filter((v) => v.conductor_id === p.id).map((v) => v.placa).join(", ") || '<span class="muted">—</span>'}</td>
        <td>${p.activo ? '<span class="badge aprobado">activo</span>' : '<span class="badge inactivo">inactivo</span>'}</td>
        <td>${fmtFecha(p.creado_en)}</td></tr>`).join("") + `</tbody>`;
  }
  document.addEventListener("click", (e) => { const tr = e.target.closest("#tablaConductores tr[data-uid]"); if (tr) abrirConductor(tr.dataset.uid); });

  function abrirConductor(uid) {
    const p = S.perfiles.find((x) => x.id === uid); if (!p) return;
    const esYo = uid === perfil.id;
    const modal = abrirModal(`
      <div class="modal-head"><h2>Editar usuario</h2><button class="close" data-cerrar aria-label="Cerrar">×</button></div>
      <form id="formCond">
        <div class="grid grid-2">
          <div class="field"><label>Nombre completo *</label><input name="nombre" value="${escapeHtml(p.nombre)}" required maxlength="80"></div>
          <div class="field"><label>Correo</label><input value="${escapeHtml(p.email || "")}" readonly></div>
          <div class="field"><label>Teléfono</label><input name="telefono" value="${escapeHtml(p.telefono || "")}" maxlength="20"></div>
          <div class="field"><label>Rol</label><select name="rol" ${esYo ? "disabled" : ""}>${opciones([{ value: "conductor", label: "Conductor (solo envía recibos)" }, { value: "admin", label: "Administrador (acceso total)" }], p.rol)}</select></div>
          <div class="field"><label>Estado</label><select name="activo" ${esYo ? "disabled" : ""}>${opciones([{ value: "true", label: "Activo" }, { value: "false", label: "Inactivo (no puede ingresar)" }], String(p.activo))}</select></div>
        </div>
        ${esYo ? `<p class="muted small">No puedes cambiar tu propio rol ni desactivarte.</p>` : ""}
        <p class="muted small">Para cambiar la contraseña o eliminar el usuario: Supabase → Authentication → Users.</p>
        <div class="actions"><button type="submit" class="btn primary">Guardar</button><button type="button" class="btn" data-cerrar>Cancelar</button></div>
      </form>`);
    const form = modal.querySelector("#formCond");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const cambios = { nombre: form.nombre.value.trim(), telefono: form.telefono.value.trim() || null };
      if (!esYo) { cambios.rol = form.rol.value; cambios.activo = form.activo.value === "true"; }
      const { error } = await sb.from("perfiles").update(cambios).eq("id", uid);
      if (error) { toast(mensajeError(error), "error"); return; }
      toast("Usuario actualizado", "success"); cerrarModal(); await cargarTodo();
    });
  }

  // ============================================================
  //  Tiempo real: refresca cuando un conductor envía un tanqueo
  // ============================================================
  sb.channel("tanqueos-admin")
    .on("postgres_changes", { event: "*", schema: "public", table: "tanqueos" }, () => {
      cargarTodo();
      if (document.hidden === false) toast("Nuevo movimiento en tanqueos");
    })
    .subscribe();

  await cargarTodo();
})();
