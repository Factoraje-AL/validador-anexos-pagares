-- Estudio · hoja Datos. Se ejecuta una sola vez en el proyecto de Supabase del validador.
-- Todo queda limitado a cuentas con correo @activeleasing.com.mx.

-- Reglamento de la casa: una cuenta (nombre normalizado, en mayúsculas y sin acentos) → fila de Datos.
create table if not exists public.estudio_criterios (
  cuenta text primary key,
  fila   int  not null,
  nota   text,
  actualizado timestamptz not null default now()
);

-- Memoria por cliente: lo que un analista ya confirmó para las cuentas de ese cliente.
create table if not exists public.estudio_memoria (
  cliente text not null,
  cuenta  text not null,
  fila    int  not null,
  resta   boolean not null default false,
  usuario uuid default auth.uid(),
  actualizado timestamptz not null default now(),
  primary key (cliente, cuenta)
);

alter table public.estudio_criterios enable row level security;
alter table public.estudio_memoria  enable row level security;

create or replace function public.es_personal_al() returns boolean
language sql stable as $$ select coalesce(lower(auth.jwt() ->> 'email') like '%@activeleasing.com.mx', false) $$;

drop policy if exists estudio_criterios_leer on public.estudio_criterios;
create policy estudio_criterios_leer on public.estudio_criterios for select to authenticated using (public.es_personal_al());

drop policy if exists estudio_memoria_leer on public.estudio_memoria;
create policy estudio_memoria_leer on public.estudio_memoria for select to authenticated using (public.es_personal_al());
drop policy if exists estudio_memoria_guardar on public.estudio_memoria;
create policy estudio_memoria_guardar on public.estudio_memoria for insert to authenticated with check (public.es_personal_al());
drop policy if exists estudio_memoria_cambiar on public.estudio_memoria;
create policy estudio_memoria_cambiar on public.estudio_memoria for update to authenticated using (public.es_personal_al()) with check (public.es_personal_al());

-- Plantilla en blanco del Estudio: bucket privado. El archivo se sube como "plantilla.xlsx" desde el panel de Supabase;
-- no va en el repositorio público.
insert into storage.buckets (id, name, public) values ('estudio', 'estudio', false) on conflict (id) do nothing;
drop policy if exists estudio_plantilla_leer on storage.objects;
create policy estudio_plantilla_leer on storage.objects for select to authenticated using (bucket_id = 'estudio' and public.es_personal_al());
