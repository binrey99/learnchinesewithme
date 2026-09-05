-- Per-account learning progress for vocabulary and translation practice.

create table if not exists public.learning_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  vocabulary_learned integer not null default 0 check (vocabulary_learned >= 0),
  translation_answered integer not null default 0 check (translation_answered >= 0),
  translation_correct integer not null default 0 check (translation_correct >= 0),
  translation_incorrect integer not null default 0 check (translation_incorrect >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (translation_answered = translation_correct + translation_incorrect)
);

alter table public.learning_progress enable row level security;

drop policy if exists "Users can view their own learning progress" on public.learning_progress;
create policy "Users can view their own learning progress"
  on public.learning_progress for select
  to authenticated
  using (auth.uid() = user_id);

create or replace function public.update_learning_progress(
  p_vocabulary_delta integer default 0,
  p_translation_correct_delta integer default 0,
  p_translation_incorrect_delta integer default 0
)
returns public.learning_progress
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.learning_progress;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to update learning progress';
  end if;

  if p_vocabulary_delta < 0
    or p_translation_correct_delta < 0
    or p_translation_incorrect_delta < 0 then
    raise exception 'Progress increments cannot be negative';
  end if;

  insert into public.learning_progress (
    user_id,
    vocabulary_learned,
    translation_answered,
    translation_correct,
    translation_incorrect
  )
  values (
    auth.uid(),
    p_vocabulary_delta,
    p_translation_correct_delta + p_translation_incorrect_delta,
    p_translation_correct_delta,
    p_translation_incorrect_delta
  )
  on conflict (user_id) do update set
    vocabulary_learned = learning_progress.vocabulary_learned + excluded.vocabulary_learned,
    translation_answered = learning_progress.translation_answered + excluded.translation_answered,
    translation_correct = learning_progress.translation_correct + excluded.translation_correct,
    translation_incorrect = learning_progress.translation_incorrect + excluded.translation_incorrect,
    updated_at = timezone('utc', now())
  returning * into result;

  return result;
end;
$$;

revoke all on function public.update_learning_progress(integer, integer, integer) from public;
grant execute on function public.update_learning_progress(integer, integer, integer) to authenticated;

drop trigger if exists learning_progress_updated_at on public.learning_progress;
create or replace function public.learning_progress_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create trigger learning_progress_updated_at
  before update on public.learning_progress
  for each row execute procedure public.learning_progress_set_updated_at();
