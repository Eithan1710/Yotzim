-- יוצאים? — שדרוג v7: זהות אמיתית, הרשאות שנאכפות במסד, קבוצות (crews) ותמונות פרופיל
-- Supabase → SQL Editor → New query → הדביקו את כל הקובץ → Run
--
-- לפני שמריצים:
--   1. Authentication → Sign In / Providers → הפעילו "Allow anonymous sign-ins".
--      (כך כל מכשיר מקבל זהות אמיתית ב-JWT בלי שמישהו צריך להירשם. את זה ה-RLS מזהה דרך auth.uid().)
--   2. הריצו את הקובץ הזה, ואז העלו את הקבצים החדשים של האתר (script.js וכו').
--   הערה: אחרי המיגרציה גרסאות ישנות של האתר (מטמון) לא יוכלו לכתוב עד שיתעדכנו — זה מכוון.
--
-- מה משתנה:
--   * profiles: שם -> מכשיר (uid). רק מי שתפס שם יכול לכתוב בשמו. מפתח שחזור להחלפת מכשיר.
--   * events: מחיקה רק ליוצר (ורק ליציאה עתידית). עריכה לכל מי שמורשה לראות את היציאה.
--   * groups / group_members / event_groups: יציאות פרטיות לקבוצה, נאכף ב-RLS (לא רק בממשק).
--   * ציוד, דירוגים, נוכחות, רכבים: נראים ונכתבים רק לפי הרשאת צפייה ביציאה.
--   * תמונות פרופיל: bucket ציבורי "avatars", כתיבה רק לקובץ של עצמך.

begin;

-- ---------------------------------------------------------------------------
-- 1) פרופילים
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  name          text primary key check (char_length(btrim(name)) between 1 and 20),
  uid           uuid unique,
  avatar_path   text,
  avatar_v      bigint      not null default 0,
  recovery_code text        not null default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
  created_at    timestamptz not null default now()
);
alter table profiles enable row level security;
drop policy if exists "profiles read" on profiles;
create policy "profiles read" on profiles for select to authenticated using (true);
-- קוד השחזור לעולם לא נחשף בקריאה ישירה: רק העמודות הציבוריות
revoke all on profiles from anon, authenticated;
grant select (name, avatar_path, avatar_v) on profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2) קבוצות
-- ---------------------------------------------------------------------------
create table if not exists groups (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(btrim(name)) between 1 and 30),
  created_by   text not null,
  invite_token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_at   timestamptz not null default now()
);
create table if not exists group_members (
  group_id    uuid not null references groups(id) on delete cascade,
  member_name text not null,
  joined_at   timestamptz not null default now(),
  primary key (group_id, member_name)
);
create index if not exists group_members_name_idx on group_members(member_name);

alter table events add column if not exists is_private boolean not null default false;
create table if not exists event_groups (
  event_id bigint not null references events(id) on delete cascade,
  group_id uuid   not null references groups(id) on delete restrict,   -- מחיקת קבוצה לא "תפתח" יציאות פרטיות לכולם
  primary key (event_id, group_id)
);
create index if not exists event_groups_group_idx on event_groups(group_id);

-- ---------------------------------------------------------------------------
-- 3) פונקציות עזר (security definer: קוראות בלי להיתקע ב-RLS של עצמן)
-- ---------------------------------------------------------------------------
create or replace function current_name() returns text
language sql stable security definer set search_path = public as
$$ select name from profiles where uid = auth.uid() $$;

create or replace function is_group_member(p_group uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from group_members where group_id = p_group and member_name = current_name()) $$;

-- יציאה ציבורית: כולם. יציאה פרטית: היוצר, או חבר באחת הקבוצות שלה
create or replace function can_see_event(p_event bigint) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (
     select 1 from events e where e.id = p_event and (
       not e.is_private
       or e.created_by = current_name()
       or exists (select 1 from event_groups g join group_members m on m.group_id = g.group_id
                  where g.event_id = e.id and m.member_name = current_name())
     )) $$;

