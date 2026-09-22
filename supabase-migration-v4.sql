-- יוצאים? — שדרוג v4: חוקי הרכבים נאכפים במסד הנתונים עצמו
-- Supabase → SQL Editor → New query → הדביקו את כל הקובץ → Run
-- דורש שכבר הרצתם את supabase-migration-v3.sql. בטוח להריץ יותר מפעם אחת.
--
-- החוקים (נאכפים בטריגרים, כך שגם כתיבה ישירה לטבלאות או שתי לחיצות באותה שנייה
-- לא יכולות ליצור מצב לא תקין):
--   1. ביציאה אחת כל משתמש הוא: מוציא רכב, או נוסע ברכב אחד, או בלי רכב. אף פעם לא גם וגם.
--   2. רק מי שמסומן "מגיע" יכול להיות ברכב (כנהג או כנוסע).
--   3. מעבר ל"אולי" / "לא מגיע" (או מחיקת התשובה) מוציא אותו מהרכב אוטומטית.
--      אם הוא היה הנהג, הרכב נמחק והנוסעים שלו חוזרים ל"ללא רכב" (לא נשארים משובצים לרכב שלא קיים).
--   4. אי אפשר להכניס לרכב יותר נוסעים ממספר המקומות.
--   5. שינוי שם מעדכן גם את הרכבים (כנהג וכנוסע).
--
-- קודי שגיאה שהאפליקציה מתרגמת להודעה קצרה:
--   YZ_ALREADY_PASSENGER · YZ_ALREADY_DRIVER · YZ_OWN_RIDE · YZ_RIDE_FULL
--   YZ_RIDE_NOT_FOUND · YZ_NOT_GOING · YZ_ALREADY_IN_RIDE · YZ_SEATS_TAKEN

begin;

-- ---------------------------------------------------------------------------
-- 0) ride_passengers.event_id — מאפשר אילוץ ייחודיות: נוסע אחד = רכב אחד ביציאה
-- ---------------------------------------------------------------------------
alter table ride_passengers add column if not exists event_id bigint;
update ride_passengers rp set event_id = r.event_id
  from rides r where rp.ride_id = r.id and rp.event_id is distinct from r.event_id;

-- ---------------------------------------------------------------------------
-- 1) ניקוי נתונים קיימים שכבר נמצאים במצב לא תקין (לפני שמפעילים את האכיפה)
-- ---------------------------------------------------------------------------
-- א. נהג שסימן "אולי"/"לא מגיע": הרכב שלו נמחק (הנוסעים משתחררים)
delete from rides r using participants p
  where p.event_id = r.event_id and p.name = r.driver_name and p.status <> 'going';
-- ב. נוסע שסימן "אולי"/"לא מגיע": יוצא מהרכב
delete from ride_passengers rp using participants p
  where p.event_id = rp.event_id and p.name = rp.passenger_name and p.status <> 'going';
-- ג. נהג או נוסע בלי תשובה בכלל: בגרסה הקודמת ההצטרפות סימנה "מגיע", אז משלימים את זה
insert into participants(event_id, name, status)
  select distinct r.event_id, r.driver_name, 'going' from rides r
  where not exists (select 1 from participants p where p.event_id = r.event_id and p.name = r.driver_name)
  on conflict (event_id, name) do nothing;
insert into participants(event_id, name, status)
  select distinct rp.event_id, rp.passenger_name, 'going' from ride_passengers rp
  where not exists (select 1 from participants p where p.event_id = rp.event_id and p.name = rp.passenger_name)
  on conflict (event_id, name) do nothing;
-- ד. מי שמוציא רכב וגם רשום כנוסע אצל מישהו אחר: נשאר נהג, יוצא מהרכב האחר
delete from ride_passengers rp using rides r
  where r.event_id = rp.event_id and r.driver_name = rp.passenger_name;
-- ה. נוסע שרשום בכמה רכבים באותה יציאה: נשאר רק בהצטרפות האחרונה
delete from ride_passengers rp using ride_passengers newer
  where newer.event_id = rp.event_id and newer.passenger_name = rp.passenger_name and newer.id > rp.id;
-- ו. רכב עם יותר נוסעים ממקומות: האחרונים שהצטרפו יוצאים
delete from ride_passengers where id in (
  select rp.id from (
    select rp.id, rp.ride_id,
           row_number() over (partition by rp.ride_id order by rp.created_at, rp.id) as n
    from ride_passengers rp
  ) rp join rides r on r.id = rp.ride_id
  where rp.n > r.available_seats
);

