-- Vocabulary table for LearnChineseWithMe.
-- Run this in Supabase SQL Editor, then import vocabulary.csv
-- from Table Editor > vocabulary > Insert > Import data from CSV.

create table if not exists public.vocabulary (
  id bigint generated always as identity primary key,
  app_level text,
  book_level text not null check (book_level in ('HSK 1', 'HSK 2', 'HSK 3', 'HSK 4', 'HSK 5', 'HSK 6')),
  quest_name text,
  quiz_id text,
  quiz_name text,
  vocab text not null,
  english_meaning text,
  vietnamese_meaning text,
  word_type text,
  photo text,
  component text,
  level_method text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists vocabulary_book_level_idx
  on public.vocabulary (book_level);

create index if not exists vocabulary_vocab_idx
  on public.vocabulary (vocab);

alter table public.vocabulary enable row level security;

drop policy if exists "Vocabulary is readable by everyone" on public.vocabulary;
create policy "Vocabulary is readable by everyone"
  on public.vocabulary for select
  to anon, authenticated
  using (true);

