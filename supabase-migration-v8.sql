-- יוצאים? — שדרוג v8: עריכה רק ליוצר, מגבלת 3 יציאות ביום, התראות על יציאה חדשה
-- Supabase → SQL Editor → New query → הדביקו את כל הקובץ → Run
--
-- מה משתנה:
--   * events: עריכה (UPDATE) מותרת מעכשיו רק ליוצר היציאה, לא לכל מי שרואה אותה (זהה לרוח מדיניות ה-DELETE).
--   * events: מגבלה נאכפת במסד - עד 3 יציאות חדשות ביום (לפי אזור הזמן Asia/Jerusalem) לכל משתמש.
--   * notifications: טבלה חדשה - כשנוצרת יציאה, כל מי שרלוונטי (חברי הקבוצה, או כולם ליציאה ציבורית)
--     מקבל שורת התראה, עם קישור ישיר ליציאה. הלקוח קורא אותה, ומסמן כנקרא דרך RPC ייעודי.

begin;

-- ---------------------------------------------------------------------------
-- 1) events: רק היוצר יכול לערוך (זהה למדיניות המחיקה, בלי מגבלת "עדיין לא עברה")
-- ---------------------------------------------------------------------------
drop policy if exists "events update" on events;
create policy "events update" on events for update to authenticated
  using (current_name() is not null and created_by = current_name())
  with check (created_by = current_name());

-- ---------------------------------------------------------------------------
-- 2) events: מגבלה של 3 יציאות חדשות ביום למשתמש (לפי "היום" באזור הזמן של האפליקציה)
-- ---------------------------------------------------------------------------
alter table events add column if not exists created_at timestamptz not null default now();

create or replace function enforce_daily_outing_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  if NEW.created_by is not null then
    select count(*) into v_count from events
    where created_by = NEW.created_by
      and (coalesce(created_at, now()) at time zone 'Asia/Jerusalem')::date
        = (now() at time zone 'Asia/Jerusalem')::date;
    if v_count >= 3 then
      raise exception 'YZ_DAILY_LIMIT' using errcode = 'P0001';
    end if;
  end if;
  return NEW;
end;
$$;
revoke execute on function enforce_daily_outing_limit() from anon, public, authenticated;

drop trigger if exists trg_daily_outing_limit on events;
create trigger trg_daily_outing_limit
  before insert on events
  for each row execute function enforce_daily_outing_limit();

-- ---------------------------------------------------------------------------
-- 3) notifications: שורה אחת פר משתמש-יעד פר יציאה חדשה, נוצרות אך ורק ע"י הטריגרים למטה
-- ---------------------------------------------------------------------------
create table if not exists notifications (
  id            bigint generated always as identity primary key,
  recipient_name text not null,
  event_id      bigint not null references events(id) on delete cascade,
  created_at    timestamptz not null default now(),
  read_at       timestamptz,
  unique (recipient_name, event_id)
);
create index if not exists notifications_recipient_idx on notifications(recipient_name, created_at desc);

alter table notifications enable row level security;
drop policy if exists "notifications select own" on notifications;
create policy "notifications select own" on notifications for select to authenticated
  using (recipient_name = current_name());
-- אין מדיניות insert/update/delete בכלל: כל כתיבה קורית רק דרך פונקציות security definer למטה
revoke all on notifications from anon, public;
revoke insert, update, delete on notifications from authenticated;
grant select on notifications to authenticated;

-- מסמן כנקרא רק את ההתראות של עצמי
create or replace function mark_notifications_read(p_ids bigint[]) returns void
language sql security definer set search_path = public as $$
  update notifications set read_at = now()
  where recipient_name = current_name() and id = any(p_ids) and read_at is null;
$$;
revoke execute on function mark_notifications_read(bigint[]) from anon, public;
grant execute on function mark_notifications_read(bigint[]) to authenticated;

-- יציאה ציבורית: מיידית עם ה-INSERT של השורה עצמה (is_private = false מרגע ההיווצרות)
create or replace function notify_new_outing_public() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not NEW.is_private then
    insert into notifications (recipient_name, event_id)
    select p.name, NEW.id
    from profiles p
    where p.name is distinct from NEW.created_by
    on conflict (recipient_name, event_id) do nothing;
  end if;
  return NEW;
end;
$$;
drop trigger if exists trg_notify_new_outing_public on events;
create trigger trg_notify_new_outing_public
  after insert on events
  for each row execute function notify_new_outing_public();

-- יציאה פרטית: רק אחרי שהקישורים ל-event_groups נוספו (הלקוח יוצר אותם בבקשה נפרדת, מיד אחרי היציאה עצמה),
-- כדי שנדע בדיוק אילו קבוצות/חברים רלוונטיים. on conflict מונע כפילות כשליציאה כמה קבוצות עם חבר משותף.
create or replace function notify_new_outing_group() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_created_by text;
begin
  select created_by into v_created_by from events where id = NEW.event_id;
  insert into notifications (recipient_name, event_id)
  select gm.member_name, NEW.event_id
  from group_members gm
  where gm.group_id = NEW.group_id
    and gm.member_name is distinct from v_created_by
  on conflict (recipient_name, event_id) do nothing;
  return NEW;
end;
$$;
drop trigger if exists trg_notify_new_outing_group on event_groups;
create trigger trg_notify_new_outing_group
  after insert on event_groups
  for each row execute function notify_new_outing_group();

revoke execute on function notify_new_outing_public(), notify_new_outing_group() from anon, public, authenticated;

commit;

notify pgrst, 'reload schema';