alter table ride_passengers alter column event_id set not null;
create unique index if not exists ride_passengers_one_ride_per_event
  on ride_passengers(event_id, passenger_name);

-- ---------------------------------------------------------------------------
-- 2) טריגרים: שומרים על החוקים בכל כתיבה, לא משנה מאיפה היא מגיעה
--    נעילה לפי (יציאה, שם) מסדרת פעולות מקבילות של אותו אדם באותה יציאה.
--    סדר נעילה קבוע בכל מקום: קודם (יציאה, שם), אחר כך שורת הרכב.
-- ---------------------------------------------------------------------------

-- רכב חדש / עדכון רכב
create or replace function yz_rides_guard() returns trigger language plpgsql as $$
declare v_taken int;
begin
  perform pg_advisory_xact_lock(hashtextextended('yotzim|' || new.event_id || '|' || new.driver_name, 0));
  if exists (select 1 from ride_passengers
             where event_id = new.event_id and passenger_name = new.driver_name) then
    raise exception 'YZ_ALREADY_PASSENGER' using errcode = 'P0001';
  end if;
  if not exists (select 1 from participants
                 where event_id = new.event_id and name = new.driver_name and status = 'going') then
    raise exception 'YZ_NOT_GOING' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' then
    select count(*) into v_taken from ride_passengers where ride_id = new.id;
    if v_taken > new.available_seats then
      raise exception 'YZ_SEATS_TAKEN' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists yz_rides_guard on rides;
create trigger yz_rides_guard before insert or update on rides
  for each row execute function yz_rides_guard();

-- נוסע חדש / עדכון נוסע
create or replace function yz_passengers_guard() returns trigger language plpgsql as $$
declare v_event bigint; v_driver text; v_seats int; v_taken int;
begin
  select event_id into v_event from rides where id = new.ride_id;
  if v_event is null then
    raise exception 'YZ_RIDE_NOT_FOUND' using errcode = 'P0001';
  end if;
  new.event_id := v_event;   -- תמיד נגזר מהרכב, לא ממה שהלקוח שלח
  perform pg_advisory_xact_lock(hashtextextended('yotzim|' || v_event || '|' || new.passenger_name, 0));
  -- נעילת שורת הרכב: שתי הצטרפויות בו-זמנית למקום האחרון לא יעברו שתיהן
  select driver_name, available_seats into v_driver, v_seats from rides where id = new.ride_id for update;
  if v_driver is null then
    raise exception 'YZ_RIDE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_driver = new.passenger_name then
    raise exception 'YZ_OWN_RIDE' using errcode = 'P0001';
  end if;
  if exists (select 1 from rides where event_id = v_event and driver_name = new.passenger_name) then
    raise exception 'YZ_ALREADY_DRIVER' using errcode = 'P0001';
  end if;
  if not exists (select 1 from participants
                 where event_id = v_event and name = new.passenger_name and status = 'going') then
    raise exception 'YZ_NOT_GOING' using errcode = 'P0001';
  end if;
  if exists (select 1 from ride_passengers
             where event_id = v_event and passenger_name = new.passenger_name and id <> new.id) then
    raise exception 'YZ_ALREADY_IN_RIDE' using errcode = 'P0001';
  end if;
  select count(*) into v_taken from ride_passengers where ride_id = new.ride_id and id <> new.id;
  if v_taken >= v_seats then
    raise exception 'YZ_RIDE_FULL' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists yz_passengers_guard on ride_passengers;
create trigger yz_passengers_guard before insert or update on ride_passengers
  for each row execute function yz_passengers_guard();

-- שינוי סטטוס הגעה / שם / מחיקת תשובה → מעדכן את הרכבים
create or replace function yz_participants_sync() returns trigger language plpgsql as $$
declare v_event bigint; v_name text; v_left boolean;
begin
  if tg_op = 'INSERT' then
    v_event := new.event_id; v_name := new.name; v_left := new.status <> 'going';
  elsif tg_op = 'UPDATE' then
    v_event := old.event_id; v_name := old.name; v_left := new.status <> 'going';
  else
    v_event := old.event_id; v_name := old.name; v_left := true;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('yotzim|' || v_event || '|' || v_name, 0));

  if v_left then
    -- לא מגיע / אולי: יוצא מכל רכב, ואם הוא נהג הרכב נמחק (הנוסעים נמחקים ב-cascade)
    delete from ride_passengers where event_id = v_event and passenger_name = v_name;
    delete from rides where event_id = v_event and driver_name = v_name;
  end if;

  if tg_op = 'UPDATE' and new.name is distinct from old.name then
    perform pg_advisory_xact_lock(hashtextextended('yotzim|' || v_event || '|' || new.name, 0));
    update rides set driver_name = new.name where event_id = v_event and driver_name = old.name;
    update ride_passengers set passenger_name = new.name where event_id = v_event and passenger_name = old.name;
  end if;
  return null;
