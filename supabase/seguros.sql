-- ============================================================
--  SEGUROS DE LOS VEHÍCULOS: SOAT y Todo Riesgo
--  Ejecutar COMPLETO en: Supabase → SQL Editor → New query → Run
--  (después de schema.sql y seguridad.sql; seguro de repetir)
-- ============================================================

-- ------------------------------------------------------------
-- 1. Tabla: un registro por vehículo y tipo de seguro
-- ------------------------------------------------------------
create table if not exists public.seguros (
  id             uuid primary key default gen_random_uuid(),
  placa          text not null references public.vehiculos(placa) on delete cascade,
  tipo           text not null check (tipo in ('soat', 'todo_riesgo')),
  aseguradora    text,
  numero_poliza  text,
  fecha_inicio   date,
  fecha_fin      date not null,                -- vencimiento: la app avisa 30 días antes
  valor          numeric(14,2),                -- prima pagada (COP), opcional
  archivo_path   text,                         -- ruta en Storage (bucket seguros): foto o PDF
  archivo_tipo   text,                         -- image/jpeg · application/pdf
  observaciones  text,
  creado_por     uuid references public.perfiles(id),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (placa, tipo)
);
create index if not exists seguros_fecha_fin_idx on public.seguros (fecha_fin);

-- mantiene actualizado_en
create or replace function public.seguros_touch()
returns trigger language plpgsql as $$
begin new.actualizado_en := now(); return new; end; $$;
drop trigger if exists seguros_touch on public.seguros;
create trigger seguros_touch before update on public.seguros
  for each row execute procedure public.seguros_touch();

-- ------------------------------------------------------------
-- 2. Seguridad: exclusivo del administrador (con 2FA si la activó)
-- ------------------------------------------------------------
alter table public.seguros enable row level security;
drop policy if exists seguros_admin_all on public.seguros;
create policy seguros_admin_all on public.seguros
  for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- ------------------------------------------------------------
-- 3. Storage: bucket privado "seguros" (fotos o PDF), solo administrador
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('seguros', 'seguros', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists seguros_storage_admin on storage.objects;
create policy seguros_storage_admin on storage.objects
  for all to authenticated
  using (bucket_id = 'seguros' and public.es_admin())
  with check (bucket_id = 'seguros' and public.es_admin());

-- ------------------------------------------------------------
-- 4. Auditoría inalterable también para los seguros
-- ------------------------------------------------------------
drop trigger if exists auditoria_seguros on public.seguros;
create trigger auditoria_seguros after insert or update or delete on public.seguros
  for each row execute procedure public.registrar_auditoria();

-- ------------------------------------------------------------
-- 5. Tiempo real: el panel se actualiza al cambiar un seguro
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'seguros'
  ) then
    alter publication supabase_realtime add table public.seguros;
  end if;
end $$;
