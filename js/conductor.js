/* App del conductor: foto del recibo + datos del tanqueo → Supabase */
(async function () {
  if (window.KE_SIN_CONFIG) return;
  const { $, cfg, fmtCOP, fmtNum, fmtFechaHora, aDatetimeLocal, escapeHtml, toast, requireAuth, logout, comprimirImagen, mensajeError } = KE;

  const { session, perfil } = await requireAuth();
  const uid = session.user.id;
  const esAdmin = perfil.rol === "admin";
  const TEXTO_BOTON = esAdmin ? "Guardar tanqueo" : "Enviar al administrador";
  $("#userName").textContent = perfil.nombre;
  if (esAdmin) {
    $("#linkAdmin").hidden = false;
    $("#btnEnviar").textContent = TEXTO_BOTON;
    $("#fotoOrigenAdmin").hidden = false;
    $("#campoConductor").hidden = false;
    // lista de conductores para registrar a nombre de otro
    const { data: perfiles } = await sb.from("perfiles").select("id, nombre, rol").eq("activo", true).order("nombre");
    $("#conductor").innerHTML = (perfiles || []).map((p) => `<option value="${p.id}" ${p.id === uid ? "selected" : ""}>${escapeHtml(p.nombre)}${p.id === uid ? " (yo)" : ""}</option>`).join("");
  }
  $("#btnLogout").addEventListener("click", logout);
  const btnHuella = $("#btnHuella"); btnHuella.hidden = false; KE.configurarBotonHuella(btnHuella, perfil);
  $("#btnClave").addEventListener("click", async () => {
    const c1 = prompt("Nueva contraseña (mínimo 6 caracteres):"); if (c1 === null) return;
    if (c1.length < 6) { toast("Debe tener al menos 6 caracteres", "error"); return; }
    const c2 = prompt("Repite la nueva contraseña:"); if (c2 === null) return;
    if (c1 !== c2) { toast("Las contraseñas no coinciden", "error"); return; }
    const { error } = await sb.auth.updateUser({ password: c1 });
    toast(error ? mensajeError(error) : "Contraseña actualizada", error ? "error" : "success");
  });

  let vehiculos = [];
  let fotoBlob = null;
  let fotoOriginal = null;          // archivo original (mejor resolución para el OCR)
  let ocr = { texto: null, campos: null, detectados: [] };   // resultado de la lectura automática

  // ---------- Vehículos ----------
  async function cargarVehiculos() {
    const { data, error } = await sb.from("vehiculos").select("*").eq("activo", true).order("placa");
    if (error) { toast(mensajeError(error), "error"); return; }
    vehiculos = data || [];
    const mios = vehiculos.filter((v) => v.conductor_id === uid);
    const otros = vehiculos.filter((v) => v.conductor_id !== uid);
    const opt = (v) => `<option value="${v.placa}">${v.placa} · ${escapeHtml(v.marca_modelo)}${v.conductor_id === uid ? " (asignado)" : ""}</option>`;
    let html = "";
    if (mios.length) html += `<optgroup label="Mis vehículos">${mios.map(opt).join("")}</optgroup>`;
    if (otros.length) html += `<optgroup label="Otros vehículos de la flota">${otros.map(opt).join("")}</optgroup>`;
    $("#placa").innerHTML = html || `<option value="">No hay vehículos activos</option>`;
    aplicarCombustiblePredeterminado();
  }

  function aplicarCombustiblePredeterminado() {
    const v = vehiculos.find((x) => x.placa === $("#placa").value);
    if (v && v.combustible_predeterminado) $("#tipo").value = v.combustible_predeterminado;
    // admin: al elegir la placa, proponer el conductor asignado a ese vehículo
    if (esAdmin && v && v.conductor_id && $("#conductor").querySelector(`option[value="${v.conductor_id}"]`)) $("#conductor").value = v.conductor_id;
  }

  $("#tipo").innerHTML = cfg.TIPOS_COMBUSTIBLE.map((t) => `<option>${t}</option>`).join("");
  $("#placa").addEventListener("change", aplicarCombustiblePredeterminado);
  $("#fecha").value = aDatetimeLocal();

  // ---------- Total ----------
  function calcTotal() {
    const g = parseFloat($("#galones").value) || 0, v = parseFloat($("#valorGalon").value) || 0;
    $("#total").textContent = fmtCOP(Math.round(g * v));
  }
  $("#galones").addEventListener("input", calcTotal);
  $("#valorGalon").addEventListener("input", calcTotal);

  // ---------- Foto ----------
  const inputFoto = $("#foto");
  const inputArchivo = $("#fotoArchivo");
  $("#fotoBox").addEventListener("click", () => inputFoto.click());
  $("#btnRepetirFoto").addEventListener("click", () => inputFoto.click());
  $("#btnSubirArchivo").addEventListener("click", () => inputArchivo.click());
  inputFoto.addEventListener("change", () => procesarFoto(inputFoto.files[0]));
  inputArchivo.addEventListener("change", () => procesarFoto(inputArchivo.files[0]));

  async function procesarFoto(file) {
    if (!file) return;
    try {
      fotoOriginal = file;
      fotoBlob = await comprimirImagen(file);
      const url = URL.createObjectURL(fotoBlob);
      $("#fotoPreview").src = url;
      $("#fotoPreview").hidden = false;
      $("#fotoVacia").hidden = true;
      $("#fotoAcciones").hidden = false;
      $("#fotoInfo").textContent = `${fmtNum(fotoBlob.size / 1024, 0)} KB`;
      await leerReciboAutomatico();
    } catch (e) {
      fotoBlob = null; fotoOriginal = null;
      toast(e.message, "error");
    }
  }
  $("#btnReleer").addEventListener("click", () => fotoOriginal && leerReciboAutomatico());

  // ---------- Lectura automática (OCR) ----------
  const ETIQUETAS = { fecha: "fecha", hora: "hora", numero_recibo: "N° recibo", galones: "galones", valor_galon: "valor por galón",
                      valor_total: "total", tipo_combustible: "combustible", estacion: "estación", placa: "placa", kilometraje: "kilometraje" };
  const CAMPO_INPUT = { numero_recibo: "recibo", galones: "galones", valor_galon: "valorGalon", tipo_combustible: "tipo", estacion: "estacion", placa: "placa", kilometraje: "kilometraje", fecha: "fecha", hora: "fecha" };

  function marcarAuto(id, si) { const el = $("#" + id); if (el) el.classList.toggle("auto", !!si); }
  function mostrarResultadoOCR(texto, tipo) { const el = $("#ocrResultado"); el.innerHTML = texto; el.className = `alert ${tipo}`; el.hidden = false; }

  async function leerReciboAutomatico() {
    if (!window.KE_OCR || !fotoOriginal) return;
    const prog = $("#ocrProgreso"); prog.hidden = false; $("#ocrResultado").hidden = true;
    $("#btnEnviar").disabled = true;
    Object.values(CAMPO_INPUT).forEach((id) => marcarAuto(id, false));
    try {
      const r = await KE_OCR.leerRecibo(fotoOriginal, vehiculos.map((v) => v.placa), (pct, msg) => {
        $("#ocrPct").textContent = pct + "%"; $("#ocrMsg").textContent = msg; $("#ocrBarra").style.width = pct + "%";
      });
      ocr = r;
      aplicarCamposOCR(r.campos);
      const leidos = r.detectados.filter((c) => c !== "hora").map((c) => ETIQUETAS[c]);
      const faltan = ["numero_recibo", "galones", "valor_galon"].filter((c) => !r.campos[c]).map((c) => ETIQUETAS[c]);
      if (!leidos.length) {
        mostrarResultadoOCR("No se pudo leer el recibo. Intenta otra foto con buena luz y el recibo plano, o escribe los datos manualmente.", "warn");
      } else {
        mostrarResultadoOCR(`<strong>Datos leídos del recibo:</strong> ${leidos.join(", ")}.` +
          (faltan.length ? `<br><strong>No se detectó:</strong> ${faltan.join(", ")} — complétalo manualmente.` : "") +
          `<br>Verifica que coincidan con el recibo antes de enviar.`, faltan.length ? "warn" : "info");
      }
    } catch (e) {
      console.warn(e);
      mostrarResultadoOCR("La lectura automática no está disponible en este momento (" + escapeHtml(e.message) + "). Escribe los datos manualmente.", "warn");
    } finally {
      prog.hidden = true; $("#btnEnviar").disabled = false;
    }
  }

  function aplicarCamposOCR(c) {
    if (c.fecha) {
      const hora = c.hora || $("#fecha").value.slice(11, 16) || "12:00";
      const d = new Date(`${c.fecha}T${hora}:00`);
      // no aceptar fechas futuras ni de hace más de un año (lecturas erróneas)
      const ahora = new Date();
      if (!isNaN(d) && d <= new Date(ahora.getTime() + 36e5) && d > new Date(ahora.getFullYear() - 1, ahora.getMonth(), ahora.getDate())) {
        $("#fecha").value = aDatetimeLocal(d); marcarAuto("fecha", true);
      }
    }
    if (c.placa && vehiculos.some((v) => v.placa === c.placa)) { $("#placa").value = c.placa; aplicarCombustiblePredeterminado(); marcarAuto("placa", true); }
    if (c.numero_recibo) { $("#recibo").value = c.numero_recibo; marcarAuto("recibo", true); }
    if (c.tipo_combustible && cfg.TIPOS_COMBUSTIBLE.includes(c.tipo_combustible)) { $("#tipo").value = c.tipo_combustible; marcarAuto("tipo", true); }
    if (c.galones) { $("#galones").value = c.galones; marcarAuto("galones", true); }
    if (c.valor_galon) { $("#valorGalon").value = c.valor_galon; marcarAuto("valorGalon", true); }
    if (c.kilometraje) { $("#kilometraje").value = c.kilometraje; marcarAuto("kilometraje", true); }
    if (c.estacion) { $("#estacion").value = c.estacion; marcarAuto("estacion", true); }
    calcTotal();
  }

  // Si el conductor corrige un campo, deja de marcarse como automático
  Object.values(CAMPO_INPUT).forEach((id) => { const el = $("#" + id); el && el.addEventListener("input", () => marcarAuto(id, false)); });

  function limpiarFormulario() {
    fotoBlob = null; fotoOriginal = null; ocr = { texto: null, campos: null, detectados: [] };
    inputFoto.value = ""; inputArchivo.value = "";
    $("#fotoPreview").hidden = true; $("#fotoPreview").src = "";
    $("#fotoVacia").hidden = false; $("#fotoAcciones").hidden = true;
    $("#ocrResultado").hidden = true; $("#ocrProgreso").hidden = true;
    ["recibo", "galones", "valorGalon", "kilometraje", "estacion", "ciudad", "observaciones"].forEach((id) => ($("#" + id).value = ""));
    Object.values(CAMPO_INPUT).forEach((id) => marcarAuto(id, false));
    $("#fecha").value = aDatetimeLocal();
    calcTotal();
  }

  // ---------- Envío ----------
  $("#formTanqueo").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!fotoBlob) { toast("Debes tomar la foto del recibo.", "error"); $("#fotoBox").scrollIntoView({ behavior: "smooth" }); return; }
    const placa = $("#placa").value;
    if (!placa) { toast("Selecciona el vehículo.", "error"); return; }

    const btn = $("#btnEnviar"); btn.disabled = true; btn.textContent = "Enviando…";
    const fotoPath = `${uid}/${Date.now()}_${placa}.jpg`;

    const up = await sb.storage.from(cfg.BUCKET_RECIBOS).upload(fotoPath, fotoBlob, { contentType: "image/jpeg", upsert: false });
    if (up.error) { toast("No se pudo subir la foto: " + mensajeError(up.error), "error"); btn.disabled = false; btn.textContent = TEXTO_BOTON; return; }

    const registro = {
      fecha_tanqueo: new Date($("#fecha").value).toISOString(),
      numero_recibo: $("#recibo").value.trim(),
      placa,
      conductor_id: esAdmin && $("#conductor").value ? $("#conductor").value : uid,
      tipo_combustible: $("#tipo").value,
      galones: parseFloat($("#galones").value),
      valor_galon: parseFloat($("#valorGalon").value),
      kilometraje: $("#kilometraje").value ? parseInt($("#kilometraje").value, 10) : null,
      estacion: $("#estacion").value.trim() || null,
      ciudad: $("#ciudad").value.trim() || null,
      observaciones: $("#observaciones").value.trim() || null,
      foto_path: fotoPath,
      // el administrador no necesita aprobarse a sí mismo
      estado: esAdmin ? "aprobado" : "pendiente",
      revisado_por: esAdmin ? uid : null,
      revisado_en: esAdmin ? new Date().toISOString() : null,
      // trazabilidad de la lectura automática
      origen: ocr.detectados.length ? "ocr" : "manual",
      texto_ocr: ocr.texto ? ocr.texto.slice(0, 4000) : null,
      campos_ocr: ocr.campos && Object.keys(ocr.campos).length ? ocr.campos : null,
    };
    const ins = await sb.from("tanqueos").insert(registro);
    if (ins.error) {
      await sb.storage.from(cfg.BUCKET_RECIBOS).remove([fotoPath]).catch(() => {});
      toast(mensajeError(ins.error), "error");
      btn.disabled = false; btn.textContent = TEXTO_BOTON;
      return;
    }
    toast(esAdmin ? "✅ Tanqueo guardado" : "✅ Tanqueo enviado al administrador", "success");
    limpiarFormulario();
    btn.disabled = false; btn.textContent = TEXTO_BOTON;
    window.scrollTo({ top: 0, behavior: "smooth" });
    cargarMisTanqueos();
  });

  // ---------- Historial ----------
  async function cargarMisTanqueos() {
    const { data, error } = await sb.from("tanqueos").select("*").eq("conductor_id", uid).order("fecha_tanqueo", { ascending: false }).limit(30);
    const cont = $("#lista");
    if (error) { cont.innerHTML = `<p class="muted">${escapeHtml(mensajeError(error))}</p>`; return; }
    if (!data.length) { cont.innerHTML = `<p class="muted">Aún no has registrado tanqueos.</p>`; return; }
    cont.innerHTML = data.map((t) => `
      <div class="item">
        <div>
          <div class="p">${escapeHtml(t.placa)} · Recibo ${escapeHtml(t.numero_recibo)}</div>
          <div class="muted small">${fmtFechaHora(t.fecha_tanqueo)} · ${fmtNum(t.galones, 3)} gal · ${escapeHtml(t.tipo_combustible)}</div>
          ${t.estado === "rechazado" && t.motivo_rechazo ? `<div class="small" style="color:var(--red)">Motivo: ${escapeHtml(t.motivo_rechazo)}</div>` : ""}
        </div>
        <div class="v">
          <div>${fmtCOP(t.valor_total)}</div>
          <span class="badge ${t.estado}">${t.estado}</span>
        </div>
      </div>`).join("");
  }
  $("#btnRefrescar").addEventListener("click", cargarMisTanqueos);

  await cargarVehiculos();
  await cargarMisTanqueos();
})();