end $$;

drop trigger if exists yz_participants_sync on participants;
create trigger yz_participants_sync after insert or update or delete on participants
  for each row execute function yz_participants_sync();

-- ---------------------------------------------------------------------------
-- 3) פונקציות שהאפליקציה קוראת להן (RPC). הכול בטרנזקציה אחת.
--    p_switch = true: "תחליף לי את הבחירה" (לצאת מהרכב של מישהו ולהוציא רכב, או להפך).
-- ---------------------------------------------------------------------------
drop function if exists create_ride(bigint, text, int, text, text);
create or replace function create_ride(
  p_event_id bigint, p_driver text, p_seats int, p_pickup text, p_note text, p_switch boolean default false
) returns bigint language plpgsql as $$
declare v_id bigint;
begin
  if p_seats is null or p_seats < 0 or p_seats > 20 then
    raise exception 'seats out of range';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('yotzim|' || p_event_id || '|' || p_driver, 0));
  if exists (select 1 from ride_passengers where event_id = p_event_id and passenger_name = p_driver) then
    if not p_switch then
      raise exception 'YZ_ALREADY_PASSENGER' using errcode = 'P0001';
    end if;
    delete from ride_passengers where event_id = p_event_id and passenger_name = p_driver;
  end if;
  -- מי שמוציא רכב מגיע
  insert into participants(event_id, name, status) values (p_event_id, p_driver, 'going')
    on conflict (event_id, name) do update set status = 'going' where participants.status <> 'going';
  insert into rides(event_id, driver_name, available_seats, pickup_location, note)
    values (p_event_id, p_driver, p_seats, nullif(trim(p_pickup), ''), nullif(trim(p_note), ''))
    returning id into v_id;
  return v_id;
end $$;

drop function if exists join_ride(bigint, text);
create or replace function join_ride(p_ride_id bigint, p_passenger text, p_switch boolean default false)
returns void language plpgsql as $$
declare v_event bigint; v_driver text; v_seats int; v_taken int;
begin
  select event_id into v_event from rides where id = p_ride_id;
  if v_event is null then
    raise exception 'YZ_RIDE_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('yotzim|' || v_event || '|' || p_passenger, 0));
  select driver_name, available_seats into v_driver, v_seats from rides where id = p_ride_id for update;
  if v_driver is null then
    raise exception 'YZ_RIDE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_driver = p_passenger then
    raise exception 'YZ_OWN_RIDE' using errcode = 'P0001';
  end if;
  if exists (select 1 from ride_passengers where ride_id = p_ride_id and passenger_name = p_passenger) then
    return;   -- כבר ברכב הזה
  end if;
  select count(*) into v_taken from ride_passengers where ride_id = p_ride_id;
  if v_taken >= v_seats then
    raise exception 'YZ_RIDE_FULL' using errcode = 'P0001';
  end if;
  if exists (select 1 from rides where event_id = v_event and driver_name = p_passenger) then
    if not p_switch then
      raise exception 'YZ_ALREADY_DRIVER' using errcode = 'P0001';
    end if;
    delete from rides where event_id = v_event and driver_name = p_passenger;
  end if;
  -- מי שמצטרף לרכב מגיע
  insert into participants(event_id, name, status) values (v_event, p_passenger, 'going')
    on conflict (event_id, name) do update set status = 'going' where participants.status <> 'going';
  -- מעבר מרכב אחר לרכב הזה
  delete from ride_passengers where event_id = v_event and passenger_name = p_passenger;
  insert into ride_passengers(ride_id, passenger_name, event_id) values (p_ride_id, p_passenger, v_event);
end $$;

create or replace function leave_ride(p_ride_id bigint, p_passenger text)
returns void language plpgsql as $$
begin
  delete from ride_passengers where ride_id = p_ride_id and passenger_name = p_passenger;
end $$;

grant execute on function create_ride(bigint, text, int, text, text, boolean) to anon;
grant execute on function join_ride(bigint, text, boolean) to anon;
grant execute on function leave_ride(bigint, text) to anon;
grant select, insert, update, delete on rides, ride_passengers, participants to anon;

commit;

-- רענון המטמון של Supabase כדי שהפונקציות החדשות יהיו זמינות מיד
notify pgrst, 'reload schema';