-- Supabase auto-grants EXECUTE to anon (and PUBLIC) on every new function; revoke that explicitly —
-- these RPCs must only ever be callable by a signed-in (even anonymously-authenticated) session.
revoke execute on function current_name(), is_group_member(uuid), can_see_event(bigint) from public, anon;
grant execute on function current_name(), is_group_member(uuid), can_see_event(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) פונקציות פרופיל
-- ---------------------------------------------------------------------------
-- תופס שם למכשיר הזה. מחזיר את השם שנשמר בפועל (אם כבר יש למכשיר פרופיל, מחזיר אותו)
create or replace function claim_profile(p_name text) returns text
language plpgsql security definer set search_path = public as $$
declare v_name text := btrim(coalesce(p_name, '')); v_have text;
begin
  if auth.uid() is null then raise exception 'YZ_NO_AUTH' using errcode = 'P0001'; end if;
  if char_length(v_name) < 1 or char_length(v_name) > 20 then raise exception 'YZ_BAD_NAME' using errcode = 'P0001'; end if;
  select name into v_have from profiles where uid = auth.uid();
  if found then return v_have; end if;
  if exists (select 1 from profiles where name = v_name) then raise exception 'YZ_NAME_TAKEN' using errcode = 'P0001'; end if;
  insert into profiles(name, uid) values (v_name, auth.uid());
  return v_name;
end $$;

create or replace function get_recovery_code() returns text
language sql stable security definer set search_path = public as
$$ select recovery_code from profiles where uid = auth.uid() $$;

