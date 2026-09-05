-- Recreate the translation exercise table from scratch.
-- This is safe to run after deleting the old table and fixes duplicate-constraint errors.

drop table if exists public.translation_exercises cascade;

create table public.translation_exercises (
  id bigint generated always as identity primary key,
  level text not null
    check (level in ('HSK 1', 'HSK 2', 'HSK 3', 'HSK 4', 'HSK 5', 'HSK 6')),
  lesson integer not null
    check (lesson between 1 and 20),
  question_vi text not null,
  answer_zh text not null,
  explanation text,
  created_at timestamptz not null default timezone('utc', now())
);

create index translation_exercises_level_idx
  on public.translation_exercises (level);

create index translation_exercises_level_lesson_idx
  on public.translation_exercises (level, lesson);

alter table public.translation_exercises enable row level security;

create policy "Translation exercises are readable by everyone"
  on public.translation_exercises
  for select
  to anon, authenticated
  using (true);
