/* Pantalla de ingreso: contraseña → (verificación en dos pasos) → (huella) → panel o registro */
(async function () {
  if (window.KE_SIN_CONFIG) return;
  const { $, toast, mensajeError } = KE;
  const msg = $("#msg");
  const formLogin = $("#formLogin");
  const formClave = $("#formNuevaClave");
  const formMFA = $("#formMFA");

  // ¿Llegó desde un enlace de invitación / recuperación?
  const hash = location.hash || "";
  const flujoClave = /type=(invite|recovery|signup|magiclink)/.test(hash);
  let esperandoClave = flujoClave;

  function mostrar(texto, tipo = "error") {
    msg.textContent = texto; msg.className = `alert ${tipo}`; msg.hidden = !texto;
  }
  const paso = (t) => { const el = $("#paso"); if (el) el.textContent = t; };
  // Ejecuta una promesa con límite de tiempo (para no quedarse "pensando" sin explicación)
  const conTiempo = (promesa, seg, nombre) => Promise.race([promesa, new Promise((_, rej) => setTimeout(() => rej(new Error(`"${nombre}" no respondió en ${seg} s`)), seg * 1000))]);
  const soloLogin = () => { formLogin.hidden = false; formClave.hidden = true; formMFA.hidden = true; $("#panelHuella").hidden = true; };

  let perfilActual = null;
  let sesionActual = null;
  let procesandoIngreso = false;

  // Lee el perfil a partir de la sesión (sin llamar a auth.getUser, que puede bloquearse dentro del evento de sesión)
  async function cargarPerfil(session) {
    const user = session.user;
    paso("Cargando perfil…");
    const { data, error } = await conTiempo(sb.from("perfiles").select("*").eq("id", user.id).maybeSingle(), 20, "cargar perfil");
    if (error) console.warn("perfil:", error.message);
    return data || { id: user.id, email: user.email, nombre: user.email, rol: "conductor", activo: true };
  }

  async function redirigirPorRol(session) {
    try {
      const perfil = perfilActual || (await cargarPerfil(session));
      if (!perfil.activo) {
        await sb.auth.signOut();
        soloLogin(); paso(""); $("#btnLogin").disabled = false; $("#btnLogin").textContent = "Ingresar";
        mostrar("Tu usuario aún no está activado. Pide al administrador que lo active.", "warn");
        return;
      }
      paso("Abriendo " + (perfil.rol === "admin" ? "panel…" : "registro…"));
      location.replace(perfil.rol === "admin" ? "admin.html" : "conductor.html");
    } catch (e) {
      mostrar("No se pudo cargar tu perfil: " + mensajeError(e));
      paso(""); $("#btnLogin").disabled = false; $("#btnLogin").textContent = "Ingresar";
    }
  }

  // ---------- Verificación en dos pasos (código del autenticador) ----------
  async function requiereSegundoPaso() {
    try {
      const { data, error } = await conTiempo(sb.auth.mfa.getAuthenticatorAssuranceLevel(), 15, "verificar 2FA");
      if (error) { console.warn(error); return false; }
      return data.nextLevel === "aal2" && data.currentLevel !== "aal2";
    } catch (e) { console.warn(e); return false; }
  }
  function pedirCodigo() {
    formLogin.hidden = true; formClave.hidden = true; $("#panelHuella").hidden = true; formMFA.hidden = false;
    paso(""); $("#codigoMFA").value = ""; $("#codigoMFA").focus();
  }
  formMFA.addEventListener("submit", async (e) => {
    e.preventDefault();
    const codigo = $("#codigoMFA").value.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(codigo)) { mostrar("El código tiene 6 dígitos.", "warn"); return; }
    const btn = $("#btnMFA"); btn.disabled = true; btn.textContent = "Verificando…"; mostrar("");
    try {
      const { data: f } = await sb.auth.mfa.listFactors();
      const factor = (f && f.totp && f.totp.find((x) => x.status === "verified")) || (f && f.all && f.all.find((x) => x.status === "verified"));
      if (!factor) throw new Error("No se encontró el autenticador configurado.");
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code: codigo });
      if (error) throw error;
      await continuarTrasVerificar(sesionActual || (await sb.auth.getSession()).data.session);
    } catch (err) {
      mostrar(/Invalid TOTP|invalid/i.test(err.message) ? "Código incorrecto o vencido. Intenta con el siguiente código." : mensajeError(err));
    } finally { btn.disabled = false; btn.textContent = "Verificar"; }
  });
  $("#btnCancelarMFA").addEventListener("click", async () => { await sb.auth.signOut(); procesandoIngreso = false; soloLogin(); paso(""); $("#btnLogin").disabled = false; $("#btnLogin").textContent = "Ingresar"; });

  // ---------- Huella ----------
  async function continuarTrasVerificar(session) {
    try {
      perfilActual = await cargarPerfil(session);
      KE_BIO.marcarDesbloqueado();
      paso("Verificando huella del dispositivo…");
      let disponible = false;
      try { disponible = await conTiempo(KE_BIO.disponible(), 8, "verificar huella"); } catch (e) { console.warn(e.message); }
      const ofrecer = disponible && perfilActual.activo && !KE_BIO.activo(perfilActual.id) && !KE_BIO.rechazado();
      if (!ofrecer) { await redirigirPorRol(session); return; }
      paso("");
      formLogin.hidden = true; formClave.hidden = true; formMFA.hidden = true; $("#panelHuella").hidden = false;
    } catch (e) {
      mostrar("Aviso: " + e.message, "warn");
      await redirigirPorRol(session);
    }
  }
  // Tras validar contraseña: ¿hace falta el segundo paso?
  async function trasContrasena(session) {
    sesionActual = session;
    paso("Comprobando verificación en dos pasos…");
    if (await requiereSegundoPaso()) { pedirCodigo(); return; }
    await continuarTrasVerificar(session);
  }

  $("#btnActivarHuella").addEventListener("click", async () => {
    try { await KE_BIO.registrar(perfilActual); toast("Huella activada", "success"); }
    catch (e) { mostrar("No se pudo activar la huella (" + e.message + "). Podrás intentarlo luego desde el botón 🔓 dentro de la app.", "warn"); }
    await redirigirPorRol(sesionActual);
  });
  $("#btnSinHuella").addEventListener("click", async () => { KE_BIO.marcarRechazo(); await redirigirPorRol(sesionActual); });

  // IMPORTANTE: no usar "await" de llamadas a Supabase dentro de este evento (se bloquea);
  // por eso el trabajo se difiere con setTimeout.
  sb.auth.onAuthStateChange((evento, session) => {
    if (evento === "PASSWORD_RECOVERY") esperandoClave = true;
    if (!session) return;
    sesionActual = session;
    setTimeout(async () => {
      if (esperandoClave) {
        formLogin.hidden = true; formClave.hidden = false;
      } else if (evento === "SIGNED_IN") {
        if (!procesandoIngreso) { procesandoIngreso = true; await trasContrasena(session); }
      } else if (evento === "INITIAL_SESSION") {
        if (!procesandoIngreso) {
          procesandoIngreso = true;
          // ya tenía sesión: si su cuenta exige 2FA y aún no lo pasó, pedir el código
          if (await requiereSegundoPaso()) { pedirCodigo(); return; }
          await redirigirPorRol(session);
        }
      }
    }, 0);
  });

  formLogin.addEventListener("submit", async (e) => {
    e.preventDefault();
    mostrar("");
    const btn = $("#btnLogin"); btn.disabled = true; btn.textContent = "Ingresando…";
    paso("Validando contraseña…");
    let data, error;
    try {
      ({ data, error } = await conTiempo(sb.auth.signInWithPassword({ email: KE.aCorreoUsuario($("#email").value), password: $("#password").value }), 25, "validar contraseña"));
    } catch (e2) { error = e2; }
    if (error) { mostrar(mensajeError(error)); paso(""); btn.disabled = false; btn.textContent = "Ingresar"; return; }
    if (data && data.session && !procesandoIngreso) { procesandoIngreso = true; await trasContrasena(data.session); }
  });

  $("#btnReset").addEventListener("click", async () => {
    const email = $("#email").value.trim();
    if (!email) { mostrar("Escribe tu correo y vuelve a presionar el enlace.", "warn"); return; }
    if (KE.esCedula(email)) { mostrar("Los conductores no pueden restablecer la contraseña por correo. Pide al administrador que te asigne una nueva.", "warn"); return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split("#")[0] });
    if (error) mostrar(mensajeError(error));
    else mostrar("Te enviamos un correo con el enlace para restablecer tu contraseña.", "info");
  });

  formClave.addEventListener("submit", async (e) => {
    e.preventDefault();
    const c1 = $("#clave1").value, c2 = $("#clave2").value;
    if (c1.length < 8) { mostrar("La contraseña debe tener al menos 8 caracteres."); return; }
    if (c1 !== c2) { mostrar("Las contraseñas no coinciden."); return; }
    const { error } = await sb.auth.updateUser({ password: c1 });
    if (error) { mostrar(mensajeError(error)); return; }
    toast("Contraseña guardada", "success");
    esperandoClave = false;
    history.replaceState(null, "", location.pathname);
    await trasContrasena(sesionActual || (await sb.auth.getSession()).data.session);
  });
})();
