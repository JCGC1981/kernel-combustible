/* Desbloqueo con huella / Face ID (WebAuthn, autenticador del propio dispositivo).
   Cómo funciona: el usuario entra una vez con contraseña; la sesión queda guardada en el
   dispositivo y, a partir de ahí, cada apertura de la app exige la huella para continuar.
   Si la sesión caduca o el usuario elige "Ingresar con contraseña", vuelve al login normal. */
window.KE_BIO = (function () {
  const CLAVE = "ke_bio";                 // localStorage: { uid, credId, email, nombre }
  const RECHAZO = "ke_bio_rechazado";     // el usuario dijo "ahora no" (no volver a preguntar)
  const DESBLOQUEADO = "ke_desbloqueado"; // sessionStorage: ya pasó la huella en esta apertura

  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const aleatorio = () => crypto.getRandomValues(new Uint8Array(32));

  function leer() { try { return JSON.parse(localStorage.getItem(CLAVE) || "null"); } catch { return null; } }

  async function disponible() {
    try {
      return !!(window.PublicKeyCredential && window.isSecureContext &&
        (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()));
    } catch { return false; }
  }
  const activo = (uid) => { const d = leer(); return !!(d && (!uid || d.uid === uid)); };
  const rechazado = () => localStorage.getItem(RECHAZO) === "1";
  const marcarRechazo = () => localStorage.setItem(RECHAZO, "1");
  const marcarDesbloqueado = () => sessionStorage.setItem(DESBLOQUEADO, "1");
  const yaDesbloqueado = () => sessionStorage.getItem(DESBLOQUEADO) === "1";

  /** Registra la huella del dispositivo para este usuario (debe llamarse desde un clic). */
  async function registrar(usuario) {
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: aleatorio(),
        rp: { name: "Kernel Energy · Combustible" },
        user: { id: new TextEncoder().encode(usuario.id), name: usuario.email, displayName: usuario.nombre || usuario.email },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
        timeout: 60000,
        attestation: "none",
      },
    });
    localStorage.setItem(CLAVE, JSON.stringify({ uid: usuario.id, credId: b64(cred.rawId), email: usuario.email, nombre: usuario.nombre }));
    localStorage.removeItem(RECHAZO);
    marcarDesbloqueado();
    return true;
  }

  /** Pide la huella. Devuelve true si el dispositivo la verificó. */
  async function verificar() {
    const d = leer(); if (!d) return false;
    try {
      const r = await navigator.credentials.get({
        publicKey: {
          challenge: aleatorio(),
          allowCredentials: [{ type: "public-key", id: unb64(d.credId), transports: ["internal"] }],
          userVerification: "required",
          timeout: 60000,
        },
      });
      if (r) { marcarDesbloqueado(); return true; }
    } catch (e) { console.warn("Huella:", e.name, e.message); }
    return false;
  }

  function desactivar() { localStorage.removeItem(CLAVE); sessionStorage.removeItem(DESBLOQUEADO); }

  /** Pantalla de bloqueo. Resuelve cuando la huella es válida; si el usuario elige contraseña, cierra sesión y va al login. */
  function bloquear(perfil, alUsarClave) {
    return new Promise((resolve) => {
      const d = leer();
      const div = document.createElement("div");
      div.className = "bio-lock";
      div.innerHTML = `
        <div class="bio-card">
          <img src="assets/logo-kernel.png" alt="Kernel Energy" class="bio-logo">
          <p class="bio-hola">Hola, <strong>${(perfil && perfil.nombre) || (d && d.nombre) || ""}</strong></p>
          <button class="btn primary big block" id="bioBtn">🔒 Desbloquear con huella</button>
          <p class="bio-msg muted small" id="bioMsg"></p>
          <button class="link" id="bioClave">Ingresar con contraseña</button>
        </div>`;
      document.body.appendChild(div);
      document.body.style.overflow = "hidden";
      const btn = div.querySelector("#bioBtn"), msg = div.querySelector("#bioMsg");
      async function intentar() {
        btn.disabled = true; msg.textContent = "Verificando…";
        const ok = await verificar();
        if (ok) { div.remove(); document.body.style.overflow = ""; resolve(true); return; }
        btn.disabled = false; msg.textContent = "No se pudo verificar la huella. Intenta de nuevo o usa tu contraseña.";
      }
      btn.addEventListener("click", intentar);
      div.querySelector("#bioClave").addEventListener("click", () => { div.remove(); alUsarClave(); });
      setTimeout(intentar, 350); // intento automático al abrir
    });
  }

  return { disponible, activo, rechazado, marcarRechazo, marcarDesbloqueado, yaDesbloqueado, registrar, verificar, desactivar, bloquear, datos: leer };
})();
