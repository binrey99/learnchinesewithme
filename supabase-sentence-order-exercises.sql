-- Recreate the sentence-ordering exercise table.
drop table if exists public.sentence_order_exercises cascade;

create table public.sentence_order_exercises (
  id bigint generated always as identity primary key,
  level text not null check (level in ('HSK 1', 'HSK 2', 'HSK 3', 'HSK 4', 'HSK 5', 'HSK 6')),
  lesson integer not null check (lesson between 1 and 10),
  question_vi text not null,
  answer_zh text not null,
  words text not null,
  explanation text,
  created_at timestamptz not null default timezone('utc', now())
);

create index sentence_order_exercises_level_idx
  on public.sentence_order_exercises (level);
create index sentence_order_exercises_level_lesson_idx
  on public.sentence_order_exercises (level, lesson);

alter table public.sentence_order_exercises enable row level security;
create policy "Sentence ordering exercises are readable by everyone"
  on public.sentence_order_exercises
  for select
  to anon, authenticated
  using (true);
