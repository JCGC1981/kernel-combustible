-- ============================================================
--  Kernel Energy · Control de Combustible
--  Esquema de base de datos + seguridad (RLS) + Storage
--  Ejecutar COMPLETO en: Supabase → SQL Editor → New query → Run
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- 1. PERFILES (uno por usuario de Authentication)
-- ------------------------------------------------------------
create table if not exists public.perfiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  nombre      text not null default '',
  telefono    text,
  rol         text not null default 'conductor' check (rol in ('admin', 'conductor')),
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);

-- Crea el perfil automáticamente cuando se crea un usuario en Authentication
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfiles (id, email, nombre)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ¿El usuario actual es administrador activo?
create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.perfiles
    where id = auth.uid() and rol = 'admin' and activo
  );
$$;

-- ------------------------------------------------------------
-- 2. VEHÍCULOS
-- ------------------------------------------------------------
create table if not exists public.vehiculos (
  placa                     text primary key,
  tipo                      text not null,               -- Camioneta / Automóvil / Moto...
  marca_modelo              text not null,               -- Nissan NP300 Frontier
  anio                      int,
  color                     text,
  combustible_predeterminado text default 'Diésel (ACPM)',
  conductor_id              uuid references public.perfiles(id) on delete set null,
  activo                    boolean not null default true,
  creado_en                 timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 3. RECARGAS (dinero que el administrador carga al fondo de combustible, en COP)
-- ------------------------------------------------------------
create table if not exists public.recargas (
  id          uuid primary key default gen_random_uuid(),
  fecha       date not null default current_date,
  valor       numeric(14,2) not null check (valor > 0),
  medio       text,
  referencia  text,
  descripcion text,
  creado_por  uuid references public.perfiles(id),
  creado_en   timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 4. TANQUEOS (cada recibo enviado por un conductor)
-- ------------------------------------------------------------
create table if not exists public.tanqueos (
  id               uuid primary key default gen_random_uuid(),
  fecha_tanqueo    timestamptz not null default now(),
  numero_recibo    text not null,
  placa            text not null references public.vehiculos(placa),
  conductor_id     uuid not null references public.perfiles(id),
  tipo_combustible text not null,
  galones          numeric(10,3) not null check (galones > 0),
  valor_galon      numeric(12,2) not null check (valor_galon > 0),
  valor_total      numeric(14,2) generated always as (round(galones * valor_galon, 0)) stored,
  kilometraje      integer,
  estacion         text,
  ciudad           text,
  observaciones    text,
  foto_path        text,                                  -- ruta en Storage (bucket recibos)
  origen           text not null default 'manual' check (origen in ('manual', 'ocr')),  -- ¿los datos los leyó la app?
  texto_ocr        text,                                  -- texto reconocido en la foto (trazabilidad)
  campos_ocr       jsonb,                                 -- valores que la app leyó antes de que el conductor los revisara
  estado           text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'rechazado')),
  motivo_rechazo   text,
  revisado_por     uuid references public.perfiles(id),
  revisado_en      timestamptz,
  creado_en        timestamptz not null default now()
);

-- (si la tabla ya existía de una versión anterior, agrega las columnas de lectura automática)
alter table public.tanqueos add column if not exists origen     text not null default 'manual';
alter table public.tanqueos add column if not exists texto_ocr  text;
alter table public.tanqueos add column if not exists campos_ocr jsonb;

create index if not exists tanqueos_fecha_idx     on public.tanqueos (fecha_tanqueo desc);
create index if not exists tanqueos_placa_idx     on public.tanqueos (placa);
create index if not exists tanqueos_conductor_idx on public.tanqueos (conductor_id);
create index if not exists tanqueos_estado_idx    on public.tanqueos (estado);
-- Evita registrar dos veces el mismo recibo para la misma placa
create unique index if not exists tanqueos_recibo_placa_uidx on public.tanqueos (placa, numero_recibo);

-- ------------------------------------------------------------
-- 5. SEGURIDAD (Row Level Security)
-- ------------------------------------------------------------
alter table public.perfiles  enable row level security;
alter table public.vehiculos enable row level security;
alter table public.recargas  enable row level security;
alter table public.tanqueos  enable row level security;

-- PERFILES: cada quien ve el suyo; el admin ve y edita todos
drop policy if exists perfiles_select on public.perfiles;
create policy perfiles_select on public.perfiles
  for select to authenticated
  using (id = auth.uid() or public.es_admin());

