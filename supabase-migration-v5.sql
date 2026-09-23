-- יוצאים? — שדרוג v5: דירוגי יציאות והעדפות (בשביל ✨ רעיונות)
-- Supabase → SQL Editor → New query → הדביקו את כל הקובץ → Run
-- בטוח להריץ יותר מפעם אחת. לא נוגע בשום טבלה קיימת. האתר ממשיך לעבוד גם לפני שמריצים אותו.

-- 1) דירוג יציאה: כוכבים 1-5 + הערה אופציונלית. אדם אחד = דירוג אחד ליציאה.
create table if not exists outing_ratings (
  id          bigint generated always as identity primary key,
  event_id    bigint      not null references events(id) on delete cascade,
  rater_name  text        not null,
  stars       int         not null check (stars between 1 and 5),
  comment     text        check (comment is null or char_length(comment) <= 300),
  created_at  timestamptz not null default now(),
  unique (event_id, rater_name)
);
create index if not exists outing_ratings_event_idx on outing_ratings(event_id);

-- 2) העדפות אישיות (תגיות + טקסט חופשי). מפתח = השם, כמו בשאר האפליקציה.
create table if not exists user_prefs (
  name       text primary key,
  tags       text[]      not null default '{}',
  free_text  text        check (free_text is null or char_length(free_text) <= 300),
  updated_at timestamptz not null default now()
);

-- 3) RLS: כמו שאר הטבלאות (אין התחברות, מפתח ציבורי). לא לשמור כאן מידע פרטי.
alter table outing_ratings enable row level security;
alter table user_prefs     enable row level security;
drop policy if exists "anon all" on outing_ratings;
drop policy if exists "anon all" on user_prefs;
create policy "anon all" on outing_ratings for all to anon using (true) with check (true);
create policy "anon all" on user_prefs     for all to anon using (true) with check (true);
grant select, insert, update, delete on outing_ratings, user_prefs to anon;
grant usage, select on all sequences in schema public to anon;

notify pgrst, 'reload schema';