-- מכשיר חדש שמוכיח שהוא הבעלים של השם (מפתח שחזור) מקבל אותו
create or replace function recover_profile(p_name text, p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare v_name text := btrim(coalesce(p_name, ''));
begin
  if auth.uid() is null then raise exception 'YZ_NO_AUTH' using errcode = 'P0001'; end if;
  perform 1 from profiles where name = v_name and recovery_code = btrim(coalesce(p_code, ''));
  if not found then raise exception 'YZ_BAD_CODE' using errcode = 'P0001'; end if;
  update profiles set uid = null where uid = auth.uid();
  update profiles set uid = auth.uid() where name = v_name;
  return v_name;
end $$;

create or replace function rename_profile(p_new text) returns text
language plpgsql security definer set search_path = public as $$
declare v_old text := current_name(); v_new text := btrim(coalesce(p_new, ''));
begin
  if v_old is null then raise exception 'YZ_NO_PROFILE' using errcode = 'P0001'; end if;
  if char_length(v_new) < 1 or char_length(v_new) > 20 then raise exception 'YZ_BAD_NAME' using errcode = 'P0001'; end if;
  if v_new = v_old then return v_old; end if;
  if exists (select 1 from profiles where name = v_new) then raise exception 'YZ_NAME_TAKEN' using errcode = 'P0001'; end if;
  perform set_config('yz.renaming', '1', true);
  update profiles set name = v_new where name = v_old;
  update participants   set name = v_new         where name = v_old;   -- הטריגר מעדכן גם רכבים ונוסעים
  update outing_ratings set rater_name = v_new   where rater_name = v_old;
  update user_prefs     set name = v_new         where name = v_old;
  update events         set created_by = v_new   where created_by = v_old;
  update equipment_items set added_by = v_new    where added_by = v_old;
  update equipment_items set assigned_to = v_new where assigned_to = v_old;
  update group_members  set member_name = v_new  where member_name = v_old;
  update groups         set created_by = v_new   where created_by = v_old;
  return v_new;
end $$;

create or replace function set_avatar(p_path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if current_name() is null then raise exception 'YZ_NO_PROFILE' using errcode = 'P0001'; end if;
  if p_path is distinct from (auth.uid()::text || '.jpg') then raise exception 'YZ_BAD_PATH' using errcode = 'P0001'; end if;
  update profiles set avatar_path = p_path, avatar_v = (extract(epoch from now()) * 1000)::bigint where uid = auth.uid();
end $$;

create or replace function clear_avatar() returns void
language sql security definer set search_path = public as
$$ update profiles set avatar_path = null, avatar_v = (extract(epoch from now()) * 1000)::bigint where uid = auth.uid() $$;

-- ---------------------------------------------------------------------------
-- 5) פונקציות קבוצה
-- ---------------------------------------------------------------------------
create or replace function create_group(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_me text := current_name(); v_id uuid; v_name text := btrim(coalesce(p_name, ''));
begin
  if v_me is null then raise exception 'YZ_NO_PROFILE' using errcode = 'P0001'; end if;
  if char_length(v_name) < 1 or char_length(v_name) > 30 then raise exception 'YZ_BAD_NAME' using errcode = 'P0001'; end if;
  insert into groups(name, created_by) values (v_name, v_me) returning id into v_id;
  insert into group_members(group_id, member_name) values (v_id, v_me);
  return v_id;
end $$;

-- תצוגה מקדימה לפני הצטרפות (שם הקבוצה ומספר חברים בלבד)
create or replace function group_preview(p_token text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('id', g.id, 'name', g.name,
           'members', (select count(*) from group_members m where m.group_id = g.id),
           'is_member', exists (select 1 from group_members m where m.group_id = g.id and m.member_name = current_name()))
  from groups g where g.invite_token = p_token
$$;

create or replace function join_group(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_me text := current_name(); v_id uuid;
begin
  if v_me is null then raise exception 'YZ_NO_PROFILE' using errcode = 'P0001'; end if;
  select id into v_id from groups where invite_token = p_token;
  if not found then raise exception 'YZ_BAD_INVITE' using errcode = 'P0001'; end if;
  insert into group_members(group_id, member_name) values (v_id, v_me) on conflict do nothing;
  return v_id;
end $$;

create or replace function leave_group(p_group uuid) returns void
language sql security definer set search_path = public as
$$ delete from group_members where group_id = p_group and member_name = current_name() $$;

revoke execute on function claim_profile(text), get_recovery_code(), recover_profile(text, text), rename_profile(text),
  set_avatar(text), clear_avatar(), create_group(text), group_preview(text), join_group(text), leave_group(uuid) from public, anon;
grant execute on function claim_profile(text), get_recovery_code(), recover_profile(text, text), rename_profile(text),
  set_avatar(text), clear_avatar(), create_group(text), group_preview(text), join_group(text), leave_group(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) ציוד: שיבוץ רק על השם שלך, ורק ביציאה שמותר לך לראות
-- ---------------------------------------------------------------------------
create or replace function claim_equipment(p_item_id bigint, p_name text)
returns void language plpgsql as $$
declare v_taken text; v_event bigint;
begin
  if p_name is distinct from current_name() then raise exception 'YZ_FORBIDDEN' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('yotzim|equip|' || p_item_id, 0));
  select assigned_to, event_id into v_taken, v_event from equipment_items where id = p_item_id for update;
  if not found then raise exception 'YZ_ITEM_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_taken is not null and v_taken <> p_name then raise exception 'YZ_ITEM_TAKEN' using errcode = 'P0001'; end if;
  update equipment_items set assigned_to = p_name where id = p_item_id;
end $$;

create or replace function unclaim_equipment(p_item_id bigint, p_name text)
returns void language plpgsql as $$
begin
  if p_name is distinct from current_name() then raise exception 'YZ_FORBIDDEN' using errcode = 'P0001'; end if;
  update equipment_items set assigned_to = null where id = p_item_id and assigned_to = p_name;
end $$;

-- ---------------------------------------------------------------------------
-- 7) הגנה על שדות שאסור לשנות בעריכה
-- ---------------------------------------------------------------------------
create or replace function yz_events_guard() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('yz.renaming', true), '') <> '1' then
    new.created_by := old.created_by;      -- עורכים לא יכולים "לקחת בעלות"
    new.is_private := old.is_private;      -- הקהל נקבע ביצירה
  end if;
  return new;
end $$;
drop trigger if exists yz_events_guard on events;
create trigger yz_events_guard before update on events for each row execute function yz_events_guard();

-- הטריגר של הנוכחות נוגע ברכבים של המשתמש: שירוץ בהרשאות בעלים כדי לא להיתקע ב-RLS
alter function yz_participants_sync() security definer set search_path = public;

-- ---------------------------------------------------------------------------
-- 8) RLS: מחליפים את "anon all" בהרשאות אמיתיות
-- ---------------------------------------------------------------------------
-- מנקים את כל ה-policies הקיימים בטבלאות האלה (כולל "anon all" ומיגרציות קודמות), כך שאפשר להריץ שוב בבטחה
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies
           where schemaname = 'public' and tablename in ('events','participants','rides','ride_passengers',
             'outing_ratings','user_prefs','equipment_items','groups','group_members','event_groups')
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- events
drop policy if exists "anon all" on events;
drop policy if exists "anon select" on events;
drop policy if exists "anon insert" on events;
drop policy if exists "anon update" on events;
drop policy if exists "anon delete future" on events;
drop policy if exists "events select" on events;
drop policy if exists "events insert" on events;
drop policy if exists "events update" on events;
drop policy if exists "events delete" on events;
-- events select/update use an INLINE predicate over the row's own columns rather than can_see_event(id).
-- can_see_event() does its own `select ... from events e where e.id = p_event`, and when it is used as the
-- events table's own SELECT policy, an INSERT ... RETURNING (which the app always uses, and which requires
-- passing the SELECT policy on the new row) fails: that self-referential lookup does not see the row being
-- inserted in the very same statement, so the check evaluates to false for every brand-new row even though
-- it is a fully public event created by its own creator. can_see_event() stays correct (and is unaffected
-- by this) for every OTHER table's policies below, since those look up an already-existing, already-committed
-- event_id rather than re-querying the table currently being written to.
create policy "events select" on events for select to authenticated using (
  not is_private
  or created_by = current_name()
  or exists (select 1 from event_groups g join group_members m on m.group_id = g.group_id
             where g.event_id = events.id and m.member_name = current_name())
);
create policy "events insert" on events for insert to authenticated
  with check (current_name() is not null and created_by = current_name());
