-- ============================================================
--  ACTUALIZACIÓN: conductores creados desde la app (ingreso con cédula)
--  Ejecutar COMPLETO en: Supabase → SQL Editor → New query → Run
--  (es seguro ejecutarlo más de una vez)
-- ============================================================

-- 1. Cédula en el perfil
alter table public.perfiles add column if not exists cedula text;
create unique index if not exists perfiles_cedula_uidx on public.perfiles (cedula) where cedula is not null;

-- 2. Conductores autorizados por el administrador.
--    Solo se puede crear la cuenta de un conductor si el administrador lo registró aquí primero.
create table if not exists public.conductores_autorizados (
  cedula     text primary key,
  nombre     text not null,
  telefono   text,
  creado_por uuid references public.perfiles(id),
  creado_en  timestamptz not null default now()
);
alter table public.conductores_autorizados enable row level security;
drop policy if exists autorizados_admin_all on public.conductores_autorizados;
create policy autorizados_admin_all on public.conductores_autorizados
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

-- 3. Al crearse un usuario: si es una cuenta de conductor (cedula@conductores.kernelenergy.com)
--    debe estar autorizada; si no, se rechaza la creación.
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
    insert into public.perfiles (id, email, nombre, telefono, cedula, rol)
    values (new.id, new.email, v_aut.nombre, v_aut.telefono, v_cedula, 'conductor')
    on conflict (id) do nothing;
  else
    insert into public.perfiles (id, email, nombre)
    values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)))
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 4. El administrador puede asignar una nueva contraseña a un conductor desde la app
create or replace function public.admin_restablecer_clave(p_uid uuid, p_clave text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede asignar contraseñas';
  end if;
  if p_clave is null or length(p_clave) < 6 then
    raise exception 'La contraseña debe tener al menos 6 caracteres';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_clave, extensions.gen_salt('bf')),
         updated_at = now()
   where id = p_uid;
  if not found then
    raise exception 'Usuario no encontrado';
  end if;
end;
$$;
revoke all on function public.admin_restablecer_clave(uuid, text) from public;
grant execute on function public.admin_restablecer_clave(uuid, text) to authenticated;
