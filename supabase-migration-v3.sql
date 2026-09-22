-- יוצאים? — שדרוג v3: תיאור, יוצר יציאה, רכבים
-- Supabase → SQL Editor → New query → הדביקו את כל הקובץ → Run
-- בטוח להריץ על מסד קיים: לא מוחק שום דבר, רק מוסיף.

-- 1) שדות חדשים ל-events (יוצרים קיימים יקבלו NULL, וזה בסדר — ראו הערה בסיכום)
alter table events add column if not exists description text;
alter table events add column if not exists created_by  text;

-- 2) טבלת רכבים
create table if not exists rides (
  id               bigint generated always as identity primary key,
  event_id         bigint      not null references events(id) on delete cascade,
  driver_name      text        not null,
  available_seats  int         not null check (available_seats between 0 and 20),
  pickup_location  text,
  note             text,
  created_at       timestamptz not null default now(),
  unique (event_id, driver_name)   -- נהג אחד = רכב אחד ביציאה
);
create index if not exists rides_event_idx on rides(event_id);

-- 3) טבלת נוסעים ברכב
create table if not exists ride_passengers (
  id             bigint generated always as identity primary key,
  ride_id        bigint      not null references rides(id) on delete cascade,
  passenger_name text        not null,
  created_at     timestamptz not null default now(),
  unique (ride_id, passenger_name)
);
create index if not exists ride_passengers_ride_idx on ride_passengers(ride_id);

-- 4) RLS — פתוח לכל מי שמחזיק במפתח הציבורי, כמו שאר הטבלאות באפליקציה הזו (אין התחברות משתמשים)
alter table rides           enable row level security;
alter table ride_passengers enable row level security;
drop policy if exists "anon all" on rides;
drop policy if exists "anon all" on ride_passengers;
create policy "anon all" on rides           for all to anon using (true) with check (true);
create policy "anon all" on ride_passengers for all to anon using (true) with check (true);
grant select, insert, update, delete on rides, ride_passengers to anon;
grant usage, select on all sequences in schema public to anon;

-- 5) פונקציות: כל הצטרפות/יצירה עוברת דרך כאן כדי למנוע מצב מרוץ
--    (שני אנשים שלוחצים "הצטרף" באותה שנייה על המקום האחרון)

create or replace function create_ride(
  p_event_id bigint, p_driver text, p_seats int, p_pickup text, p_note text
) returns bigint language plpgsql as $$
declare v_id bigint;
begin
  if p_seats is null or p_seats < 0 or p_seats > 20 then
    raise exception 'seats out of range';
  end if;
  -- אם הנהג היה נוסע ברכב אחר באותה יציאה, מוציאים אותו משם קודם
  delete from ride_passengers rp using rides r
    where rp.ride_id = r.id and r.event_id = p_event_id and rp.passenger_name = p_driver;
  insert into rides(event_id, driver_name, available_seats, pickup_location, note)
    values (p_event_id, p_driver, p_seats, nullif(trim(p_pickup),''), nullif(trim(p_note),''))
    returning id into v_id;
  return v_id;
end $$;

create or replace function join_ride(p_ride_id bigint, p_passenger text)
returns void language plpgsql as $$
declare v_event bigint; v_driver text; v_seats int; v_taken int;
begin
  -- נעילה על הרכב הזה בלבד, כדי ששתי הצטרפויות בו-זמנית לא "ירוצו" זו על זו
  perform pg_advisory_xact_lock(p_ride_id);
  select event_id, driver_name, available_seats into v_event, v_driver, v_seats
    from rides where id = p_ride_id;
  if v_event is null then raise exception 'ride not found'; end if;
  if v_driver = p_passenger then raise exception 'driver cannot join own ride'; end if;
  select count(*) into v_taken from ride_passengers where ride_id = p_ride_id;
  if v_taken >= v_seats then raise exception 'ride is full'; end if;
  -- מצטרפים לרכב חדש = עוזבים אוטומטית רכב קודם באותה יציאה
  delete from ride_passengers rp using rides r
    where rp.ride_id = r.id and r.event_id = v_event and rp.passenger_name = p_passenger;
  insert into ride_passengers(ride_id, passenger_name) values (p_ride_id, p_passenger)
    on conflict (ride_id, passenger_name) do nothing;
end $$;

create or replace function leave_ride(p_ride_id bigint, p_passenger text)
returns void language plpgsql as $$
begin
  delete from ride_passengers where ride_id = p_ride_id and passenger_name = p_passenger;
end $$;

grant execute on function create_ride(bigint,text,int,text,text) to anon;
grant execute on function join_ride(bigint,text) to anon;
grant execute on function leave_ride(bigint,text) to anon;
