/* Lectura automática del recibo de tanqueo (OCR en el celular con Tesseract.js, gratis, sin servidor).
   Uso: const r = await KE_OCR.leerRecibo(file, placasFlota, (pct, msg) => {...});
        r.texto   → texto reconocido
        r.campos  → { fecha, hora, numero_recibo, galones, valor_galon, valor_total, tipo_combustible, estacion, placa, kilometraje }
        r.detectados → lista de nombres de campos que sí se leyeron  */
window.KE_OCR = (function () {
  let worker = null;

  async function obtenerWorker(onProgress) {
    if (worker) return worker;
    if (!window.Tesseract) throw new Error("El módulo de lectura (OCR) no cargó. Verifica tu conexión.");
    worker = await Tesseract.createWorker("spa", 1, {
      logger: (m) => {
        if (!onProgress) return;
        if (m.status === "loading language traineddata" || m.status === "loading tesseract core") onProgress(Math.round((m.progress || 0) * 30), "Preparando lector…");
        else if (m.status === "recognizing text") onProgress(30 + Math.round((m.progress || 0) * 70), "Leyendo recibo…");
      },
    });
    await worker.setParameters({ preserve_interword_spaces: "1" });
    return worker;
  }

  /** Prepara la imagen para OCR: escala a máx. 2000 px, escala de grises y más contraste. */
  function prepararImagen(file, maxLado = 2000) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
        const w = Math.round(img.width * escala), h = Math.round(img.height * escala);
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        const im = ctx.getImageData(0, 0, w, h), d = im.data;
        const contraste = 1.35;
        for (let i = 0; i < d.length; i += 4) {
          let g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          g = (g - 128) * contraste + 128;
          d[i] = d[i + 1] = d[i + 2] = g < 0 ? 0 : g > 255 ? 255 : g;
        }
        ctx.putImageData(im, 0, 0);
        resolve(canvas);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Imagen no válida")); };
      img.src = url;
    });
  }

  // ---------- utilidades de interpretación ----------
  const sinTildes = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

  /** Convierte "10.250", "10,250", "10.250,00", "12,345" a número. `esDinero` asume valores enteros en COP. */
  function aNumero(str, esDinero) {
    if (!str) return null;
    let s = String(str).replace(/[^\d.,]/g, "");
    if (!s) return null;
    const puntos = (s.match(/\./g) || []).length, comas = (s.match(/,/g) || []).length;
    let n;
    if (puntos && comas) {
      // el último separador es el decimal
      const ultimo = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
      n = parseFloat(s.slice(0, ultimo).replace(/[.,]/g, "") + "." + s.slice(ultimo + 1));
    } else if (puntos || comas) {
      const sep = puntos ? "." : ",";
      const partes = s.split(sep);
      const dec = partes[partes.length - 1];
      if (esDinero) {
        // en dinero: ",00"/".00" es decimal; "10.250" son miles
        n = dec.length === 2 && partes.length === 2 ? parseFloat(partes[0] + "." + dec) : parseFloat(partes.join(""));
      } else {
        // en galones: 1 sola separación con 1-3 decimales → decimal (12.345 gal); si el resultado es enorme, eran miles
        n = partes.length === 2 ? parseFloat(partes[0] + "." + dec) : parseFloat(partes.join(""));
      }
    } else n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }

  function buscar(lineas, patrones, opts = {}) {
    for (const re of patrones) {
      for (const linea of lineas) {
        if (opts.evitar && opts.evitar.test(linea)) continue;
        const m = linea.match(re);
        if (m) return { valor: m[m.length - 1], linea };
      }
    }
    return null;
  }

  /** Interpreta el texto del recibo. Exportada también para pruebas. */
  function interpretar(textoCrudo, placasFlota = []) {
    const texto = sinTildes(textoCrudo).toUpperCase();
    const lineas = texto.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
    const campos = {};
    const NUM = "([\\d]{1,3}(?:[.,]\\d{3})*(?:[.,]\\d{1,3})?|\\d+(?:[.,]\\d+)?)";

    // Fecha y hora (primero AAAA-MM-DD, luego DD/MM/AAAA o DD/MM/AA)
    const iso = buscar(lineas, [/\b(20\d{2})[-\/.](0?[1-9]|1[0-2])[-\/.](0?[1-9]|[12]\d|3[01])\b/]);
    if (iso) {
      const m = iso.linea.match(/\b(20\d{2})[-\/.](0?[1-9]|1[0-2])[-\/.](0?[1-9]|[12]\d|3[01])\b/);
      campos.fecha = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    } else {
      const f = buscar(lineas, [/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4}|\d{2})\b/], { evitar: /NIT/ });
      if (f) {
        const m = f.linea.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4}|\d{2})\b/);
        let [, d, mo, y] = m; if (y.length === 2) y = "20" + y;
        d = +d; mo = +mo;
        if (mo > 12 && d <= 12) [d, mo] = [mo, d];
        if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) campos.fecha = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      }
    }
    const h = buscar(lineas, [/\b([01]?\d|2[0-3]):([0-5]\d)(?::\d{2})?\s*(AM|PM|A\.M\.|P\.M\.)?/]);
    if (h) {
      const m = h.linea.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::\d{2})?\s*(AM|PM|A\.M\.|P\.M\.)?/);
      let hh = +m[1]; const ap = (m[3] || "").replace(/\./g, "");
      if (ap === "PM" && hh < 12) hh += 12; if (ap === "AM" && hh === 12) hh = 0;
      campos.hora = `${String(hh).padStart(2, "0")}:${m[2]}`;
    }

    // Número de recibo / factura
    const r = buscar(lineas, [
      /(?:FACTURA|FACT|FAC|RECIBO|TICKET|TIQUETE|TIKET|COMPROBANTE|CONSECUTIVO|TRANSACCION|TRANSAC|TRANS|VENTA|DOC(?:UMENTO)?)\.?\s*(?:ELECTRONICA|DE VENTA|POS|N[O°º]?\.?|#)?\s*[:.\-]?\s*([A-Z]{0,5}\s?-?\s?\d{3,})/,
      /(?:^|\s)(?:N[O°º]\.?|NRO\.?|NUM\.?|NO\.|#)\s*[:.]?\s*([A-Z]{0,5}\s?-?\s?\d{3,})/,
    ], { evitar: /NIT|TEL|CEL|RES(?:OLUCION)?\b|DIAN|AUTORIZ|CAJA|SURTIDOR|MANGUERA|PLACA|KM\b|CLIENTE|ITEM|COD/ });
    if (r) campos.numero_recibo = r.valor.replace(/\s+/g, "").replace(/^-/, "");

    // Tipo de combustible
    if (/DIESEL|DISEL|ACPM|A\.C\.P\.M|B10|B12/.test(texto)) campos.tipo_combustible = "Diésel (ACPM)";
    else if (/\bGNV\b|GAS NATURAL|\bGNC\b/.test(texto)) campos.tipo_combustible = "GNV";
    else if (/\bEXTRA\b|PREMIUM|SUPER|\bE\s?95\b/.test(texto)) campos.tipo_combustible = "Extra";
    else if (/CORRIENTE|CTE\b|REGULAR|GASOLINA|MOTOR/.test(texto)) campos.tipo_combustible = "Corriente";

    // Galones
    const g = buscar(lineas, [
      new RegExp("(?:GALONES|GALON|GALS?\\b|GLS?\\b|CANTIDAD|CANT\\.?|VOLUMEN|VOL\\.?|LITROS|LTS?\\b)\\s*[:.=]?\\s*" + NUM),
      new RegExp(NUM + "\\s*(?:GALONES|GALON|GALS?\\b|GLS?\\b)"),
    ]);
    if (g) { const v = aNumero(g.valor, false); if (v && v > 0 && v < 500) campos.galones = /LITRO|LTS?\b/.test(g.linea) ? +(v / 3.785411784).toFixed(3) : v; }

    // Precio por galón
    const p = buscar(lineas, [
      new RegExp("(?:PRECIO(?:\\s*UNIT(?:ARIO)?)?|PREC\\.?|VLR\\.?\\s*UNIT\\.?|VALOR\\s*UNIT(?:ARIO)?|V\\.?\\s*UNIT\\.?|P\\.?\\s?UNIT\\.?|UNITARIO|\\$\\s?\\/\\s?GAL|X\\s?GAL|POR\\s?GALON|PPU|P\\.U\\.?)\\s*[:.=]?\\s*\\$?\\s*" + NUM),
    ]);
    if (p) { const v = aNumero(p.valor, true); if (v && v >= 1000 && v < 100000) campos.valor_galon = Math.round(v); }

    // Total (evitar SUBTOTAL, TOTAL IVA, etc.)
    const candidatosTotal = [];
    for (const linea of lineas) {
      if (!/TOTAL|VALOR\s*(?:A\s*PAGAR|VENTA|PAGADO)|PAGAR|IMPORTE/.test(linea)) continue;
      if (/SUB\s?TOTAL|IVA|IMPUESTO|DESC|CAMBIO|VUELTO|RECIB(?:IDO|E)|EFECTIVO|TARJETA|BASE|ITEMS|ARTICULOS|CANT/.test(linea)) continue;
      const nums = linea.match(/\d[\d.,]*/g) || [];
      for (const n of nums) { const v = aNumero(n, true); if (v && v >= 5000 && v < 5000000) candidatosTotal.push(v); }
    }
    if (candidatosTotal.length) campos.valor_total = Math.round(Math.max(...candidatosTotal));

    // Coherencia entre galones, precio y total
    const { galones, valor_galon, valor_total } = campos;
    if (galones && valor_galon && valor_total) {
      if (Math.abs(galones * valor_galon - valor_total) / valor_total > 0.03) {
        const gCalc = valor_total / valor_galon;
        if (gCalc > 0 && gCalc < 500) campos.galones = +gCalc.toFixed(3);
      }
    } else if (valor_galon && valor_total && !galones) campos.galones = +(valor_total / valor_galon).toFixed(3);
    else if (galones && valor_total && !valor_galon) { const v = Math.round(valor_total / galones); if (v >= 1000 && v < 100000) campos.valor_galon = v; }
    else if (galones && valor_galon && !valor_total) campos.valor_total = Math.round(galones * valor_galon);
    // Si el valor del total quedó por debajo de un galón, probablemente leímos mal
    if (campos.valor_total && campos.valor_galon && campos.valor_total < campos.valor_galon) delete campos.valor_total;

    // Estación
    const marcas = /TERPEL|PRIMAX|TEXACO|MOBIL|ESSO|BIOMAX|ZEUSS|PETROBRAS|BRIO|PUMA|PETROMIL|CHEVRON|GULF|ESTACION|E\.?D\.?S\.?|SERVICENTRO|BOMBA/;
    const e = lineas.find((l) => marcas.test(l) && !/NIT|TEL/.test(l)) || lineas.find((l) => /[A-Z]{4,}/.test(l) && !/NIT|FACTURA|FECHA|RESOLUCION/.test(l));
    if (e) campos.estacion = e.replace(/\b(NIT|TEL|CEL)\b.*$/, "").trim().slice(0, 60);

    // Placa (preferir una de la flota)
    const placasTexto = texto.replace(/[^A-Z0-9\n ]/g, " ").match(/\b[A-Z]{3}\s?\d{3}\b/g) || [];
    const normalizadas = placasTexto.map((x) => x.replace(/\s/g, ""));
    campos.placa = normalizadas.find((x) => placasFlota.includes(x)) || null;
    if (!campos.placa) { const pl = buscar(lineas, [/PLACA\s*[:.]?\s*([A-Z]{3}\s?-?\s?\d{3})/]); if (pl) campos.placa = pl.valor.replace(/[\s-]/g, ""); }
    if (!campos.placa) delete campos.placa;

    // Kilometraje
    const k = buscar(lineas, [/(?:KILOMETRAJE|KILOMETROS|ODOMETRO|KMS?\b)\s*[:.=]?\s*(\d{1,3}(?:[.,]\d{3})+|\d{4,7})/]);
    if (k) { const v = aNumero(k.valor, true); if (v && v > 0 && v < 3000000) campos.kilometraje = Math.round(v); }

    const detectados = Object.keys(campos).filter((c) => campos[c] !== null && campos[c] !== undefined && campos[c] !== "");
    return { campos, detectados };
  }

  async function leerRecibo(file, placasFlota = [], onProgress) {
    onProgress && onProgress(2, "Preparando imagen…");
    const canvas = await prepararImagen(file);
    const w = await obtenerWorker(onProgress);
    const { data } = await w.recognize(canvas);
    const texto = (data.text || "").trim();
    const { campos, detectados } = interpretar(texto, placasFlota);
    onProgress && onProgress(100, "Lectura terminada");
    return { texto, campos, detectados, confianza: data.confidence };
  }

  return { leerRecibo, interpretar, aNumero };
})();
