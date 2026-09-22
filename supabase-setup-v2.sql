-- יוצאים? — מסד הנתונים
-- Supabase → SQL Editor → New query → הדביקו את כל הקובץ → Run

-- אם כבר הרצתם את ה-SQL של הגרסה הקודמת (הטבלאות people / events / rsvps),
-- הבלוק הזה מוחק אותן (נתוני בדיקה בלבד) כדי שהמבנה החדש ייווצר נקי.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'events' and column_name = 'starts_at') then
    drop table if exists rsvps;
    drop table if exists people;
    drop table events cascade;
  end if;
end $$;

create table if not exists events (
  id         bigint generated always as identity primary key,
  title      text        not null,
  type       text        not null,   -- בר / חוף / מסיבה ...
  location   text        not null,
  "date"     date        not null,
  "time"     time        not null,
  transport  text        not null default 'לא ידוע',   -- רכב / אוטובוס ...
  created_at timestamptz not null default now()
);

create table if not exists participants (
  id         bigint generated always as identity primary key,
  event_id   bigint      not null references events(id) on delete cascade,
  name       text        not null,
  status     text        not null check (status in ('going','maybe','not_going')),
  created_at timestamptz not null default now(),
  unique (event_id, name)            -- אדם אחד = סטטוס אחד ביציאה
);

create index if not exists participants_event_idx on participants(event_id);

-- Row Level Security
-- אין התחברות, לכן המפתח הציבורי (anon) יכול לקרוא ולכתוב בשתי הטבלאות האלה בלבד.
-- מספיק ל-MVP בין חברים. לא לשמור כאן מידע פרטי.
alter table events       enable row level security;
alter table participants enable row level security;

drop policy if exists "anon all" on events;
drop policy if exists "anon all" on participants;
create policy "anon all" on events       for all to anon using (true) with check (true);
create policy "anon all" on participants for all to anon using (true) with check (true);

grant usage on schema public to anon;
grant select, insert, update, delete on events, participants to anon;
grant usage, select on all sequences in schema public to anon;
