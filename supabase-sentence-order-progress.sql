-- Stores each user's answer for sentence-ordering questions.
drop table if exists public.sentence_order_progress cascade;

create table public.sentence_order_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  level text not null check (level in ('HSK 1', 'HSK 2', 'HSK 3', 'HSK 4', 'HSK 5', 'HSK 6')),
  lesson integer not null check (lesson between 1 and 10),
  question_index integer not null check (question_index between 0 and 9),
  is_correct boolean not null default false,
  answered_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, level, lesson, question_index)
);

create index sentence_order_progress_user_level_idx
  on public.sentence_order_progress (user_id, level, lesson);

alter table public.sentence_order_progress enable row level security;

create policy "Users can read their sentence-order progress"
  on public.sentence_order_progress for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert their sentence-order progress"
  on public.sentence_order_progress for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their sentence-order progress"
  on public.sentence_order_progress for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
