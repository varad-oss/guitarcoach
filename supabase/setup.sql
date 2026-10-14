-- GuitarCoach sync: run once in the Supabase dashboard (SQL Editor → New query → Run).
-- Safe to run again.

-- One row per synced item (a song, recording, practice session, settings, calibration).
create table if not exists public.records (
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  store text not null check (store in ('songs', 'recordings', 'sessions', 'kv')),
  id text not null,
  data jsonb,
  deleted boolean not null default false,
  -- Client clock (ms) of the change; the newer change wins a conflict.
  modified bigint not null,
  -- Server clock; devices ask for "everything changed since …".
  updated_at timestamptz not null default now(),
  primary key (user_id, store, id)
);

create index if not exists records_user_updated on public.records (user_id, updated_at);

create or replace function public.records_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists records_touch on public.records;
create trigger records_touch before insert or update on public.records
for each row execute function public.records_touch();

-- Only the signed-in owner can see or change their rows.
alter table public.records enable row level security;
drop policy if exists "own records" on public.records;
create policy "own records" on public.records
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Uploaded recordings: private bucket, one folder per user (<user id>/<recording id>).
insert into storage.buckets (id, name, public, file_size_limit)
values ('audio', 'audio', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

drop policy if exists "own audio read" on storage.objects;
drop policy if exists "own audio write" on storage.objects;
drop policy if exists "own audio update" on storage.objects;
drop policy if exists "own audio delete" on storage.objects;
create policy "own audio read" on storage.objects for select to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own audio write" on storage.objects for insert to authenticated
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own audio update" on storage.objects for update to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own audio delete" on storage.objects for delete to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