create policy "events update" on events for update to authenticated
  using (
    current_name() is not null and (
      not is_private
      or created_by = current_name()
      or exists (select 1 from event_groups g join group_members m on m.group_id = g.group_id
                 where g.event_id = events.id and m.member_name = current_name())
    )
  )
  with check (
    not is_private
    or created_by = current_name()
    or exists (select 1 from event_groups g join group_members m on m.group_id = g.group_id
               where g.event_id = events.id and m.member_name = current_name())
  );
-- מחיקה: רק היוצר, ורק ליציאה שעוד לא עברה (אותה שעת חסד של 3 שעות שהאפליקציה משתמשת בה)
create policy "events delete" on events for delete to authenticated
  using (created_by = current_name()
         and (("date" + "time") at time zone 'Asia/Jerusalem') + interval '3 hours' > now());

-- participants
drop policy if exists "anon all" on participants;
drop policy if exists "participants select" on participants;
drop policy if exists "participants write" on participants;
create policy "participants select" on participants for select to authenticated using (can_see_event(event_id));
create policy "participants insert" on participants for insert to authenticated
  with check (name = current_name() and can_see_event(event_id));
create policy "participants update" on participants for update to authenticated
  using (name = current_name()) with check (name = current_name() and can_see_event(event_id));
create policy "participants delete" on participants for delete to authenticated using (name = current_name());

-- rides + passengers (הפעולות עוברות דרך RPC; כאן רק גבול הצפייה והזהות)
drop policy if exists "anon all" on rides;
drop policy if exists "anon all" on ride_passengers;
create policy "rides select" on rides for select to authenticated using (can_see_event(event_id));
create policy "rides insert" on rides for insert to authenticated
  with check (driver_name = current_name() and can_see_event(event_id));
create policy "rides update" on rides for update to authenticated
  using (current_name() is not null and can_see_event(event_id)) with check (can_see_event(event_id));
create policy "rides delete" on rides for delete to authenticated using (driver_name = current_name());
create policy "passengers select" on ride_passengers for select to authenticated using (can_see_event(event_id));
create policy "passengers insert" on ride_passengers for insert to authenticated
  with check (passenger_name = current_name() and can_see_event(event_id));
create policy "passengers update" on ride_passengers for update to authenticated
  using (passenger_name = current_name()) with check (passenger_name = current_name());
create policy "passengers delete" on ride_passengers for delete to authenticated
  using (passenger_name = current_name()
         or exists (select 1 from rides r where r.id = ride_id and r.driver_name = current_name()));

-- ratings / prefs
drop policy if exists "anon all" on outing_ratings;
drop policy if exists "anon all" on user_prefs;
create policy "ratings select" on outing_ratings for select to authenticated using (can_see_event(event_id));
create policy "ratings insert" on outing_ratings for insert to authenticated
  with check (rater_name = current_name() and can_see_event(event_id));
create policy "ratings update" on outing_ratings for update to authenticated
  using (rater_name = current_name()) with check (rater_name = current_name() and can_see_event(event_id));
create policy "ratings delete" on outing_ratings for delete to authenticated using (rater_name = current_name());
create policy "prefs select" on user_prefs for select to authenticated using (true);
create policy "prefs insert" on user_prefs for insert to authenticated with check (name = current_name());
create policy "prefs update" on user_prefs for update to authenticated using (name = current_name()) with check (name = current_name());
create policy "prefs delete" on user_prefs for delete to authenticated using (name = current_name());

