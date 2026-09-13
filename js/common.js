/* Utilidades compartidas: cliente Supabase, formatos, sesión, imágenes */
(function () {
  const cfg = window.KE_CONFIG || {};
  const sinConfigurar = !cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("TU-PROYECTO") || !cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_ANON_KEY.startsWith("TU_");

  if (sinConfigurar) {
    document.addEventListener("DOMContentLoaded", () => {
      document.body.innerHTML = `
        <div class="config-error">
          <h2>Falta configurar Supabase</h2>
          <p>Abre el archivo <code>js/config.js</code> y reemplaza <code>SUPABASE_URL</code> y
          <code>SUPABASE_ANON_KEY</code> con los valores de tu proyecto
          (Supabase → Project Settings → API). Luego vuelve a publicar en GitHub.</p>
        </div>`;
    });
    window.KE_SIN_CONFIG = true;
    return;
  }

  window.sb = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
})();

window.KE = (function () {
  const cfg = window.KE_CONFIG || {};
  const TZ = cfg.ZONA_HORARIA || "America/Bogota";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const fmtCOP = (n) =>
    new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Number(n) || 0);
  const fmtNum = (n, dec = 2) =>
    new Intl.NumberFormat("es-CO", { minimumFractionDigits: 0, maximumFractionDigits: dec }).format(Number(n) || 0);
  const fmtFechaHora = (iso) =>
    iso ? new Date(iso).toLocaleString("es-CO", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
  const fmtFecha = (iso) => {
    if (!iso) return "—";
    // fechas tipo 'YYYY-MM-DD' se muestran tal cual (sin corrimiento de zona horaria)
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; }
    return new Date(iso).toLocaleDateString("es-CO", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
  };
  // 'YYYY-MM' del instante en hora de Bogotá
  const mesDe = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ }).slice(0, 7);
  const diaDe = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
  const hoyISO = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  const nombreMes = (ym) => {
    const [y, m] = ym.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("es-CO", { month: "short", year: "2-digit" });
  };
  // valor para <input type="datetime-local"> con la hora local del dispositivo
  const aDatetimeLocal = (d = new Date()) => {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const escapeHtml = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let toastTimer;
  function toast(msg, tipo = "") {
    let el = $("#toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; document.body.appendChild(el); }
    el.textContent = msg;
    el.className = `show ${tipo}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = ""), 3500);
  }

  async function getPerfil() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return null;
    const { data } = await sb.from("perfiles").select("*").eq("id", user.id).maybeSingle();
    return data || { id: user.id, email: user.email, nombre: user.email, rol: "conductor", activo: true };
  }

  /** Exige sesión (y opcionalmente rol). Redirige si no cumple. */
  async function requireAuth(rol) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.replace("index.html"); return new Promise(() => {}); }
    const perfil = await getPerfil();
    if (!perfil.activo) {
      await sb.auth.signOut();
      alert("Tu usuario está inactivo. Contacta al administrador.");
      location.replace("index.html");
      return new Promise(() => {});
    }
    if (rol === "admin" && perfil.rol !== "admin") { location.replace("conductor.html"); return new Promise(() => {}); }
    return { session, perfil };
  }

  async function logout() {
    await sb.auth.signOut();
    location.replace("index.html");
  }

  /** Redimensiona y comprime una imagen a JPEG (máx. lado `maxLado`). */
  function comprimirImagen(file, maxLado = 1600, calidad = 0.82) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
        const w = Math.round(img.width * escala), h = Math.round(img.height * escala);
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("No se pudo procesar la imagen"))), "image/jpeg", calidad);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Archivo de imagen no válido")); };
      img.src = url;
    });
  }

  async function urlFoto(path, segundos = 3600) {
    if (!path) return null;
    const { data, error } = await sb.storage.from(cfg.BUCKET_RECIBOS || "recibos").createSignedUrl(path, segundos);
    if (error) { console.warn(error); return null; }
    return data.signedUrl;
  }

  /** Descarga un CSV (separador ; para Excel en español). */
  function descargarCSV(nombre, filas) {
    const esc = (v) => { const s = String(v ?? ""); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = "﻿" + filas.map((f) => f.map(esc).join(";")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = nombre; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function mensajeError(error) {
    const m = (error && error.message) || String(error);
    if (/duplicate key|tanqueos_recibo_placa_uidx/i.test(m)) return "Ya existe un tanqueo con ese número de recibo para esa placa.";
    if (/row-level security/i.test(m)) return "No tienes permiso para realizar esta acción.";
    if (/Invalid login credentials/i.test(m)) return "Correo o contraseña incorrectos.";
    if (/Email not confirmed/i.test(m)) return "El correo no ha sido confirmado.";
    if (/Failed to fetch|NetworkError/i.test(m)) return "Sin conexión. Verifica tu internet e intenta de nuevo.";
    return m;
  }

  // Registro del service worker (PWA)
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
  }

  return { $, $$, cfg, TZ, fmtCOP, fmtNum, fmtFecha, fmtFechaHora, mesDe, diaDe, hoyISO, nombreMes, aDatetimeLocal,
           escapeHtml, toast, getPerfil, requireAuth, logout, comprimirImagen, urlFoto, descargarCSV, mensajeError };
})();
