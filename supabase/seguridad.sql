-- ============================================================
--  REFUERZO DE SEGURIDAD
--  Ejecutar COMPLETO en: Supabase → SQL Editor → New query → Run
--  (después de schema.sql y actualizacion-conductores.sql; seguro de repetir)
-- ============================================================

-- ------------------------------------------------------------
-- 1. Solo usuarios ACTIVOS tienen permisos. Los administradores que activaron
--    la verificación en dos pasos (2FA) deben haberla superado (aal2) para
--    cualquier operación de administrador, incluso llamando a la API directamente.
-- ------------------------------------------------------------
create or replace function public.es_activo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and activo);
$$;

create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
           select 1 from public.perfiles
           where id = auth.uid() and rol = 'admin' and activo
         )
     and (
           coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
           or not exists (
             select 1 from auth.mfa_factors
             where user_id = auth.uid() and status = 'verified'
           )
         );
$$;

-- ------------------------------------------------------------
-- 2. Cuentas no autorizadas quedan INACTIVAS. Solo se activan automáticamente
--    los conductores creados por el administrador desde la app.
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cedula text;
  v_aut    public.conductores_autorizados%rowtype;
begin
  if new.email ~ '^[0-9]{5,15}@conductores\.kernelenergy\.com$' then
    v_cedula := split_part(new.email, '@', 1);
    select * into v_aut from public.conductores_autorizados where cedula = v_cedula;
    if not found then
      raise exception 'Conductor con cédula % no autorizado por el administrador', v_cedula;
    end if;
    insert into public.perfiles (id, email, nombre, telefono, cedula, rol, activo)
    values (new.id, new.email, v_aut.nombre, v_aut.telefono, v_cedula, 'conductor', true)
    on conflict (id) do nothing;
  else
    -- Usuario con correo (creado en el panel de Supabase o por registro externo):
    -- queda INACTIVO hasta que el administrador lo active o lo promueva.
    insert into public.perfiles (id, email, nombre, rol, activo)
    values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)), 'conductor', false)
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 3. Políticas: todo acceso de conductor exige usuario activo
-- ------------------------------------------------------------
drop policy if exists vehiculos_select on public.vehiculos;
create policy vehiculos_select on public.vehiculos
  for select to authenticated
  using ((activo and public.es_activo()) or public.es_admin());

drop policy if exists tanqueos_select on public.tanqueos;
create policy tanqueos_select on public.tanqueos
  for select to authenticated
  using ((conductor_id = auth.uid() and public.es_activo()) or public.es_admin());

drop policy if exists tanqueos_insert on public.tanqueos;
create policy tanqueos_insert on public.tanqueos
  for insert to authenticated
  with check (
    public.es_admin()
    or (conductor_id = auth.uid() and estado = 'pendiente' and public.es_activo())
  );

drop policy if exists recibos_insert on storage.objects;
create policy recibos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'recibos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.es_activo()
  );

drop policy if exists recibos_select on storage.objects;
create policy recibos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'recibos'
    and (((storage.foldername(name))[1] = auth.uid()::text and public.es_activo()) or public.es_admin())
  );

-- ------------------------------------------------------------
-- 4. AUDITORÍA inalterable: quién hizo qué y cuándo.
--    Nadie (ni el administrador) puede modificar o borrar el historial desde la app.
-- ------------------------------------------------------------
create table if not exists public.auditoria (
  id         bigserial primary key,
  fecha      timestamptz not null default now(),
  usuario_id uuid,
  usuario    text,
  tabla      text not null,
  operacion  text not null,      -- INSERT / UPDATE / DELETE
  registro   text,               -- id o placa del registro afectado
  antes      jsonb,
  despues    jsonb
);
create index if not exists auditoria_fecha_idx on public.auditoria (fecha desc);
alter table public.auditoria enable row level security;
drop policy if exists auditoria_select_admin on public.auditoria;
create policy auditoria_select_admin on public.auditoria
  for select to authenticated using (public.es_admin());
-- (sin políticas de insert/update/delete: solo el trigger, que corre con privilegios, escribe)

create or replace function public.registrar_auditoria()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_registro text;
  v_usuario  text;
begin
  select coalesce(nombre, email) into v_usuario from public.perfiles where id = auth.uid();
  if tg_op = 'DELETE' then
    v_registro := coalesce(to_jsonb(old) ->> 'id', to_jsonb(old) ->> 'placa', to_jsonb(old) ->> 'cedula');
    insert into public.auditoria (usuario_id, usuario, tabla, operacion, registro, antes)
    values (auth.uid(), v_usuario, tg_table_name, tg_op, v_registro, to_jsonb(old));
    return old;
  elsif tg_op = 'UPDATE' then
    v_registro := coalesce(to_jsonb(new) ->> 'id', to_jsonb(new) ->> 'placa', to_jsonb(new) ->> 'cedula');
    insert into public.auditoria (usuario_id, usuario, tabla, operacion, registro, antes, despues)
    values (auth.uid(), v_usuario, tg_table_name, tg_op, v_registro, to_jsonb(old), to_jsonb(new));
    return new;
  else
    v_registro := coalesce(to_jsonb(new) ->> 'id', to_jsonb(new) ->> 'placa', to_jsonb(new) ->> 'cedula');
    insert into public.auditoria (usuario_id, usuario, tabla, operacion, registro, despues)
    values (auth.uid(), v_usuario, tg_table_name, tg_op, v_registro, to_jsonb(new));
    return new;
  end if;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['tanqueos', 'recargas', 'vehiculos', 'perfiles', 'conductores_autorizados'] loop
    execute format('drop trigger if exists auditoria_%s on public.%I', t, t);
    execute format('create trigger auditoria_%s after insert or update or delete on public.%I for each row execute procedure public.registrar_auditoria()', t, t);
  end loop;
end $$;