-- equipment: כל מי שמורשה לראות את היציאה יכול להוסיף / לערוך / למחוק פריטים
drop policy if exists "anon all" on equipment_items;
create policy "equipment select" on equipment_items for select to authenticated using (can_see_event(event_id));
create policy "equipment insert" on equipment_items for insert to authenticated
  with check (current_name() is not null and added_by = current_name() and can_see_event(event_id));
create policy "equipment update" on equipment_items for update to authenticated
  using (current_name() is not null and can_see_event(event_id)) with check (can_see_event(event_id));
create policy "equipment delete" on equipment_items for delete to authenticated
  using (current_name() is not null and can_see_event(event_id));

-- groups: רואים רק קבוצות שאתה חבר בהן. יצירה/הצטרפות רק דרך ה-RPC
alter table groups        enable row level security;
alter table group_members enable row level security;
alter table event_groups  enable row level security;
drop policy if exists "groups select" on groups;
drop policy if exists "members select" on group_members;
drop policy if exists "members leave" on group_members;
drop policy if exists "event_groups select" on event_groups;
drop policy if exists "event_groups insert" on event_groups;
create policy "groups select" on groups for select to authenticated using (is_group_member(id));
create policy "members select" on group_members for select to authenticated using (is_group_member(group_id));
create policy "members leave" on group_members for delete to authenticated using (member_name = current_name());
create policy "event_groups select" on event_groups for select to authenticated using (can_see_event(event_id));
create policy "event_groups insert" on event_groups for insert to authenticated
  with check (is_group_member(group_id)
              and exists (select 1 from events e where e.id = event_id and e.created_by = current_name()));

-- הרשאות טבלה (RLS מסנן; בלי GRANT אין גישה בכלל)
revoke all on groups, group_members, event_groups from anon, authenticated;
grant select on groups, group_members, event_groups to authenticated;
grant delete on group_members to authenticated;
grant insert on event_groups to authenticated;
revoke all on events, participants, rides, ride_passengers, outing_ratings, user_prefs, equipment_items from anon;
grant select, insert, update, delete on events, participants, rides, ride_passengers, outing_ratings, user_prefs, equipment_items to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ---------------------------------------------------------------------------
-- 9) תמונות פרופיל (Storage): קריאה ציבורית, כתיבה רק לקובץ <uid>.jpg של עצמך
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 512000, array['image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = 512000, allowed_mime_types = array['image/jpeg'];

drop policy if exists "avatars own select" on storage.objects;
drop policy if exists "avatars own insert" on storage.objects;
drop policy if exists "avatars own update" on storage.objects;
drop policy if exists "avatars own delete" on storage.objects;
create policy "avatars own select" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and name = auth.uid()::text || '.jpg');
create policy "avatars own insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and name = auth.uid()::text || '.jpg');
create policy "avatars own update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and name = auth.uid()::text || '.jpg');
create policy "avatars own delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and name = auth.uid()::text || '.jpg');

-- ---------------------------------------------------------------------------
-- 10) ניקוי: הרשאות ישנות ל-anon על פונקציות שקיימות עוד מ-v3/v4/v6, ו-search_path קבוע
-- ---------------------------------------------------------------------------
-- v3/v4/v6 העניקו EXECUTE ל-anon על הפונקציות האלה מפורשות; אף אחת מהן security definer, אז
-- קריאה כ-anon כבר נכשלת ברמת הטבלה (אין לו יותר גישה), אבל עדיף להסיר את ההרשאה גם במפורש.
revoke execute on function
  create_ride(bigint, text, int, text, text, boolean),
  join_ride(bigint, text, boolean),
  leave_ride(bigint, text),
  claim_equipment(bigint, text),
  unclaim_equipment(bigint, text)
from anon;

alter function yz_events_guard() set search_path = public;
alter function claim_equipment(bigint, text) set search_path = public;
alter function unclaim_equipment(bigint, text) set search_path = public;
alter function leave_ride(bigint, text) set search_path = public;
alter function yz_rides_guard() set search_path = public;
alter function yz_passengers_guard() set search_path = public;
alter function create_ride(bigint, text, int, text, text, boolean) set search_path = public;
alter function join_ride(bigint, text, boolean) set search_path = public;

commit;

notify pgrst, 'reload schema';
