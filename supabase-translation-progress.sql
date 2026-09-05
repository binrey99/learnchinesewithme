-- Stores each user's result for every translation question and direction.
drop table if exists public.translation_progress cascade;

create table public.translation_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  level text not null check (level in ('HSK 1', 'HSK 2', 'HSK 3', 'HSK 4', 'HSK 5', 'HSK 6')),
  lesson integer not null check (lesson between 1 and 20),
  direction text not null check (direction in ('vi-zh', 'zh-vi')),
  question_index integer not null check (question_index between 0 and 9),
  is_correct boolean not null default false,
  answered_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, level, lesson, direction, question_index)
);

create index translation_progress_user_level_idx
  on public.translation_progress (user_id, level, lesson, direction);

alter table public.translation_progress enable row level security;

create policy "Users can read their translation progress"
  on public.translation_progress for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert their translation progress"
  on public.translation_progress for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their translation progress"
  on public.translation_progress for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
