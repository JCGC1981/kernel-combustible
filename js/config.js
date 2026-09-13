// ============================================================
//  CONFIGURACIÓN — Kernel Energy · Control de Combustible
//  Reemplaza los dos valores de Supabase con los de TU proyecto:
//  Supabase → Project Settings → API
// ============================================================
window.KE_CONFIG = {
  SUPABASE_URL: "https://wkdujsrafumcbjoalpfb.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndrZHVqc3JhZnVtY2Jqb2FscGZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzMzU2ODksImV4cCI6MjEwNDkxMTY4OX0.yWHx21doBAF5W0IinSUxz591f4kpgcX9Lv40ArCYcCg",

  EMPRESA: "Kernel Energy S.A.S.",
  BUCKET_RECIBOS: "recibos",          // nombre del bucket de Storage
  ZONA_HORARIA: "America/Bogota",
  TIPOS_COMBUSTIBLE: ["Corriente", "Extra", "Diésel (ACPM)", "GNV"],
  MEDIOS_RECARGA: ["Transferencia", "Efectivo", "Tarjeta corporativa", "Chip / Tarjeta de combustible", "Otro"],
};
