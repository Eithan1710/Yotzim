-- יוצאים? — שדרוג v6: רשימת ציוד ליציאה, ואיסור מחיקה של יציאה שכבר עברה
-- Supabase → SQL Editor → New query → הדביקו את כל הקובץ → Run
-- בטוח להריץ על מסד קיים: לא מוחק שום דבר, רק מוסיף.
--
-- מה חדש:
--   1. טבלת equipment_items — פריט ציוד לכל יציאה, עם מי שמביא אותו (assigned_to, יכול להיות ריק).
--      שיבוץ/ביטול שיבוץ עוברים דרך RPC אטומי כדי שלא שני אנשים "יזכו" באותו פריט בו-זמנית.
--   2. אכיפה במסד הנתונים: יציאה שכבר עברה (תאריך+שעה, עם 3 שעות סבילות) לא ניתנת למחיקה,
--      גם דרך קריאה ישירה ל-API ולא רק דרך הממשק.
--
-- קודי שגיאה שהאפליקציה מתרגמת להודעה קצרה: YZ_ITEM_TAKEN · YZ_ITEM_NOT_FOUND

begin;

-- ---------------------------------------------------------------------------
-- 1) טבלת פריטי ציוד
-- ---------------------------------------------------------------------------
create table if not exists equipment_items (
  id           bigint generated always as identity primary key,
  event_id     bigint      not null references events(id) on delete cascade,
  name         text        not null check (char_length(trim(name)) between 1 and 60),
  added_by     text,
  assigned_to  text,
  created_at   timestamptz not null default now()
);
create index if not exists equipment_items_event_idx on equipment_items(event_id);

alter table equipment_items enable row level security;
drop policy if exists "anon all" on equipment_items;
create policy "anon all" on equipment_items for all to anon using (true) with check (true);
grant select, insert, update, delete on equipment_items to anon;
grant usage, select on all sequences in schema public to anon;

-- שיבוץ עצמי לפריט: אטומי, כדי שתי הצטרפויות בו-זמנית לא "יזכו" שתיהן
create or replace function claim_equipment(p_item_id bigint, p_name text)
returns void language plpgsql as $$
declare v_taken text;
begin
  perform pg_advisory_xact_lock(hashtextextended('yotzim|equip|' || p_item_id, 0));
  select assigned_to into v_taken from equipment_items where id = p_item_id for update;
  if not found then
    raise exception 'YZ_ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_taken is not null and v_taken <> p_name then
    raise exception 'YZ_ITEM_TAKEN' using errcode = 'P0001';
  end if;
  update equipment_items set assigned_to = p_name where id = p_item_id;
end $$;

-- ביטול שיבוץ: רק מי ששיבץ את עצמו יכול להסיר את עצמו
create or replace function unclaim_equipment(p_item_id bigint, p_name text)
returns void language plpgsql as $$
begin
  update equipment_items set assigned_to = null where id = p_item_id and assigned_to = p_name;
end $$;

grant execute on function claim_equipment(bigint, text) to anon;
grant execute on function unclaim_equipment(bigint, text) to anon;

-- ---------------------------------------------------------------------------
-- 2) יציאה שעברה לא ניתנת למחיקה — נאכף במסד, לא רק בממשק
--    (אותה שעת חסד של 3 שעות אחרי תחילת היציאה שהאפליקציה משתמשת בה, כדי לתאם בין השניים)
-- ---------------------------------------------------------------------------
drop policy if exists "anon all" on events;
create policy "anon select" on events for select to anon using (true);
create policy "anon insert" on events for insert to anon with check (true);
create policy "anon update" on events for update to anon using (true) with check (true);
create policy "anon delete future" on events for delete to anon
  using ((("date" + "time") at time zone 'Asia/Jerusalem') + interval '3 hours' > now());

commit;

-- רענון המטמון של Supabase כדי שהטבלה/הפונקציות החדשות יהיו זמינות מיד
notify pgrst, 'reload schema';