drop policy if exists perfiles_update_admin on public.perfiles;
create policy perfiles_update_admin on public.perfiles
  for update to authenticated
  using (public.es_admin()) with check (public.es_admin());

drop policy if exists perfiles_delete_admin on public.perfiles;
create policy perfiles_delete_admin on public.perfiles
  for delete to authenticated
  using (public.es_admin());

-- VEHÍCULOS: todos los usuarios ven los activos; solo el admin crea/edita/borra
drop policy if exists vehiculos_select on public.vehiculos;
create policy vehiculos_select on public.vehiculos
  for select to authenticated
  using (activo or public.es_admin());

drop policy if exists vehiculos_admin_all on public.vehiculos;
create policy vehiculos_admin_all on public.vehiculos
  for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- RECARGAS: exclusivas del administrador
drop policy if exists recargas_admin_all on public.recargas;
create policy recargas_admin_all on public.recargas
  for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- TANQUEOS: el conductor solo crea y ve los suyos (siempre en estado pendiente);
--           el admin ve, edita, aprueba/rechaza y borra todos
drop policy if exists tanqueos_select on public.tanqueos;
create policy tanqueos_select on public.tanqueos
  for select to authenticated
  using (conductor_id = auth.uid() or public.es_admin());

drop policy if exists tanqueos_insert on public.tanqueos;
create policy tanqueos_insert on public.tanqueos
  for insert to authenticated
  with check (
    public.es_admin()
    or (conductor_id = auth.uid() and estado = 'pendiente')
  );

drop policy if exists tanqueos_update_admin on public.tanqueos;
create policy tanqueos_update_admin on public.tanqueos
  for update to authenticated
  using (public.es_admin()) with check (public.es_admin());

drop policy if exists tanqueos_delete_admin on public.tanqueos;
create policy tanqueos_delete_admin on public.tanqueos
  for delete to authenticated
  using (public.es_admin());

-- ------------------------------------------------------------
-- 6. STORAGE: bucket privado "recibos" para las fotos
--    Cada conductor sube a su carpeta (<uid>/archivo.jpg) y solo puede ver la suya;
--    el admin ve todas.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recibos', 'recibos', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists recibos_insert on storage.objects;
create policy recibos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'recibos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists recibos_select on storage.objects;
create policy recibos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'recibos'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.es_admin())
  );

drop policy if exists recibos_delete on storage.objects;
create policy recibos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'recibos' and public.es_admin());

-- ------------------------------------------------------------
-- 6b. TIEMPO REAL: el panel del admin se actualiza solo cuando llega un recibo
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tanqueos'
  ) then
    alter publication supabase_realtime add table public.tanqueos;
  end if;
end $$;

-- ------------------------------------------------------------
-- 7. DATOS INICIALES: flota de Kernel Energy
--    (el conductor se asigna desde la app una vez creados los usuarios)
-- ------------------------------------------------------------
insert into public.vehiculos (placa, tipo, marca_modelo, anio, color, combustible_predeterminado) values
  ('LPN205', 'Camioneta', 'Chevrolet NHR DC EVI',    2026, 'Blanco', 'Diésel (ACPM)'),
  ('KST307', 'Camioneta', 'Nissan NP300 Frontier',   2022, 'Plata',  'Diésel (ACPM)'),
  ('NYU846', 'Camioneta', 'Nissan NP300 Frontier',   2026, 'Plata',  'Diésel (ACPM)'),
  ('JOL153', 'Camioneta', 'Nissan NP300 Frontier',   2020, 'Rojo',   'Diésel (ACPM)'),
  ('LZQ931', 'Automóvil', 'KIA K3 Cross',            2025, 'Blanco', 'Corriente')
on conflict (placa) do nothing;

-- ------------------------------------------------------------
-- 7b. CONDUCTORES CREADOS DESDE LA APP (ingreso con cédula + contraseña)
--     Ver detalle en supabase/actualizacion-conductores.sql (se ejecuta después de este archivo)
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 8. DESPUÉS de crear tu usuario en Authentication → Users,
--    conviértelo en administrador ejecutando (con tu correo):
--
--    update public.perfiles set rol = 'admin', nombre = 'Administrador'
--    where email = 'CORREO_DEL_ADMINISTRADOR';
-- ------------------------------------------------------------
