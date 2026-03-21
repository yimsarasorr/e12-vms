


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "btree_gist" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."activity_category" AS ENUM (
    'normal',
    'abnormal'
);


ALTER TYPE "public"."activity_category" OWNER TO "postgres";


CREATE TYPE "public"."activity_log_type" AS ENUM (
    'revision',
    'activity'
);


ALTER TYPE "public"."activity_log_type" OWNER TO "postgres";


CREATE TYPE "public"."activity_status" AS ENUM (
    'success',
    'warning',
    'denied',
    'error'
);


ALTER TYPE "public"."activity_status" OWNER TO "postgres";


CREATE TYPE "public"."booking_type" AS ENUM (
    'hourly',
    'flat_24h',
    'monthly_regular',
    'monthly_night'
);


ALTER TYPE "public"."booking_type" OWNER TO "postgres";


CREATE TYPE "public"."reservation_status" AS ENUM (
    'pending',
    'checked_in',
    'checked_out',
    'cancelled',
    'confirmed',
    'pending_payment',
    'active'
);


ALTER TYPE "public"."reservation_status" OWNER TO "postgres";


CREATE TYPE "public"."site_status" AS ENUM (
    'active',
    'inactive',
    'maintenance'
);


ALTER TYPE "public"."site_status" OWNER TO "postgres";


CREATE TYPE "public"."slot_status" AS ENUM (
    'available',
    'reserved',
    'occupied',
    'maintenance'
);


ALTER TYPE "public"."slot_status" OWNER TO "postgres";


CREATE TYPE "public"."user_status" AS ENUM (
    'active',
    'inactive',
    'suspended'
);


ALTER TYPE "public"."user_status" OWNER TO "postgres";


CREATE TYPE "public"."vehicle_type" AS ENUM (
    'car',
    'motorcycle',
    'ev',
    'other'
);


ALTER TYPE "public"."vehicle_type" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_update_slot_status_with_log"("p_slot_ids" "text"[], "p_status" "public"."slot_status", "p_user_id" "uuid", "p_user_name" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  r record;
  v_site_id text;
  v_event_name text;
  v_message text;
  v_log_level text := 'normal';
begin

  --------------------------------------------------------
  -- Loop each slot
  --------------------------------------------------------

  for r in
    select id, parking_site_id
    from slots
    where id = any(p_slot_ids)
  loop

    v_site_id := r.parking_site_id;

    --------------------------------------------------------
    -- Update main status
    --------------------------------------------------------

    update slots
    set status = p_status,
        updated_at = now()
    where id = r.id;

    --------------------------------------------------------
    -- Prepare log
    --------------------------------------------------------

    v_event_name := 'slot_main_status_' || p_status::text;
    v_message := format('Slot main status set to %s', p_status);

    if p_status = 'maintenance' then
      v_log_level := 'abnormal';
    else
      v_log_level := 'normal';
    end if;

    --------------------------------------------------------
    -- Success log
    --------------------------------------------------------

    perform insert_activity_log(
      v_site_id,
      'activity'::activity_log_type,
      v_event_name,
      p_user_id,
      p_user_name,
      v_log_level::activity_category,
      'success'::activity_status,
      'slots',
      r.id,
      v_message,
      jsonb_build_object(
        'status', p_status
      ),
      null,
      null,
      null
    );

  end loop;

exception when others then

  --------------------------------------------------------
  -- Error log
  --------------------------------------------------------

  perform insert_activity_log(
    v_site_id,
    'activity'::activity_log_type,
    'slot_main_status_failed',
    p_user_id,
    p_user_name,
    'abnormal'::activity_category,
    'error'::activity_status,
    'slots',
    null,
    'Slot main status update failed',
    null,
    null,
    null,
    jsonb_build_object('error', sqlerrm)
  );

  raise;

end;
$$;


ALTER FUNCTION "public"."admin_update_slot_status_with_log"("p_slot_ids" "text"[], "p_status" "public"."slot_status", "p_user_id" "uuid", "p_user_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_upsert_slot_overrides_with_log"("p_slot_id" "text", "p_override_date" "date", "p_ranges" "jsonb", "p_user_id" "uuid", "p_user_name" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_site_id text;
  v_primary_status slot_status;
  v_event_name text;
  v_message text;
  v_log_level text := 'normal';
  v_existing record;
  v_incoming record;
begin

  --------------------------------------------------------
  -- Lock slot
  --------------------------------------------------------
  select parking_site_id
  into v_site_id
  from slots
  where id = p_slot_id
  for update;

  if v_site_id is null then
    raise exception 'Slot not found';
  end if;

  if jsonb_array_length(p_ranges) = 0 then
    raise exception 'No time ranges provided';
  end if;

  --------------------------------------------------------
  -- Prevent editing past time
  --------------------------------------------------------
  if p_override_date = current_date then
    if exists (
      select 1
      from jsonb_array_elements(p_ranges) r
      where (r->>'start_time')::time < current_time
    ) then
      raise exception 'Cannot modify past time range';
    end if;
  end if;

  --------------------------------------------------------
  -- Log prep
  --------------------------------------------------------
  v_primary_status := (p_ranges->0->>'status')::slot_status;
  v_event_name := 'slot_override_' || v_primary_status::text;
  v_message := format('Slot set to %s', v_primary_status);

  if v_primary_status = 'maintenance' then
    v_log_level := 'abnormal';
  end if;

  --------------------------------------------------------
  -- STEP 1: Smart split overlapping ranges
  --------------------------------------------------------

  for v_existing in
    select *
    from slot_status_overrides
    where slot_id = p_slot_id
      and override_date = p_override_date
  loop

    for v_incoming in
      select
        (x->>'start_time')::time as new_start,
        (x->>'end_time')::time as new_end
      from jsonb_array_elements(p_ranges) x
    loop

      if v_existing.start_time < v_incoming.new_end
        and v_existing.end_time > v_incoming.new_start then

        -- ลบของเดิมก่อน
        delete from slot_status_overrides
        where id = v_existing.id;

        -- ซ้ายที่เหลือ
        if v_existing.start_time < v_incoming.new_start then
          insert into slot_status_overrides (
            slot_id,
            override_date,
            start_time,
            end_time,
            status
          )
          values (
            p_slot_id,
            p_override_date,
            v_existing.start_time,
            v_incoming.new_start,
            v_existing.status
          );
        end if;

        -- ขวาที่เหลือ
        if v_existing.end_time > v_incoming.new_end then
          insert into slot_status_overrides (
            slot_id,
            override_date,
            start_time,
            end_time,
            status
          )
          values (
            p_slot_id,
            p_override_date,
            v_incoming.new_end,
            v_existing.end_time,
            v_existing.status
          );
        end if;

      end if;

    end loop;

  end loop;

  --------------------------------------------------------
  -- STEP 2: Insert incoming
  --------------------------------------------------------

  insert into slot_status_overrides (
    slot_id,
    override_date,
    start_time,
    end_time,
    status
  )
  select
    p_slot_id,
    p_override_date,
    (elem->>'start_time')::time,
    (elem->>'end_time')::time,
    (elem->>'status')::slot_status
  from jsonb_array_elements(p_ranges) as elem;

  --------------------------------------------------------
  -- STEP 3: Merge ทั้งวัน (status เดียวกันเท่านั้น)
  --------------------------------------------------------
  drop table if exists tmp_merge;

  create temporary table tmp_merge
  on commit drop 
  as
  with ordered as (
    select *
    from slot_status_overrides
    where slot_id = p_slot_id
      and override_date = p_override_date
    order by start_time
  ),
  lagged as (
    select *,
      lag(status) over (order by start_time) as prev_status,
      lag(end_time) over (order by start_time) as prev_end
    from ordered
  ),
  grouped as (
    select *,
      sum(
        case
          when prev_status = status
           and prev_end >= start_time
          then 0
          else 1
        end
      ) over (order by start_time) as grp
    from lagged
  )
  select
    min(start_time) as start_time,
    max(end_time) as end_time,
    status
  from grouped
  group by status, grp;

  delete from slot_status_overrides
  where slot_id = p_slot_id
    and override_date = p_override_date;

  insert into slot_status_overrides (
    slot_id,
    override_date,
    start_time,
    end_time,
    status
  )
  select
    p_slot_id,
    p_override_date,
    start_time,
    end_time,
    status
  from tmp_merge;

  --------------------------------------------------------
  -- Success log
  --------------------------------------------------------

  perform insert_activity_log(
    v_site_id,
    'activity'::activity_log_type,
    v_event_name,
    p_user_id,
    p_user_name,
    v_log_level::activity_category,
    'success'::activity_status,
    'slot_status_overrides',
    p_slot_id,
    v_message,
    jsonb_build_object(
      'date', p_override_date,
      'ranges', p_ranges
    ),
    null,
    null,
    null
  );

exception when others then

  perform insert_activity_log(
    v_site_id,
    'activity'::activity_log_type,
    'slot_override_failed',
    p_user_id,
    p_user_name,
    'abnormal'::activity_category,
    'error'::activity_status,
    'slot_status_overrides',
    p_slot_id,
    'Slot schedule update failed',
    null,
    null,
    null,
    jsonb_build_object('error', sqlerrm)
  );

  raise;

end;
$$;


ALTER FUNCTION "public"."admin_upsert_slot_overrides_with_log"("p_slot_id" "text", "p_override_date" "date", "p_ranges" "jsonb", "p_user_id" "uuid", "p_user_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_cancel_expired_pending_reservations"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_cancelled_count INTEGER := 0;
    v_reservation_record RECORD;
BEGIN
    -- Find and update expired pending reservations
    -- A reservation is expired if:
    -- 1. Status is 'pending'
    -- 2. Current time is more than 15 minutes past start_time
    
    FOR v_reservation_record IN
        SELECT 
            id,
            user_id,
            parking_site_id,
            slot_id,
            start_time,
            end_time,
            reserved_at
        FROM public.reservations
        WHERE status = 'pending'
          AND start_time + INTERVAL '15 minutes' < NOW()
        FOR UPDATE -- Lock rows to prevent race conditions
    LOOP
        -- Update status to cancelled
        UPDATE public.reservations
        SET 
            status = 'cancelled',
            updated_at = NOW()
        WHERE id = v_reservation_record.id;
        
        -- Log to reservations_history for audit trail
        INSERT INTO public.reservations_history (
            reservation_id,
            timestamp,
            description,
            details
        ) VALUES (
            v_reservation_record.id,
            NOW(),
            'Auto-cancelled: Pending reservation expired (15+ minutes past start time)',
            jsonb_build_object(
                'previous_status', 'pending',
                'new_status', 'cancelled',
                'start_time', v_reservation_record.start_time,
                'cancelled_at', NOW(),
                'auto_cancel_reason', 'timeout_15_minutes'
            )
        );
        
        v_cancelled_count := v_cancelled_count + 1;
    END LOOP;
    
    -- Log summary if any cancellations occurred
    IF v_cancelled_count > 0 THEN
        RAISE NOTICE 'Auto-cancelled % expired pending reservation(s)', v_cancelled_count;
    END IF;
    
    RETURN v_cancelled_count;
END;
$$;


ALTER FUNCTION "public"."auto_cancel_expired_pending_reservations"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."auto_cancel_expired_pending_reservations"() IS 'Automatically cancels reservations that are still in pending status 15 minutes after their start_time. Returns the count of cancelled reservations. Logs all cancellations to reservations_history table.';



CREATE OR REPLACE FUNCTION "public"."check_double_booking"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.reservations
    WHERE slot_id = NEW.slot_id
      AND status != 'cancelled'
      AND id != NEW.id
      AND tstzrange(start_time, end_time) && tstzrange(NEW.start_time, NEW.end_time)
  ) THEN
    RAISE EXCEPTION 'Double Booking: This slot is already booked.';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."check_double_booking"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_invite_code"("p_code" "text", "p_visitor_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_ticket RECORD;
BEGIN
  -- ล็อก Row นี้ไว้เพื่อป้องกันคนกดพร้อมกัน (Race Condition)
  SELECT * INTO v_ticket FROM access_tickets WHERE invite_code = p_code FOR UPDATE;
  
  IF NOT FOUND THEN
    RETURN '{"success": false, "message": "ไม่พบรหัสคำเชิญนี้"}'::JSONB;
  END IF;

  IF NOW() > v_ticket.expires_at THEN
    RETURN '{"success": false, "message": "รหัสคำเชิญนี้หมดอายุแล้ว"}'::JSONB;
  END IF;

  IF v_ticket.current_usage >= v_ticket.max_usage THEN
    RETURN '{"success": false, "message": "รหัสนี้ถูกใช้งานครบจำนวนแล้ว"}'::JSONB;
  END IF;

  -- ผ่านทุกด่าน -> อัปเดตยอดใช้งาน
  UPDATE access_tickets SET current_usage = current_usage + 1 WHERE id = v_ticket.id;

  RETURN '{"success": true, "message": "ลงทะเบียนรับสิทธิ์เข้าอาคารสำเร็จ"}'::JSONB;
END;
$$;


ALTER FUNCTION "public"."claim_invite_code"("p_code" "text", "p_visitor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."find_best_available_slot"("p_zone_id" "text", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_slot_id TEXT;
  v_slot_name TEXT;
BEGIN
  SELECT s.id, s.name INTO v_slot_id, v_slot_name
  FROM slots s
  WHERE s.zone_id = p_zone_id
  AND s.status = 'available'
  AND NOT EXISTS (
    SELECT 1 FROM reservations r
    WHERE r.slot_id = s.id
    AND r.status IN ('pending', 'checked_in', 'confirmed', 'pending_payment', 'active')
    AND r.start_time < p_end_time 
    AND r.end_time > p_start_time
  )
  -- FIX: Sort by length first to handle text-based number sorting (e.g. '2' before '10')
  ORDER BY length(s.id) ASC, s.id ASC 
  LIMIT 1;

  IF v_slot_id IS NOT NULL THEN
    RETURN jsonb_build_object('slot_id', v_slot_id, 'slot_name', v_slot_name);
  ELSE
    RETURN NULL;
  END IF;
END;
$$;


ALTER FUNCTION "public"."find_best_available_slot"("p_zone_id" "text", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_building_availability"("p_building_id" "text", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone, "p_vehicle_type" "text" DEFAULT 'car'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_results jsonb;
  v_vehicle_code INT;
BEGIN
  -- 1. Standardize Vehicle Code Mapping
  IF p_vehicle_type = 'motorcycle' THEN v_vehicle_code := 0;
  ELSIF p_vehicle_type = 'ev' THEN v_vehicle_code := 2;
  ELSE v_vehicle_code := 1; -- default 'car'
  END IF;

  SELECT jsonb_agg(
      jsonb_build_object(
          'id', f.id,
          'name', f.name,
          'capacity', COALESCE(floor_stats.total_capacity, 0),
          'totalAvailable', COALESCE(floor_stats.total_available, 0),
          'zones', COALESCE(floor_stats.zones_data, '[]'::jsonb)
      )
  ) INTO v_results
  FROM floors f
  JOIN buildings b ON f.building_id = b.id
  LEFT JOIN LATERAL (
      SELECT 
          SUM(z_stats.capacity) as total_capacity,
          SUM(z_stats.available) as total_available,
          jsonb_agg(
              jsonb_build_object(
                  'id', z_stats.zone_id,
                  'name', z_stats.zone_name,
                  'capacity', z_stats.capacity,
                  'available', z_stats.available,
                  'status', CASE WHEN z_stats.available > 0 THEN 'available' ELSE 'full' END
              ) ORDER BY z_stats.zone_name
          ) as zones_data
      FROM (
          SELECT 
              z.id as zone_id,
              z.name as zone_name,
              COUNT(s.id) as capacity,
              (
                  COUNT(s.id) - 
                  COUNT(
                      CASE WHEN EXISTS (
                          SELECT 1 FROM reservations r
                          WHERE r.slot_id = s.id
                          -- 2. Status Check: Must include active/confirmed
                          AND r.status IN ('pending', 'checked_in', 'confirmed', 'pending_payment', 'active')
                          -- 3. Overlap Check: [Start, End) overlap
                          AND r.start_time < p_end_time 
                          AND r.end_time > p_start_time
                      ) THEN 1 END
                  )
              ) as available
          FROM zones z
          JOIN slots s ON s.zone_id = z.id
          WHERE z.floor_id = f.id
          AND s.status = 'available' -- Only count currently functioning slots
          -- 4. Vehicle Type Filter
          AND (
             s.vehicle_type_code = v_vehicle_code 
             OR (p_vehicle_type = 'car' AND s.vehicle_type_code IS NULL)
          )
          GROUP BY z.id, z.name
      ) z_stats
  ) floor_stats ON true
  WHERE b.id = p_building_id;

  RETURN COALESCE(v_results, '[]'::jsonb);
END;
$$;


ALTER FUNCTION "public"."get_building_availability"("p_building_id" "text", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone, "p_vehicle_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_building_slots_availability"("p_building_id" "text", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone, "p_interval_minutes" integer, "p_vehicle_type" "text", "p_duration_minutes" integer DEFAULT NULL::integer) RETURNS TABLE("slot_time" timestamp with time zone, "total_capacity" bigint, "reserved_count" bigint, "available_count" bigint)
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_vehicle_code INT;
  v_duration_interval INTERVAL;
BEGIN
  -- Map text input to integer code
  IF p_vehicle_type = 'motorcycle' THEN v_vehicle_code := 0;
  ELSIF p_vehicle_type = 'ev' THEN v_vehicle_code := 2;
  ELSE v_vehicle_code := 1; -- default 'car'
  END IF;

  -- Use provided duration or fallback to interval (step)
  v_duration_interval := (COALESCE(p_duration_minutes, p_interval_minutes) || ' minutes')::INTERVAL;

  RETURN QUERY
  WITH 
  -- Generate Time Series
  time_series AS (
    SELECT generate_series(p_start_time, p_end_time, (p_interval_minutes || ' minutes')::INTERVAL) AS t_start
  ),
  
  -- Calculate Total Capacity for Vehicle Type
  building_capacity AS (
    SELECT 
      COUNT(s.id) AS total_slots
    FROM slots s
    JOIN floors f ON s.floor_id = f.id
    WHERE f.building_id = p_building_id
    AND s.status = 'available' -- Only count currently functioning slots
    AND (
      p_vehicle_type IS NULL 
      OR s.vehicle_type_code = v_vehicle_code 
      OR (p_vehicle_type = 'car' AND s.vehicle_type_code IS NULL)
    )
  ),
  
  -- Count Overlapping Reservations per Time Slot
  slot_reservations AS (
    SELECT 
      ts.t_start,
      COUNT(DISTINCT r_filtered.slot_id) AS reserved_qty -- Count DISTINCT slots occupied
    FROM time_series ts
    LEFT JOIN (
      SELECT r.start_time, r.end_time, r.id, r.slot_id
      FROM reservations r
      JOIN slots s ON r.slot_id = s.id
      JOIN floors f ON s.floor_id = f.id
      WHERE f.building_id = p_building_id
      AND (
          p_vehicle_type IS NULL 
          OR s.vehicle_type_code = v_vehicle_code
          OR (p_vehicle_type = 'car' AND s.vehicle_type_code IS NULL)
      )
      AND r.status IN ('pending', 'checked_in', 'confirmed', 'pending_payment', 'active')
    ) r_filtered ON 
      (r_filtered.start_time < (ts.t_start + v_duration_interval)  -- Check overlap with FULL DURATION
      AND r_filtered.end_time > ts.t_start)
    GROUP BY ts.t_start
  )
  
  -- Final Result
  SELECT 
    ts.t_start,
    COALESCE(bc.total_slots, 0) as total_capacity,
    COALESCE(sr.reserved_qty, 0) as reserved_count,
    GREATEST(0, COALESCE(bc.total_slots, 0) - COALESCE(sr.reserved_qty, 0)) as available_count
  FROM time_series ts
  CROSS JOIN building_capacity bc
  LEFT JOIN slot_reservations sr ON ts.t_start = sr.t_start;

END;
$$;


ALTER FUNCTION "public"."get_building_slots_availability"("p_building_id" "text", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone, "p_interval_minutes" integer, "p_vehicle_type" "text", "p_duration_minutes" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_site_availability"("p_site_id" "text", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone, "p_vehicle_type" "text" DEFAULT 'car'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_vehicle_code int;
  v_results jsonb;
BEGIN
  -- Map text to code
  IF p_vehicle_type = 'motorcycle' THEN v_vehicle_code := 0;
  ELSIF p_vehicle_type = 'ev' THEN v_vehicle_code := 2;
  ELSE v_vehicle_code := 1; -- default car
  END IF;
  SELECT jsonb_agg(
      jsonb_build_object(
          'id', f.id,
          'name', f.name,
          'capacity', COALESCE(floor_stats.total_capacity, 0),
          'totalAvailable', COALESCE(floor_stats.total_available, 0),
          'zones', COALESCE(floor_stats.zones_data, '[]'::jsonb)
      )
  ) INTO v_results
  FROM floors f
  JOIN buildings b ON f.building_id = b.id
  LEFT JOIN LATERAL (
      SELECT 
          SUM(z_stats.capacity) as total_capacity,
          SUM(z_stats.available) as total_available,
          jsonb_agg(
              jsonb_build_object(
                  'id', z_stats.zone_id,
                  'name', z_stats.zone_name,
                  'capacity', z_stats.capacity,
                  'available', z_stats.available,
                  'status', CASE WHEN z_stats.available > 0 THEN 'available' ELSE 'full' END
              ) ORDER BY z_stats.zone_name
          ) as zones_data
      FROM (
          SELECT 
              z.id as zone_id,
              z.name as zone_name,
              COUNT(s.id) as capacity,
              (
                  COUNT(s.id) - 
                  COUNT(
                      CASE WHEN EXISTS (
                          SELECT 1 FROM reservations r
                          WHERE r.slot_id = s.id
                          -- FIX: Update Reservation Status Check
                          AND r.status IN ('pending', 'checked_in', 'confirmed', 'pending_payment', 'active')
                          AND tstzrange(r.start_time, r.end_time) && tstzrange(p_start_time, p_end_time)
                      ) THEN 1 END
                  )
              ) as available
          FROM zones z
          JOIN slots s ON s.zone_id = z.id
          WHERE z.floor_id = f.id
          AND s.vehicle_type_code = v_vehicle_code
          AND s.status = 'available'
          GROUP BY z.id, z.name
      ) z_stats
  ) floor_stats ON true
  WHERE b.parking_site_id = p_site_id;
  RETURN COALESCE(v_results, '[]'::jsonb);
END;
$$;


ALTER FUNCTION "public"."get_site_availability"("p_site_id" "text", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone, "p_vehicle_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_site_buildings"("p_site_id" "text", "p_lat" double precision DEFAULT 0, "p_lng" double precision DEFAULT 0, "p_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_results jsonb;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', b.id,
      'name', b.name,
      'capacity', jsonb_build_object(
        'normal', COALESCE(stats.cap_normal, 0),
        'ev', COALESCE(stats.cap_ev, 0),
        'motorcycle', COALESCE(stats.cap_moto, 0)
      ),
      'available', jsonb_build_object(
        'normal', COALESCE(stats.avail_normal, 0),
        'ev', COALESCE(stats.avail_ev, 0),
        'motorcycle', COALESCE(stats.avail_moto, 0)
      ),
      'floors', COALESCE(floors_agg.data, '[]'::jsonb),
      'mapX', COALESCE(b.map_x, 0),
      'mapY', COALESCE(b.map_y, 0),
      'lat', b.lat,
      'lng', b.lng,
      'status', CASE 
        WHEN (COALESCE(stats.avail_normal, 0) + COALESCE(stats.avail_ev, 0) + COALESCE(stats.avail_moto, 0)) > 0 THEN 'available'
        ELSE 'full'
      END,
      'isBookmarked', CASE 
        WHEN p_user_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM user_bookmarks ub 
          WHERE ub.building_id = b.id AND ub.user_id = p_user_id
        ) THEN true 
        ELSE false 
      END,
      'distance', (
        CASE 
          WHEN p_lat IS NULL OR p_lng IS NULL OR (p_lat = 0 AND p_lng = 0) THEN 0
          ELSE 
             (
                6371 * acos(
                    LEAST(1.0, GREATEST(-1.0, 
                        cos(radians(p_lat)) * cos(radians(b.lat)) * cos(radians(b.lng) - radians(p_lng)) + 
                        sin(radians(p_lat)) * sin(radians(b.lat))
                    ))
                )
             )
        END
      ),
      'hours', format('เปิด %s - %s', COALESCE(to_char(b.open_time, 'HH24:MI'), '08:00'), COALESCE(to_char(b.close_time, 'HH24:MI'), '20:00')),
      'hasEVCharger', (COALESCE(stats.cap_ev, 0) > 0),
      'userTypes', array_to_string(b.allowed_user_types, ', '),
      'price', COALESCE(b.price_per_hour, 0),
      'priceUnit', CASE WHEN COALESCE(b.price_per_hour, 0) = 0 THEN 'ฟรี' ELSE 'บาท/ชม.' END,
      'supportedTypes', (
        SELECT jsonb_agg(t)
        FROM (
          SELECT 'normal' as t WHERE COALESCE(stats.cap_normal, 0) > 0
          UNION ALL
          SELECT 'ev' as t WHERE COALESCE(stats.cap_ev, 0) > 0
          UNION ALL
          SELECT 'motorcycle' as t WHERE COALESCE(stats.cap_moto, 0) > 0
        ) types
      ),
      'schedule', CASE 
        WHEN b.schedule_config IS NOT NULL AND jsonb_array_length(b.schedule_config) > 0 THEN b.schedule_config
        ELSE jsonb_build_array(
          jsonb_build_object(
            'days', '[]'::jsonb,
            'open_time', COALESCE(to_char(b.open_time, 'HH24:MI'), '08:00'),
            'close_time', COALESCE(to_char(b.close_time, 'HH24:MI'), '20:00'),
            'cron', jsonb_build_object(
              'open', format('%s %s * * *', 
                 COALESCE(extract(minute from b.open_time), 0), 
                 COALESCE(extract(hour from b.open_time), 8)
              ),
              'close', format('%s %s * * *', 
                 COALESCE(extract(minute from b.close_time), 0), 
                 COALESCE(extract(hour from b.close_time), 20)
              )
            )
          )
        )
      END,
      'images', COALESCE(to_jsonb(b.images), '[]'::jsonb) -- FIXED: Added to_jsonb() conversion
    )
  ) INTO v_results
  FROM buildings b
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object('id', f.id, 'name', f.name) 
      ORDER BY f.name
    ) as data
    FROM floors f
    WHERE f.building_id = b.id
  ) floors_agg ON true
  LEFT JOIN LATERAL (
    SELECT 
      SUM(CASE WHEN s.vehicle_type_code NOT IN (0, 2) OR s.vehicle_type_code IS NULL THEN 1 ELSE 0 END) as cap_normal,
      SUM(CASE WHEN s.vehicle_type_code = 2 THEN 1 ELSE 0 END) as cap_ev,
      SUM(CASE WHEN s.vehicle_type_code = 0 THEN 1 ELSE 0 END) as cap_moto,
      SUM(CASE WHEN (s.vehicle_type_code NOT IN (0, 2) OR s.vehicle_type_code IS NULL) AND s.status = 'available' THEN 1 ELSE 0 END) as avail_normal,
      SUM(CASE WHEN s.vehicle_type_code = 2 AND s.status = 'available' THEN 1 ELSE 0 END) as avail_ev,
      SUM(CASE WHEN s.vehicle_type_code = 0 AND s.status = 'available' THEN 1 ELSE 0 END) as avail_moto
    FROM slots s
    WHERE s.floor_id LIKE (b.id || '%')
  ) stats ON true
  WHERE b.parking_site_id = p_site_id;
  RETURN COALESCE(v_results, '[]'::jsonb);
END;
$$;


ALTER FUNCTION "public"."get_site_buildings"("p_site_id" "text", "p_lat" double precision, "p_lng" double precision, "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."insert_activity_log"("p_log_type" "public"."activity_log_type", "p_action" "text", "p_user_id" "uuid", "p_user_name" "text", "p_category" "public"."activity_category", "p_status" "public"."activity_status", "p_entity_type" "text", "p_entity_id" "text", "p_detail" "text", "p_changes" "jsonb", "p_meta" "jsonb" DEFAULT NULL::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin

  insert into activity_logs (
    log_type,
    action,
    user_id,
    user_name,
    category,
    status,
    entity_type,
    entity_id,
    detail,
    changes,
    meta
  )
  values (
    p_log_type,
    p_action,
    p_user_id,
    p_user_name,
    p_category,
    p_status,
    p_entity_type,
    p_entity_id,
    p_detail,
    p_changes,
    p_meta
  );

end;
$$;


ALTER FUNCTION "public"."insert_activity_log"("p_log_type" "public"."activity_log_type", "p_action" "text", "p_user_id" "uuid", "p_user_name" "text", "p_category" "public"."activity_category", "p_status" "public"."activity_status", "p_entity_type" "text", "p_entity_id" "text", "p_detail" "text", "p_changes" "jsonb", "p_meta" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."insert_activity_log"("p_log_type" "public"."activity_log_type", "p_action" "text", "p_user_id" "uuid", "p_user_name" "text", "p_category" "public"."activity_category", "p_status" "public"."activity_status", "p_entity_type" "text", "p_entity_id" "uuid", "p_detail" "text", "p_changes" "jsonb", "p_meta" "jsonb" DEFAULT NULL::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin

  insert into activity_logs (
    log_type,
    action,
    user_id,
    user_name,
    category,
    status,
    entity_type,
    entity_id,
    detail,
    changes,
    meta
  )
  values (
    p_log_type,
    p_action,
    p_user_id,
    p_user_name,
    p_category,
    p_status,
    p_entity_type,
    p_entity_id,
    p_detail,
    p_changes,
    p_meta
  );

end;
$$;


ALTER FUNCTION "public"."insert_activity_log"("p_log_type" "public"."activity_log_type", "p_action" "text", "p_user_id" "uuid", "p_user_name" "text", "p_category" "public"."activity_category", "p_status" "public"."activity_status", "p_entity_type" "text", "p_entity_id" "uuid", "p_detail" "text", "p_changes" "jsonb", "p_meta" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."insert_activity_log"("p_log_type" "public"."activity_log_type", "p_action" "text", "p_user_id" "uuid", "p_user_name" "text", "p_category" "public"."activity_category", "p_status" "public"."activity_status", "p_entity_type" "text", "p_entity_id" "text", "p_detail" "text", "p_changes" "jsonb", "p_old_data" "jsonb" DEFAULT NULL::"jsonb", "p_new_data" "jsonb" DEFAULT NULL::"jsonb", "p_meta" "jsonb" DEFAULT NULL::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin

  insert into activity_logs (
    log_type,
    action,
    user_id,
    user_name,
    category,
    status,
    entity_type,
    entity_id,
    detail,
    changes,
    old_data,
    new_data,
    meta
  )
  values (
    p_log_type,
    p_action,
    p_user_id,
    p_user_name,
    p_category,
    p_status,
    p_entity_type,
    p_entity_id,
    p_detail,
    p_changes,
    p_old_data,
    p_new_data,
    p_meta
  );

end;
$$;


ALTER FUNCTION "public"."insert_activity_log"("p_log_type" "public"."activity_log_type", "p_action" "text", "p_user_id" "uuid", "p_user_name" "text", "p_category" "public"."activity_category", "p_status" "public"."activity_status", "p_entity_type" "text", "p_entity_id" "text", "p_detail" "text", "p_changes" "jsonb", "p_old_data" "jsonb", "p_new_data" "jsonb", "p_meta" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."insert_activity_log"("p_site_id" "text", "p_log_type" "public"."activity_log_type", "p_action" "text", "p_user_id" "uuid", "p_user_name" "text", "p_category" "public"."activity_category", "p_status" "public"."activity_status", "p_entity_type" "text", "p_entity_id" "text", "p_detail" "text", "p_changes" "jsonb", "p_old_data" "jsonb" DEFAULT NULL::"jsonb", "p_new_data" "jsonb" DEFAULT NULL::"jsonb", "p_meta" "jsonb" DEFAULT NULL::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin

  insert into activity_logs (
    site_id,
    log_type,
    action,
    user_id,
    user_name,
    category,
    status,
    entity_type,
    entity_id,
    detail,
    changes,
    old_data,
    new_data,
    meta
  )
  values (
    p_site_id,
    p_log_type,
    p_action,
    p_user_id,
    p_user_name,
    p_category,
    p_status,
    p_entity_type,
    p_entity_id,
    p_detail,
    p_changes,
    p_old_data,
    p_new_data,
    p_meta
  );

end;
$$;


ALTER FUNCTION "public"."insert_activity_log"("p_site_id" "text", "p_log_type" "public"."activity_log_type", "p_action" "text", "p_user_id" "uuid", "p_user_name" "text", "p_category" "public"."activity_category", "p_status" "public"."activity_status", "p_entity_type" "text", "p_entity_id" "text", "p_detail" "text", "p_changes" "jsonb", "p_old_data" "jsonb", "p_new_data" "jsonb", "p_meta" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_events_and_update_version"("p_aggregate_id" "uuid", "p_expected_version" integer, "p_new_version" integer, "p_events" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    current_version integer;
    event_record jsonb;
BEGIN
    -- 1. Lock row in latest_versions (if exists) or prepare for insert
    SELECT version INTO current_version
    FROM public.latest_versions
    WHERE aggregate_id = p_aggregate_id
    FOR UPDATE;

    IF NOT FOUND THEN
        current_version := 0; -- Treat as version 0 if no record exists yet
    END IF;

    -- 2. Check version
    IF current_version != p_expected_version THEN
        -- Throw a specific error if versions don't match
        RAISE EXCEPTION 'CONCURRENCY_ERROR: Expected version % but found % for aggregate %', p_expected_version, current_version, p_aggregate_id
              USING ERRCODE = 'P0001'; -- Use a custom error code if desired
    END IF;

    -- 3. If version is correct -> Insert new events into event_store
    FOR event_record IN SELECT * FROM jsonb_array_elements(p_events)
    LOOP
        INSERT INTO public.event_store (aggregate_id, aggregate_type, event_type, event_data, version, created_at)
        VALUES (
            (event_record->>'aggregate_id')::uuid,
            event_record->>'aggregate_type',
            event_record->>'event_type',
            event_record->'event_data',
            (event_record->>'version')::integer,
            NOW()
        );
    END LOOP;

    -- 4. Update (or insert) the row in latest_versions to the new version
    INSERT INTO public.latest_versions (aggregate_id, version, updated_at)
    VALUES (p_aggregate_id, p_new_version, NOW())
    ON CONFLICT (aggregate_id) DO UPDATE SET
      version = EXCLUDED.version,
      updated_at = NOW();

END;
$$;


ALTER FUNCTION "public"."save_events_and_update_version"("p_aggregate_id" "uuid", "p_expected_version" integer, "p_new_version" integer, "p_events" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_events_and_update_version"("p_aggregate_id" "uuid", "p_expected_version" integer, "p_new_version" integer, "p_events" "jsonb", "p_latest_event_data" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    current_version integer;
    event_record jsonb;
BEGIN
    -- 1. Lock & Check
    SELECT version INTO current_version
    FROM public.latest_versions
    WHERE aggregate_id = p_aggregate_id
    FOR UPDATE;

    IF NOT FOUND THEN
        current_version := 0;
    END IF;

    IF current_version != p_expected_version THEN
        RAISE EXCEPTION 'CONCURRENCY_ERROR: Expected version % but found % for aggregate %', p_expected_version, current_version, p_aggregate_id
              USING ERRCODE = 'P0001';
    END IF;

    -- 2. Insert Events
    FOR event_record IN SELECT * FROM jsonb_array_elements(p_events)
    LOOP
        INSERT INTO public.event_store (aggregate_id, aggregate_type, event_type, event_data, version, created_at)
        VALUES (
            (event_record->>'aggregate_id')::uuid,
            event_record->>'aggregate_type',
            event_record->>'event_type',
            event_record->'event_data',
            (event_record->>'version')::integer,
            NOW()
        );
    END LOOP;

    -- 3. Update Latest Version
    INSERT INTO public.latest_versions (aggregate_id, version, updated_at, latest_event_data)
    VALUES (p_aggregate_id, p_new_version, NOW(), p_latest_event_data)
    ON CONFLICT (aggregate_id) DO UPDATE SET
      version = EXCLUDED.version,
      updated_at = NOW(),
      latest_event_data = EXCLUDED.latest_event_data;
END;
$$;


ALTER FUNCTION "public"."save_events_and_update_version"("p_aggregate_id" "uuid", "p_expected_version" integer, "p_new_version" integer, "p_events" "jsonb", "p_latest_event_data" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_vehicle_type_logic"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.vehicle_type = 'motorcycle' THEN
      NEW.vehicle_type_code := 0;
  ELSIF NEW.vehicle_type = 'car' THEN
      NEW.vehicle_type_code := 1;
  ELSIF NEW.vehicle_type = 'ev' THEN
      NEW.vehicle_type_code := 2;
  ELSIF NEW.vehicle_type = 'other' THEN
      NEW.vehicle_type_code := 3;
  ELSE
      NEW.vehicle_type_code := 1; -- Default to car if unknown
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_vehicle_type_logic"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_config_with_log"("p_entity_type" "text", "p_entity_id" "text", "p_updates" "jsonb", "p_user_id" "uuid", "p_user_name" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_old_data jsonb;
  v_new_data jsonb;
  v_changes jsonb := '{}';
  v_key text;
  v_columns text;
begin
  -- 🔹 0. normalize entity_type
  p_entity_type := lower(p_entity_type);

  -- 🔹 1. ตรวจ entity_type
  if p_entity_type not in ('buildings','floors','zones','slots') then
    raise exception 'Invalid entity type';
  end if;

  -- 🔹 2. ดึงข้อมูลเก่า
  execute format(
    'select to_jsonb(t) from %I t where id = $1',
    p_entity_type
  )
  into v_old_data
  using p_entity_id;

  if v_old_data is null then
    raise exception 'Entity not found';
  end if;

  -- 🔹 4. สร้าง column list
  select string_agg(quote_ident(key), ', ')
  into v_columns
  from jsonb_object_keys(p_updates) as key;

  if v_columns is null then
    raise exception 'Invalid update keys';
  end if;

  -- 🔹 5. UPDATE แบบ type-safe
  execute format(
    'update %I
     set (%s) = (
       select %s
       from jsonb_populate_record(null::%I, $2)
     )
     where id = $1
     returning to_jsonb(%I)',
    p_entity_type,
    v_columns,
    v_columns,
    p_entity_type,
    p_entity_type
  )
  into v_new_data
  using p_entity_id, p_updates;

  -- 🔹 4. สร้าง changes diff
  for v_key in select key from jsonb_each(p_updates)
  loop
    v_changes := v_changes || jsonb_build_object(
      v_key,
      jsonb_build_object(
        'old', v_old_data -> v_key,
        'new', v_new_data -> v_key
      )
    );
  end loop;

  -- 🔹 5. insert activity log
  perform insert_activity_log(
    'revision',
    'update_' || p_entity_type,
    p_user_id,
    p_user_name,
    'normal',
    'success',
    p_entity_type,
    p_entity_id,
    'Updated ' || p_entity_type,
    v_changes,
    null
  );

end;
$_$;


ALTER FUNCTION "public"."update_config_with_log"("p_entity_type" "text", "p_entity_id" "text", "p_updates" "jsonb", "p_user_id" "uuid", "p_user_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_multiple_entities_with_log"("p_payload" "jsonb", "p_user_id" "uuid", "p_user_name" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_entity jsonb;
  v_entity_type text;
  v_entity_id text;
  v_updates jsonb;
  old_data jsonb;
  new_data jsonb;
  v_changes jsonb;
  v_key text;
  v_site_id text;
begin

  if p_payload->'entities' is null then
    raise exception 'Invalid payload: entities missing';
  end if;

  ----------------------------------------------------------------
  -- LOOP EACH ENTITY
  ----------------------------------------------------------------

  for v_entity in
    select * from jsonb_array_elements(p_payload->'entities')
  loop

    v_entity_type := v_entity->>'entity_type';
    v_entity_id   := v_entity->>'entity_id';
    v_updates     := v_entity->'updates';

    if v_entity_type is null or v_entity_id is null then
      raise exception 'Invalid entity structure';
    end if;

    ----------------------------------------------------------------
    -- BUILDINGS
    ----------------------------------------------------------------
    if v_entity_type = 'buildings' then

      select to_jsonb(b) into old_data
      from buildings b
      where b.id = v_entity_id
      for update;

      if old_data is null then
        raise exception 'Building not found: %', v_entity_id;
      end if;

      v_site_id := old_data->>'parking_site_id';

      update buildings
      set
        name              = coalesce(v_updates->>'name', name),
        lat               = coalesce((v_updates->>'lat')::float8, lat),
        lng               = coalesce((v_updates->>'lng')::float8, lng),
        map_x             = coalesce((v_updates->>'map_x')::integer, map_x),
        map_y             = coalesce((v_updates->>'map_y')::integer, map_y),
        images            = case
                              when v_updates ? 'images' then
                                coalesce(
                                  (
                                    select array_agg(value)
                                    from jsonb_array_elements_text(v_updates->'images')
                                  ),
                                  '{}'
                                )
                              else images
                            end,
        price_per_hour    = coalesce((v_updates->>'price_per_hour')::numeric, price_per_hour),
        schedule_config   = coalesce((v_updates->'schedule_config')::jsonb, schedule_config),
        open_time         = coalesce((v_updates->>'open_time')::time, open_time),
        close_time        = coalesce((v_updates->>'close_time')::time, close_time),
        price_info        = coalesce(v_updates->>'price_info', price_info),
        price_value       = coalesce((v_updates->>'price_value')::integer, price_value),
        user_types        = coalesce(v_updates->>'user_types', user_types),
        address           = coalesce(v_updates->>'address', address),
        is_active         = coalesce((v_updates->>'is_active')::boolean, is_active),
        capacity          = coalesce((v_updates->>'capacity')::integer, capacity)
      where id = v_entity_id;

      select to_jsonb(b) into new_data
      from buildings b
      where b.id = v_entity_id;


    ----------------------------------------------------------------
    -- FLOORS
    ----------------------------------------------------------------
    elsif v_entity_type = 'floors' then

      select to_jsonb(f) into old_data
      from floors f
      where f.id = v_entity_id
      for update;

      if old_data is null then
        raise exception 'Floor not found: %', v_entity_id;
      end if;

      -- ✅ ใส่ตรงนี้
      select b.parking_site_id
      into v_site_id
      from floors f
      join buildings b on b.id = f.building_id
      where f.id = v_entity_id;

      update floors
      set
        name        = coalesce(v_updates->>'name', name),
        level_order = coalesce((v_updates->>'level_order')::integer, level_order)
      where id = v_entity_id;

      select to_jsonb(f) into new_data
      from floors f
      where f.id = v_entity_id;


    ----------------------------------------------------------------
    -- ZONES
    ----------------------------------------------------------------
    elsif v_entity_type = 'zones' then

      select to_jsonb(z) into old_data
      from zones z
      where z.id = v_entity_id
      for update;

      if old_data is null then
        raise exception 'Zone not found: %', v_entity_id;
      end if;

      -- ✅ ใส่ตรงนี้
      select b.parking_site_id
      into v_site_id
      from zones z
      join floors f on f.id = z.floor_id
      join buildings b on b.id = f.building_id
      where z.id = v_entity_id;
      
      update zones
      set
        name = coalesce(v_updates->>'name', name)
      where id = v_entity_id;

      select to_jsonb(z) into new_data
      from zones z
      where z.id = v_entity_id;


    ----------------------------------------------------------------
    -- SLOTS
    ----------------------------------------------------------------
    elsif v_entity_type = 'slots' then

      select to_jsonb(s) into old_data
      from slots s
      where s.id = v_entity_id
      for update;


      if old_data is null then
        raise exception 'Slot not found: %', v_entity_id;
      end if;

      -- ✅ ดึงจาก old_data ตรงนี้
      v_site_id := old_data->>'parking_site_id';

      update slots
      set
        name               = coalesce(v_updates->>'name', name),
        slot_number        = coalesce((v_updates->>'slot_number')::integer, slot_number),
        status             = coalesce(
                                      (v_updates->>'status')::slot_status,
                                      status
                                     ),
        details            = coalesce(v_updates->>'details', details),
        vehicle_type       = coalesce(
                                      (v_updates->>'vehicle_type')::vehicle_type,
                                      vehicle_type
                                     ),
        vehicle_type_code  = coalesce((v_updates->>'vehicle_type_code')::integer, vehicle_type_code),
        version            = coalesce((v_updates->>'version')::integer, version)
      where id = v_entity_id;

      select to_jsonb(s) into new_data
      from slots s
      where s.id = v_entity_id;

    else
      raise exception 'Unsupported entity type: %', v_entity_type;
    end if;


    ----------------------------------------------------------------
    -- คำนวณ diff เฉพาะ field ที่เปลี่ยนจริง
    ----------------------------------------------------------------
    v_changes := '{}'::jsonb;

    for v_key in
      select jsonb_object_keys(v_updates)
    loop
      if old_data->v_key is distinct from new_data->v_key then
        v_changes := v_changes || jsonb_build_object(
          v_key,
          jsonb_build_object(
            'old', old_data->v_key,
            'new', new_data->v_key
          )
        );
      end if;
    end loop;

    ----------------------------------------------------------------
    -- insert log เฉพาะเมื่อมีการเปลี่ยนจริง
    ----------------------------------------------------------------
    for v_key in
      select jsonb_object_keys(v_changes)
    loop

      if v_key in ('status', 'is_active') then

        perform insert_activity_log(
          v_site_id,
          'activity',
          'status_changed',
          p_user_id,
          p_user_name,
          'normal',
          'success',
          v_entity_type,
          v_entity_id,
          format('%s status changed', v_entity_type),
          jsonb_build_object(v_key, v_changes->v_key),
          old_data,
          new_data,
          null
        );

      else

        perform insert_activity_log(
          v_site_id,
          'revision',
          'field_updated',
          p_user_id,
          p_user_name,
          'normal',
          'success',
          v_entity_type,
          v_entity_id,
          format('%s %s updated', v_entity_type, v_key),
          jsonb_build_object(v_key, v_changes->v_key),
          old_data,
          new_data,
          null
        );

      end if;

    end loop;

  end loop;

exception when others then

  perform insert_activity_log(
    v_site_id,
    'activity',
    'update_failed',
    p_user_id,
    p_user_name,
    'abnormal',
    'error',
    null,
    null,
    'Bulk update failed',
    null,
    null,
    null,
    jsonb_build_object(
      'error', sqlerrm,
      'payload', p_payload
    )
  );

  raise;

end;
$$;


ALTER FUNCTION "public"."update_multiple_entities_with_log"("p_payload" "jsonb", "p_user_id" "uuid", "p_user_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."access_tickets" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "invite_code" "text" NOT NULL,
    "building_id" "text" NOT NULL,
    "floor" integer,
    "room_id" "text",
    "max_usage" integer DEFAULT 1,
    "current_usage" integer DEFAULT 0,
    "pass_type" "text" NOT NULL,
    "host_id" "uuid",
    "valid_from" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."access_tickets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."activity_logs" (
    "id" bigint NOT NULL,
    "time" timestamp with time zone DEFAULT "now"() NOT NULL,
    "log_type" "public"."activity_log_type" NOT NULL,
    "action" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "user_name" "text" NOT NULL,
    "category" "public"."activity_category" NOT NULL,
    "status" "public"."activity_status" NOT NULL,
    "entity_type" "text",
    "entity_id" "text",
    "detail" "text",
    "changes" "jsonb",
    "meta" "jsonb",
    "old_data" "jsonb",
    "new_data" "jsonb",
    "site_id" "text" NOT NULL,
    CONSTRAINT "revision_requires_entity_id" CHECK (((("log_type" = 'revision'::"public"."activity_log_type") AND ("entity_id" IS NOT NULL)) OR ("log_type" = 'activity'::"public"."activity_log_type"))),
    CONSTRAINT "revision_requires_entity_type" CHECK (((("log_type" = 'revision'::"public"."activity_log_type") AND ("entity_type" IS NOT NULL)) OR ("log_type" = 'activity'::"public"."activity_log_type")))
);


ALTER TABLE "public"."activity_logs" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."activity_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."activity_logs_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."activity_logs_id_seq" OWNED BY "public"."activity_logs"."id";



CREATE TABLE IF NOT EXISTS "public"."buildings" (
    "id" "text" NOT NULL,
    "parking_site_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "lat" double precision DEFAULT 0,
    "lng" double precision DEFAULT 0,
    "map_x" integer DEFAULT 0,
    "map_y" integer DEFAULT 0,
    "images" "text"[] DEFAULT '{}'::"text"[],
    "allowed_user_types" "text"[] DEFAULT '{นศ.,บุคลากร}'::"text"[],
    "price_per_hour" numeric DEFAULT 0,
    "schedule_config" "jsonb" DEFAULT '[]'::"jsonb",
    "open_time" time without time zone DEFAULT '08:00:00'::time without time zone,
    "close_time" time without time zone DEFAULT '20:00:00'::time without time zone,
    "price_info" "text" DEFAULT 'ฟรี'::"text",
    "price_value" integer DEFAULT 0,
    "user_types" "text" DEFAULT 'นศ., บุคลากร'::"text",
    "address" "text",
    "is_active" boolean DEFAULT true,
    "capacity" integer DEFAULT 0
);


ALTER TABLE "public"."buildings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cars" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "license_plate" character varying NOT NULL,
    "model" character varying,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "vehicle_type" "public"."vehicle_type" DEFAULT 'car'::"public"."vehicle_type" NOT NULL,
    "vehicle_type_code" smallint DEFAULT 1,
    "image" "text",
    "is_default" boolean DEFAULT false,
    "rank" integer DEFAULT 0,
    "province" "text" DEFAULT 'กรุงเทพฯ'::"text",
    "color" "text",
    "is_active" boolean DEFAULT true,
    CONSTRAINT "cars_vehicle_type_code_check" CHECK (("vehicle_type_code" = ANY (ARRAY[0, 1, 2, 3])))
);


ALTER TABLE "public"."cars" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_store" (
    "id" bigint NOT NULL,
    "aggregate_id" "uuid" NOT NULL,
    "aggregate_type" character varying NOT NULL,
    "event_type" character varying NOT NULL,
    "event_data" "jsonb" NOT NULL,
    "version" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."event_store" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."event_store_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."event_store_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."event_store_id_seq" OWNED BY "public"."event_store"."id";



CREATE TABLE IF NOT EXISTS "public"."floors" (
    "id" "text" NOT NULL,
    "building_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "level_order" integer DEFAULT 0,
    "layout_data" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."floors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."latest_versions" (
    "aggregate_id" "uuid" NOT NULL,
    "version" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "latest_event_data" "jsonb"
);


ALTER TABLE "public"."latest_versions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."parking_sites" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "code" "text" NOT NULL,
    "description" "text",
    "timezone" "text" DEFAULT 'Asia/Bangkok'::"text",
    "timezone_offset" integer DEFAULT 420,
    "status" "public"."site_status" DEFAULT 'active'::"public"."site_status" NOT NULL,
    "opening_time" time without time zone DEFAULT '08:00:00'::time without time zone,
    "closing_time" time without time zone DEFAULT '20:00:00'::time without time zone
);


ALTER TABLE "public"."parking_sites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "phone" "text",
    "avatar" "text",
    "line_id" "text",
    "email" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "role_level" integer,
    "role" "text"
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."recent_activities" (
    "id" bigint NOT NULL,
    "reservation_id" "uuid" NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "slot_id" character varying,
    "status" character varying,
    "start_time" timestamp with time zone,
    "end_time" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "vehicle_type" "public"."vehicle_type",
    "vehicle_type_code" smallint DEFAULT 1
);


ALTER TABLE "public"."recent_activities" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."recent_activities_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."recent_activities_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."recent_activities_id_seq" OWNED BY "public"."recent_activities"."id";



CREATE TABLE IF NOT EXISTS "public"."reservations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "parking_site_id" "text" NOT NULL,
    "floor_id" "text",
    "slot_id" "text",
    "status" "public"."reservation_status" DEFAULT 'pending'::"public"."reservation_status" NOT NULL,
    "start_time" timestamp with time zone,
    "end_time" timestamp with time zone,
    "reserved_at" timestamp with time zone DEFAULT "now"(),
    "version" integer DEFAULT 1 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "status_code" "text" DEFAULT '1'::"text",
    "vehicle_type" "public"."vehicle_type" DEFAULT 'car'::"public"."vehicle_type" NOT NULL,
    "car_id" "uuid" NOT NULL,
    "vehicle_type_code" smallint DEFAULT 1,
    "booking_type" "public"."booking_type" DEFAULT 'hourly'::"public"."booking_type",
    "car_plate" "text",
    CONSTRAINT "reservations_vehicle_type_code_check" CHECK (("vehicle_type_code" = ANY (ARRAY[0, 1, 2])))
);


ALTER TABLE "public"."reservations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reservations_history" (
    "id" bigint NOT NULL,
    "reservation_id" "uuid" NOT NULL,
    "timestamp" timestamp with time zone DEFAULT "now"(),
    "description" "text" NOT NULL,
    "details" "jsonb"
);


ALTER TABLE "public"."reservations_history" OWNER TO "postgres";


COMMENT ON TABLE "public"."reservations_history" IS 'Read Model: A human-readable history log for reservations.';



CREATE SEQUENCE IF NOT EXISTS "public"."reservations_history_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."reservations_history_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."reservations_history_id_seq" OWNED BY "public"."reservations_history"."id";



CREATE TABLE IF NOT EXISTS "public"."slots" (
    "id" "text" NOT NULL,
    "zone_id" "text" NOT NULL,
    "parking_site_id" "text" NOT NULL,
    "floor_id" "text" NOT NULL,
    "name" character varying NOT NULL,
    "slot_number" integer,
    "status" "public"."slot_status" DEFAULT 'available'::"public"."slot_status" NOT NULL,
    "details" "text",
    "version" integer DEFAULT 1 NOT NULL,
    "vehicle_type" "public"."vehicle_type" DEFAULT 'car'::"public"."vehicle_type" NOT NULL,
    "vehicle_type_code" smallint DEFAULT 1,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "slots_vehicle_type_code_check" CHECK (("vehicle_type_code" = ANY (ARRAY[0, 1, 2])))
);


ALTER TABLE "public"."slots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."zones" (
    "id" "text" NOT NULL,
    "floor_id" "text" NOT NULL,
    "name" "text" NOT NULL
);


ALTER TABLE "public"."zones" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."site_structure_view" AS
 SELECT "s"."id" AS "site_id",
    "s"."name" AS "site_name",
    "b"."id" AS "building_id",
    "b"."name" AS "building_name",
    "f"."id" AS "floor_id",
    "f"."name" AS "floor_name",
    "f"."level_order",
    "z"."id" AS "zone_id",
    "z"."name" AS "zone_name",
    "array_agg"(DISTINCT "sl"."vehicle_type_code") AS "supported_vehicle_types"
   FROM (((("public"."parking_sites" "s"
     JOIN "public"."buildings" "b" ON (("s"."id" = "b"."parking_site_id")))
     JOIN "public"."floors" "f" ON (("b"."id" = "f"."building_id")))
     JOIN "public"."zones" "z" ON (("f"."id" = "z"."floor_id")))
     JOIN "public"."slots" "sl" ON (("z"."id" = "sl"."zone_id")))
  GROUP BY "s"."id", "s"."name", "b"."id", "b"."name", "f"."id", "f"."name", "f"."level_order", "z"."id", "z"."name"
  ORDER BY "s"."id", "f"."level_order", "z"."name";


ALTER VIEW "public"."site_structure_view" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."slot_recurring_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slot_id" "text" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone NOT NULL,
    "recurrence_type" "text" NOT NULL,
    "weekday" integer,
    "status" "public"."slot_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "slot_recurring_rules_check" CHECK (("end_date" >= "start_date")),
    CONSTRAINT "slot_recurring_rules_check1" CHECK (("end_time" > "start_time")),
    CONSTRAINT "slot_recurring_rules_recurrence_type_check" CHECK (("recurrence_type" = ANY (ARRAY['daily'::"text", 'weekly'::"text"]))),
    CONSTRAINT "slot_recurring_rules_weekday_check" CHECK ((("weekday" >= 0) AND ("weekday" <= 6)))
);


ALTER TABLE "public"."slot_recurring_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."slot_status_overrides" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slot_id" "text" NOT NULL,
    "override_date" "date" NOT NULL,
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone NOT NULL,
    "status" "public"."slot_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."slot_status_overrides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."snapshots" (
    "aggregate_id" "uuid" NOT NULL,
    "snapshot_data" "jsonb" NOT NULL,
    "version" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_bookmarks" (
    "user_id" "uuid" NOT NULL,
    "building_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_bookmarks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "name" character varying,
    "email" character varying NOT NULL,
    "status" "public"."user_status" DEFAULT 'active'::"public"."user_status",
    "version" integer DEFAULT 1 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."users" OWNER TO "postgres";


ALTER TABLE ONLY "public"."activity_logs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."activity_logs_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."event_store" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."event_store_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."recent_activities" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."recent_activities_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."reservations_history" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."reservations_history_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."access_tickets"
    ADD CONSTRAINT "access_tickets_invite_code_key" UNIQUE ("invite_code");



ALTER TABLE ONLY "public"."access_tickets"
    ADD CONSTRAINT "access_tickets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."activity_logs"
    ADD CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."buildings"
    ADD CONSTRAINT "buildings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cars"
    ADD CONSTRAINT "cars_license_plate_province_uniq" UNIQUE ("license_plate", "province");



ALTER TABLE ONLY "public"."cars"
    ADD CONSTRAINT "cars_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."event_store"
    ADD CONSTRAINT "event_store_aggregate_version_unique" UNIQUE ("aggregate_id", "version");



ALTER TABLE ONLY "public"."event_store"
    ADD CONSTRAINT "event_store_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."floors"
    ADD CONSTRAINT "floors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."latest_versions"
    ADD CONSTRAINT "latest_versions_pkey" PRIMARY KEY ("aggregate_id");



ALTER TABLE ONLY "public"."reservations"
    ADD CONSTRAINT "no_overlap_booking" EXCLUDE USING "gist" ("slot_id" WITH =, "tstzrange"("start_time", "end_time") WITH &&) WHERE (("status" <> 'cancelled'::"public"."reservation_status"));



ALTER TABLE ONLY "public"."slot_status_overrides"
    ADD CONSTRAINT "no_overlapping_overrides" EXCLUDE USING "gist" ("slot_id" WITH =, "override_date" WITH =, "int4range"((((EXTRACT(hour FROM "start_time"))::integer * 60) + (EXTRACT(minute FROM "start_time"))::integer), (((EXTRACT(hour FROM "end_time"))::integer * 60) + (EXTRACT(minute FROM "end_time"))::integer), '[)'::"text") WITH &&);



ALTER TABLE ONLY "public"."slot_recurring_rules"
    ADD CONSTRAINT "no_overlapping_rules" EXCLUDE USING "gist" ("slot_id" WITH =, "daterange"("start_date", "end_date", '[]'::"text") WITH &&, "int4range"((((EXTRACT(hour FROM "start_time"))::integer * 60) + (EXTRACT(minute FROM "start_time"))::integer), (((EXTRACT(hour FROM "end_time"))::integer * 60) + (EXTRACT(minute FROM "end_time"))::integer), '[)'::"text") WITH &&);



ALTER TABLE ONLY "public"."parking_sites"
    ADD CONSTRAINT "parking_sites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recent_activities"
    ADD CONSTRAINT "recent_activities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recent_activities"
    ADD CONSTRAINT "recent_activities_reservation_id_key" UNIQUE ("reservation_id");



ALTER TABLE ONLY "public"."reservations_history"
    ADD CONSTRAINT "reservations_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reservations"
    ADD CONSTRAINT "reservations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."slot_recurring_rules"
    ADD CONSTRAINT "slot_recurring_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."slot_status_overrides"
    ADD CONSTRAINT "slot_status_overrides_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."slots"
    ADD CONSTRAINT "slots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."snapshots"
    ADD CONSTRAINT "snapshots_pkey" PRIMARY KEY ("aggregate_id");



ALTER TABLE ONLY "public"."user_bookmarks"
    ADD CONSTRAINT "user_bookmarks_pkey" PRIMARY KEY ("user_id", "building_id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."zones"
    ADD CONSTRAINT "zones_pkey" PRIMARY KEY ("id");



CREATE INDEX "activity_logs_category_time_idx" ON "public"."activity_logs" USING "btree" ("category", "time" DESC);



CREATE INDEX "activity_logs_entity_type_entity_id_idx" ON "public"."activity_logs" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "activity_logs_time_idx" ON "public"."activity_logs" USING "btree" ("time" DESC);



CREATE INDEX "activity_logs_user_id_idx" ON "public"."activity_logs" USING "btree" ("user_id");



CREATE INDEX "idx_activity_site_time" ON "public"."activity_logs" USING "btree" ("site_id", "time" DESC);



CREATE INDEX "idx_buildings_lat_lng" ON "public"."buildings" USING "btree" ("lat", "lng");



CREATE INDEX "idx_cars_user_id" ON "public"."cars" USING "btree" ("profile_id");



CREATE INDEX "idx_event_store_aggregate_id" ON "public"."event_store" USING "btree" ("aggregate_id");



CREATE INDEX "idx_floors_layout_data" ON "public"."floors" USING "gin" ("layout_data");



CREATE INDEX "idx_reservations_floor" ON "public"."reservations" USING "btree" ("floor_id");



CREATE INDEX "idx_reservations_history_reservation_id" ON "public"."reservations_history" USING "btree" ("reservation_id");



CREATE INDEX "idx_reservations_pending_status_time" ON "public"."reservations" USING "btree" ("start_time") WHERE ("status" = 'pending'::"public"."reservation_status");



CREATE INDEX "idx_reservations_site" ON "public"."reservations" USING "btree" ("parking_site_id");



CREATE INDEX "idx_reservations_slot" ON "public"."reservations" USING "btree" ("slot_id");



CREATE INDEX "idx_reservations_time_overlap" ON "public"."reservations" USING "btree" ("parking_site_id", "start_time", "end_time") WHERE ("status" <> ALL (ARRAY['cancelled'::"public"."reservation_status", 'checked_out'::"public"."reservation_status"]));



CREATE INDEX "idx_user_bookmarks_user_id" ON "public"."user_bookmarks" USING "btree" ("user_id");



CREATE OR REPLACE TRIGGER "set_updated_at_slot_recurring_rules" BEFORE UPDATE ON "public"."slot_recurring_rules" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_updated_at_slot_status_overrides" BEFORE UPDATE ON "public"."slot_status_overrides" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_sync_vehicle_cars" BEFORE INSERT OR UPDATE ON "public"."cars" FOR EACH ROW EXECUTE FUNCTION "public"."sync_vehicle_type_logic"();



CREATE OR REPLACE TRIGGER "trg_sync_vehicle_reservations" BEFORE INSERT OR UPDATE ON "public"."reservations" FOR EACH ROW EXECUTE FUNCTION "public"."sync_vehicle_type_logic"();



CREATE OR REPLACE TRIGGER "trg_sync_vehicle_slots" BEFORE INSERT OR UPDATE ON "public"."slots" FOR EACH ROW EXECUTE FUNCTION "public"."sync_vehicle_type_logic"();



CREATE OR REPLACE TRIGGER "trigger_check_double_booking" BEFORE INSERT OR UPDATE ON "public"."reservations" FOR EACH ROW EXECUTE FUNCTION "public"."check_double_booking"();



ALTER TABLE ONLY "public"."buildings"
    ADD CONSTRAINT "buildings_parking_site_id_fkey" FOREIGN KEY ("parking_site_id") REFERENCES "public"."parking_sites"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cars"
    ADD CONSTRAINT "cars_user_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."activity_logs"
    ADD CONSTRAINT "fk_activity_site" FOREIGN KEY ("site_id") REFERENCES "public"."parking_sites"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."floors"
    ADD CONSTRAINT "floors_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recent_activities"
    ADD CONSTRAINT "recent_activities_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reservations"
    ADD CONSTRAINT "reservations_floor_id_fkey" FOREIGN KEY ("floor_id") REFERENCES "public"."floors"("id");



ALTER TABLE ONLY "public"."reservations"
    ADD CONSTRAINT "reservations_parking_site_id_fkey" FOREIGN KEY ("parking_site_id") REFERENCES "public"."parking_sites"("id");



ALTER TABLE ONLY "public"."reservations"
    ADD CONSTRAINT "reservations_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reservations"
    ADD CONSTRAINT "reservations_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "public"."slots"("id");



ALTER TABLE ONLY "public"."slot_recurring_rules"
    ADD CONSTRAINT "slot_recurring_rules_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "public"."slots"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."slot_status_overrides"
    ADD CONSTRAINT "slot_status_overrides_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "public"."slots"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."slots"
    ADD CONSTRAINT "slots_floor_id_fkey" FOREIGN KEY ("floor_id") REFERENCES "public"."floors"("id");



ALTER TABLE ONLY "public"."slots"
    ADD CONSTRAINT "slots_parking_site_id_fkey" FOREIGN KEY ("parking_site_id") REFERENCES "public"."parking_sites"("id");



ALTER TABLE ONLY "public"."slots"
    ADD CONSTRAINT "slots_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_bookmarks"
    ADD CONSTRAINT "user_bookmarks_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_bookmarks"
    ADD CONSTRAINT "user_bookmarks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."zones"
    ADD CONSTRAINT "zones_floor_id_fkey" FOREIGN KEY ("floor_id") REFERENCES "public"."floors"("id") ON DELETE CASCADE;



CREATE POLICY "Public profiles access" ON "public"."profiles" USING (true);



CREATE POLICY "Users can delete their own bookmarks" ON "public"."user_bookmarks" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own bookmarks" ON "public"."user_bookmarks" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own bookmarks" ON "public"."user_bookmarks" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_bookmarks" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."cars";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."reservations";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."slots";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."user_bookmarks";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey16_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey16_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey16_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey16_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey16_out"("public"."gbtreekey16") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey16_out"("public"."gbtreekey16") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey16_out"("public"."gbtreekey16") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey16_out"("public"."gbtreekey16") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey2_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey2_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey2_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey2_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey2_out"("public"."gbtreekey2") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey2_out"("public"."gbtreekey2") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey2_out"("public"."gbtreekey2") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey2_out"("public"."gbtreekey2") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey32_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey32_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey32_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey32_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey32_out"("public"."gbtreekey32") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey32_out"("public"."gbtreekey32") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey32_out"("public"."gbtreekey32") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey32_out"("public"."gbtreekey32") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey4_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey4_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey4_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey4_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey4_out"("public"."gbtreekey4") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey4_out"("public"."gbtreekey4") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey4_out"("public"."gbtreekey4") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey4_out"("public"."gbtreekey4") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey8_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey8_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey8_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey8_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey8_out"("public"."gbtreekey8") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey8_out"("public"."gbtreekey8") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey8_out"("public"."gbtreekey8") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey8_out"("public"."gbtreekey8") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey_var_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey_var_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey_var_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey_var_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbtreekey_var_out"("public"."gbtreekey_var") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbtreekey_var_out"("public"."gbtreekey_var") TO "anon";
GRANT ALL ON FUNCTION "public"."gbtreekey_var_out"("public"."gbtreekey_var") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbtreekey_var_out"("public"."gbtreekey_var") TO "service_role";














































































































































































GRANT ALL ON FUNCTION "public"."admin_update_slot_status_with_log"("p_slot_ids" "text"[], "p_status" "public"."slot_status", "p_user_id" "uuid", "p_user_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_update_slot_status_with_log"("p_slot_ids" "text"[], "p_status" "public"."slot_status", "p_user_id" "uuid", "p_user_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_update_slot_status_with_log"("p_slot_ids" "text"[], "p_status" "public"."slot_status", "p_user_id" "uuid", "p_user_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_upsert_slot_overrides_with_log"("p_slot_id" "text", "p_override_date" "date", "p_ranges" "jsonb", "p_user_id" "uuid", "p_user_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_upsert_slot_overrides_with_log"("p_slot_id" "text", "p_override_date" "date", "p_ranges" "jsonb", "p_user_id" "uuid", "p_user_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_upsert_slot_overrides_with_log"("p_slot_id" "text", "p_override_date" "date", "p_ranges" "jsonb", "p_user_id" "uuid", "p_user_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."auto_cancel_expired_pending_reservations"() TO "anon";
GRANT ALL ON FUNCTION "public"."auto_cancel_expired_pending_reservations"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_cancel_expired_pending_reservations"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cash_dist"("money", "money") TO "postgres";
GRANT ALL ON FUNCTION "public"."cash_dist"("money", "money") TO "anon";
GRANT ALL ON FUNCTION "public"."cash_dist"("money", "money") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cash_dist"("money", "money") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_double_booking"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_double_booking"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_double_booking"() TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_invite_code"("p_code" "text", "p_visitor_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."claim_invite_code"("p_code" "text", "p_visitor_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_invite_code"("p_code" "text", "p_visitor_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."date_dist"("date", "date") TO "postgres";
GRANT ALL ON FUNCTION "public"."date_dist"("date", "date") TO "anon";
GRANT ALL ON FUNCTION "public"."date_dist"("date", "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."date_dist"("date", "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."find_best_available_slot"("p_zone_id" "text", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."find_best_available_slot"("p_zone_id" "text", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_best_available_slot"("p_zone_id" "text", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."float4_dist"(real, real) TO "postgres";
GRANT ALL ON FUNCTION "public"."float4_dist"(real, real) TO "anon";
GRANT ALL ON FUNCTION "public"."float4_dist"(real, real) TO "authenticated";
GRANT ALL ON FUNCTION "public"."float4_dist"(real, real) TO "service_role";



GRANT ALL ON FUNCTION "public"."float8_dist"(double precision, double precision) TO "postgres";
GRANT ALL ON FUNCTION "public"."float8_dist"(double precision, double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."float8_dist"(double precision, double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."float8_dist"(double precision, double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bit_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bit_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bit_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bit_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bit_consistent"("internal", bit, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bit_consistent"("internal", bit, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bit_consistent"("internal", bit, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bit_consistent"("internal", bit, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bit_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bit_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bit_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bit_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bit_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bit_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bit_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bit_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bit_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bit_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bit_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bit_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bit_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bit_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bit_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bit_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bool_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bool_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bool_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bool_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bool_consistent"("internal", boolean, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bool_consistent"("internal", boolean, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bool_consistent"("internal", boolean, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bool_consistent"("internal", boolean, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bool_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bool_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bool_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bool_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bool_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bool_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bool_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bool_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bool_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bool_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bool_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bool_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bool_same"("public"."gbtreekey2", "public"."gbtreekey2", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bool_same"("public"."gbtreekey2", "public"."gbtreekey2", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bool_same"("public"."gbtreekey2", "public"."gbtreekey2", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bool_same"("public"."gbtreekey2", "public"."gbtreekey2", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bool_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bool_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bool_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bool_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bpchar_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bpchar_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bpchar_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bpchar_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bpchar_consistent"("internal", character, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bpchar_consistent"("internal", character, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bpchar_consistent"("internal", character, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bpchar_consistent"("internal", character, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bytea_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bytea_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bytea_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bytea_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bytea_consistent"("internal", "bytea", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bytea_consistent"("internal", "bytea", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bytea_consistent"("internal", "bytea", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bytea_consistent"("internal", "bytea", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bytea_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bytea_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bytea_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bytea_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bytea_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bytea_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bytea_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bytea_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bytea_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bytea_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bytea_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bytea_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_bytea_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_bytea_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_bytea_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_bytea_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_cash_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_cash_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_cash_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_cash_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_cash_consistent"("internal", "money", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_cash_consistent"("internal", "money", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_cash_consistent"("internal", "money", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_cash_consistent"("internal", "money", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_cash_distance"("internal", "money", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_cash_distance"("internal", "money", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_cash_distance"("internal", "money", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_cash_distance"("internal", "money", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_cash_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_cash_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_cash_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_cash_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_cash_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_cash_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_cash_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_cash_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_cash_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_cash_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_cash_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_cash_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_cash_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_cash_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_cash_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_cash_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_cash_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_cash_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_cash_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_cash_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_date_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_date_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_date_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_date_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_date_consistent"("internal", "date", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_date_consistent"("internal", "date", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_date_consistent"("internal", "date", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_date_consistent"("internal", "date", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_date_distance"("internal", "date", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_date_distance"("internal", "date", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_date_distance"("internal", "date", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_date_distance"("internal", "date", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_date_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_date_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_date_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_date_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_date_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_date_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_date_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_date_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_date_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_date_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_date_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_date_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_date_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_date_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_date_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_date_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_date_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_date_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_date_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_date_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_decompress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_decompress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_decompress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_decompress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_enum_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_enum_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_enum_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_enum_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_enum_consistent"("internal", "anyenum", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_enum_consistent"("internal", "anyenum", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_enum_consistent"("internal", "anyenum", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_enum_consistent"("internal", "anyenum", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_enum_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_enum_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_enum_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_enum_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_enum_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_enum_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_enum_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_enum_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_enum_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_enum_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_enum_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_enum_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_enum_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_enum_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_enum_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_enum_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_enum_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_enum_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_enum_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_enum_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float4_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float4_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float4_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float4_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float4_consistent"("internal", real, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float4_consistent"("internal", real, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float4_consistent"("internal", real, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float4_consistent"("internal", real, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float4_distance"("internal", real, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float4_distance"("internal", real, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float4_distance"("internal", real, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float4_distance"("internal", real, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float4_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float4_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float4_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float4_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float4_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float4_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float4_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float4_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float4_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float4_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float4_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float4_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float4_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float4_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float4_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float4_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float4_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float4_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float4_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float4_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float8_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float8_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float8_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float8_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float8_consistent"("internal", double precision, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float8_consistent"("internal", double precision, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float8_consistent"("internal", double precision, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float8_consistent"("internal", double precision, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float8_distance"("internal", double precision, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float8_distance"("internal", double precision, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float8_distance"("internal", double precision, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float8_distance"("internal", double precision, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float8_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float8_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float8_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float8_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float8_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float8_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float8_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float8_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float8_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float8_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float8_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float8_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_float8_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_float8_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_float8_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_float8_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_inet_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_inet_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_inet_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_inet_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_inet_consistent"("internal", "inet", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_inet_consistent"("internal", "inet", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_inet_consistent"("internal", "inet", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_inet_consistent"("internal", "inet", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_inet_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_inet_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_inet_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_inet_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_inet_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_inet_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_inet_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_inet_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_inet_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_inet_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_inet_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_inet_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_inet_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_inet_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_inet_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_inet_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int2_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int2_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int2_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int2_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int2_consistent"("internal", smallint, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int2_consistent"("internal", smallint, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int2_consistent"("internal", smallint, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int2_consistent"("internal", smallint, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int2_distance"("internal", smallint, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int2_distance"("internal", smallint, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int2_distance"("internal", smallint, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int2_distance"("internal", smallint, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int2_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int2_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int2_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int2_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int2_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int2_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int2_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int2_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int2_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int2_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int2_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int2_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int2_same"("public"."gbtreekey4", "public"."gbtreekey4", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int2_same"("public"."gbtreekey4", "public"."gbtreekey4", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int2_same"("public"."gbtreekey4", "public"."gbtreekey4", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int2_same"("public"."gbtreekey4", "public"."gbtreekey4", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int2_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int2_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int2_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int2_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int4_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int4_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int4_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int4_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int4_consistent"("internal", integer, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int4_consistent"("internal", integer, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int4_consistent"("internal", integer, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int4_consistent"("internal", integer, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int4_distance"("internal", integer, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int4_distance"("internal", integer, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int4_distance"("internal", integer, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int4_distance"("internal", integer, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int4_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int4_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int4_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int4_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int4_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int4_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int4_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int4_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int4_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int4_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int4_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int4_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int4_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int4_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int4_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int4_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int4_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int4_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int4_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int4_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int8_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int8_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int8_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int8_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int8_consistent"("internal", bigint, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int8_consistent"("internal", bigint, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int8_consistent"("internal", bigint, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int8_consistent"("internal", bigint, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int8_distance"("internal", bigint, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int8_distance"("internal", bigint, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int8_distance"("internal", bigint, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int8_distance"("internal", bigint, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int8_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int8_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int8_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int8_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int8_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int8_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int8_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int8_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int8_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int8_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int8_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int8_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_int8_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_int8_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_int8_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_int8_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_consistent"("internal", interval, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_consistent"("internal", interval, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_consistent"("internal", interval, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_consistent"("internal", interval, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_decompress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_decompress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_decompress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_decompress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_distance"("internal", interval, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_distance"("internal", interval, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_distance"("internal", interval, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_distance"("internal", interval, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_same"("public"."gbtreekey32", "public"."gbtreekey32", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_same"("public"."gbtreekey32", "public"."gbtreekey32", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_same"("public"."gbtreekey32", "public"."gbtreekey32", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_same"("public"."gbtreekey32", "public"."gbtreekey32", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_intv_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_intv_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_intv_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_intv_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad8_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad8_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad8_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad8_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad8_consistent"("internal", "macaddr8", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad8_consistent"("internal", "macaddr8", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad8_consistent"("internal", "macaddr8", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad8_consistent"("internal", "macaddr8", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad8_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad8_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad8_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad8_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad8_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad8_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad8_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad8_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad8_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad8_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad8_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad8_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad8_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad8_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad8_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad8_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad8_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad_consistent"("internal", "macaddr", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad_consistent"("internal", "macaddr", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad_consistent"("internal", "macaddr", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad_consistent"("internal", "macaddr", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_macad_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_macad_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_macad_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_macad_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_numeric_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_numeric_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_numeric_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_numeric_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_numeric_consistent"("internal", numeric, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_numeric_consistent"("internal", numeric, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_numeric_consistent"("internal", numeric, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_numeric_consistent"("internal", numeric, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_numeric_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_numeric_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_numeric_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_numeric_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_numeric_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_numeric_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_numeric_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_numeric_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_numeric_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_numeric_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_numeric_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_numeric_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_numeric_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_numeric_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_numeric_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_numeric_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_oid_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_oid_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_oid_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_oid_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_oid_consistent"("internal", "oid", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_oid_consistent"("internal", "oid", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_oid_consistent"("internal", "oid", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_oid_consistent"("internal", "oid", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_oid_distance"("internal", "oid", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_oid_distance"("internal", "oid", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_oid_distance"("internal", "oid", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_oid_distance"("internal", "oid", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_oid_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_oid_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_oid_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_oid_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_oid_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_oid_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_oid_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_oid_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_oid_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_oid_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_oid_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_oid_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_oid_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_oid_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_oid_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_oid_same"("public"."gbtreekey8", "public"."gbtreekey8", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_oid_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_oid_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_oid_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_oid_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_text_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_text_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_text_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_text_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_text_consistent"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_text_consistent"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_text_consistent"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_text_consistent"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_text_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_text_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_text_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_text_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_text_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_text_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_text_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_text_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_text_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_text_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_text_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_text_same"("public"."gbtreekey_var", "public"."gbtreekey_var", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_text_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_text_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_text_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_text_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_time_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_time_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_time_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_time_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_time_consistent"("internal", time without time zone, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_time_consistent"("internal", time without time zone, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_time_consistent"("internal", time without time zone, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_time_consistent"("internal", time without time zone, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_time_distance"("internal", time without time zone, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_time_distance"("internal", time without time zone, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_time_distance"("internal", time without time zone, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_time_distance"("internal", time without time zone, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_time_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_time_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_time_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_time_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_time_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_time_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_time_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_time_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_time_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_time_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_time_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_time_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_time_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_time_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_time_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_time_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_time_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_time_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_time_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_time_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_timetz_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_timetz_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_timetz_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_timetz_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_timetz_consistent"("internal", time with time zone, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_timetz_consistent"("internal", time with time zone, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_timetz_consistent"("internal", time with time zone, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_timetz_consistent"("internal", time with time zone, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_ts_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_ts_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_ts_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_ts_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_ts_consistent"("internal", timestamp without time zone, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_ts_consistent"("internal", timestamp without time zone, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_ts_consistent"("internal", timestamp without time zone, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_ts_consistent"("internal", timestamp without time zone, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_ts_distance"("internal", timestamp without time zone, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_ts_distance"("internal", timestamp without time zone, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_ts_distance"("internal", timestamp without time zone, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_ts_distance"("internal", timestamp without time zone, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_ts_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_ts_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_ts_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_ts_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_ts_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_ts_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_ts_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_ts_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_ts_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_ts_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_ts_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_ts_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_ts_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_ts_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_ts_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_ts_same"("public"."gbtreekey16", "public"."gbtreekey16", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_ts_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_ts_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_ts_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_ts_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_tstz_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_tstz_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_tstz_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_tstz_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_tstz_consistent"("internal", timestamp with time zone, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_tstz_consistent"("internal", timestamp with time zone, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_tstz_consistent"("internal", timestamp with time zone, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_tstz_consistent"("internal", timestamp with time zone, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_tstz_distance"("internal", timestamp with time zone, smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_tstz_distance"("internal", timestamp with time zone, smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_tstz_distance"("internal", timestamp with time zone, smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_tstz_distance"("internal", timestamp with time zone, smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_uuid_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_uuid_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_uuid_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_uuid_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_uuid_consistent"("internal", "uuid", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_uuid_consistent"("internal", "uuid", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_uuid_consistent"("internal", "uuid", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_uuid_consistent"("internal", "uuid", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_uuid_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_uuid_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_uuid_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_uuid_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_uuid_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_uuid_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_uuid_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_uuid_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_uuid_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_uuid_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_uuid_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_uuid_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_uuid_same"("public"."gbtreekey32", "public"."gbtreekey32", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_uuid_same"("public"."gbtreekey32", "public"."gbtreekey32", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_uuid_same"("public"."gbtreekey32", "public"."gbtreekey32", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_uuid_same"("public"."gbtreekey32", "public"."gbtreekey32", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_uuid_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_uuid_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_uuid_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_uuid_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_var_decompress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_var_decompress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_var_decompress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_var_decompress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gbt_var_fetch"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gbt_var_fetch"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gbt_var_fetch"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gbt_var_fetch"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_building_availability"("p_building_id" "text", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone, "p_vehicle_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_building_availability"("p_building_id" "text", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone, "p_vehicle_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_building_availability"("p_building_id" "text", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone, "p_vehicle_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_building_slots_availability"("p_building_id" "text", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone, "p_interval_minutes" integer, "p_vehicle_type" "text", "p_duration_minutes" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_building_slots_availability"("p_building_id" "text", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone, "p_interval_minutes" integer, "p_vehicle_type" "text", "p_duration_minutes" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_building_slots_availability"("p_building_id" "text", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone, "p_interval_minutes" integer, "p_vehicle_type" "text", "p_duration_minutes" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_site_availability"("p_site_id" "text", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone, "p_vehicle_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_site_availability"("p_site_id" "text", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone, "p_vehicle_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_site_availability"("p_site_id" "text", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone, "p_vehicle_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_site_buildings"("p_site_id" "text", "p_lat" double precision, "p_lng" double precision, "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_site_buildings"("p_site_id" "text", "p_lat" double precision, "p_lng" double precision, "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_site_buildings"("p_site_id" "text", "p_lat" double precision, "p_lng" double precision, "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."insert_activity_log"("p_log_type" "public"."activity_log_type", "p_action" "text", "p_user_id" "uuid", "p_user_name" "text", "p_category" "public"."activity_category", "p_status" "public"."activity_status", "p_entity_type" "text", "p_entity_id" "text", "p_detail" "text", "p_changes" "jsonb", "p_meta" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."insert_activity_log"("p_log_type" "public"."activity_log_type", "p_action" "text", "p_user_id" "uuid", "p_user_name" "text", "p_category" "public"."activity_category", "p_status" "public"."activity_status", "p_entity_type" "text", "p_entity_id" "text", "p_detail" "text", "p_changes" "jsonb", "p_meta" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."insert_activity_log"("p_log_type" "public"."activity_log_type", "p_action" "text", "p_user_id" "uuid", "p_user_name" "text", "p_category" "public"."activity_category", "p_status" "public"."activity_status", "p_entity_type" "text", "p_entity_id" "text", "p_detail" "text", "p_changes" "jsonb", "p_meta" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."insert_activity_log"("p_log_type" "public"."activity_log_type", "p_action" "text", "p_user_id" "uuid", "p_user_name" "text", "p_category" "public"."activity_category", "p_status" "public"."activity_status", "p_entity_type" "text", "p_entity_id" "uuid", "p_detail" "text", "p_changes" "jsonb", "p_meta" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."insert_activity_log"("p_log_type" "public"."activity_log_type", "p_action" "text", "p_user_id" "uuid", "p_user_name" "text", "p_category" "public"."activity_category", "p_status" "public"."activity_status", "p_entity_type" "text", "p_entity_id" "uuid", "p_detail" "text", "p_changes" "jsonb", "p_meta" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."insert_activity_log"("p_log_type" "public"."activity_log_type", "p_action" "text", "p_user_id" "uuid", "p_user_name" "text", "p_category" "public"."activity_category", "p_status" "public"."activity_status", "p_entity_type" "text", "p_entity_id" "uuid", "p_detail" "text", "p_changes" "jsonb", "p_meta" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."insert_activity_log"("p_log_type" "public"."activity_log_type", "p_action" "text", "p_user_id" "uuid", "p_user_name" "text", "p_category" "public"."activity_category", "p_status" "public"."activity_status", "p_entity_type" "text", "p_entity_id" "text", "p_detail" "text", "p_changes" "jsonb", "p_old_data" "jsonb", "p_new_data" "jsonb", "p_meta" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."insert_activity_log"("p_log_type" "public"."activity_log_type", "p_action" "text", "p_user_id" "uuid", "p_user_name" "text", "p_category" "public"."activity_category", "p_status" "public"."activity_status", "p_entity_type" "text", "p_entity_id" "text", "p_detail" "text", "p_changes" "jsonb", "p_old_data" "jsonb", "p_new_data" "jsonb", "p_meta" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."insert_activity_log"("p_log_type" "public"."activity_log_type", "p_action" "text", "p_user_id" "uuid", "p_user_name" "text", "p_category" "public"."activity_category", "p_status" "public"."activity_status", "p_entity_type" "text", "p_entity_id" "text", "p_detail" "text", "p_changes" "jsonb", "p_old_data" "jsonb", "p_new_data" "jsonb", "p_meta" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."insert_activity_log"("p_site_id" "text", "p_log_type" "public"."activity_log_type", "p_action" "text", "p_user_id" "uuid", "p_user_name" "text", "p_category" "public"."activity_category", "p_status" "public"."activity_status", "p_entity_type" "text", "p_entity_id" "text", "p_detail" "text", "p_changes" "jsonb", "p_old_data" "jsonb", "p_new_data" "jsonb", "p_meta" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."insert_activity_log"("p_site_id" "text", "p_log_type" "public"."activity_log_type", "p_action" "text", "p_user_id" "uuid", "p_user_name" "text", "p_category" "public"."activity_category", "p_status" "public"."activity_status", "p_entity_type" "text", "p_entity_id" "text", "p_detail" "text", "p_changes" "jsonb", "p_old_data" "jsonb", "p_new_data" "jsonb", "p_meta" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."insert_activity_log"("p_site_id" "text", "p_log_type" "public"."activity_log_type", "p_action" "text", "p_user_id" "uuid", "p_user_name" "text", "p_category" "public"."activity_category", "p_status" "public"."activity_status", "p_entity_type" "text", "p_entity_id" "text", "p_detail" "text", "p_changes" "jsonb", "p_old_data" "jsonb", "p_new_data" "jsonb", "p_meta" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."int2_dist"(smallint, smallint) TO "postgres";
GRANT ALL ON FUNCTION "public"."int2_dist"(smallint, smallint) TO "anon";
GRANT ALL ON FUNCTION "public"."int2_dist"(smallint, smallint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."int2_dist"(smallint, smallint) TO "service_role";



GRANT ALL ON FUNCTION "public"."int4_dist"(integer, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."int4_dist"(integer, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."int4_dist"(integer, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."int4_dist"(integer, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."int8_dist"(bigint, bigint) TO "postgres";
GRANT ALL ON FUNCTION "public"."int8_dist"(bigint, bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."int8_dist"(bigint, bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."int8_dist"(bigint, bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."interval_dist"(interval, interval) TO "postgres";
GRANT ALL ON FUNCTION "public"."interval_dist"(interval, interval) TO "anon";
GRANT ALL ON FUNCTION "public"."interval_dist"(interval, interval) TO "authenticated";
GRANT ALL ON FUNCTION "public"."interval_dist"(interval, interval) TO "service_role";



GRANT ALL ON FUNCTION "public"."oid_dist"("oid", "oid") TO "postgres";
GRANT ALL ON FUNCTION "public"."oid_dist"("oid", "oid") TO "anon";
GRANT ALL ON FUNCTION "public"."oid_dist"("oid", "oid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."oid_dist"("oid", "oid") TO "service_role";



GRANT ALL ON FUNCTION "public"."save_events_and_update_version"("p_aggregate_id" "uuid", "p_expected_version" integer, "p_new_version" integer, "p_events" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."save_events_and_update_version"("p_aggregate_id" "uuid", "p_expected_version" integer, "p_new_version" integer, "p_events" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_events_and_update_version"("p_aggregate_id" "uuid", "p_expected_version" integer, "p_new_version" integer, "p_events" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."save_events_and_update_version"("p_aggregate_id" "uuid", "p_expected_version" integer, "p_new_version" integer, "p_events" "jsonb", "p_latest_event_data" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."save_events_and_update_version"("p_aggregate_id" "uuid", "p_expected_version" integer, "p_new_version" integer, "p_events" "jsonb", "p_latest_event_data" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_events_and_update_version"("p_aggregate_id" "uuid", "p_expected_version" integer, "p_new_version" integer, "p_events" "jsonb", "p_latest_event_data" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_vehicle_type_logic"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_vehicle_type_logic"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_vehicle_type_logic"() TO "service_role";



GRANT ALL ON FUNCTION "public"."time_dist"(time without time zone, time without time zone) TO "postgres";
GRANT ALL ON FUNCTION "public"."time_dist"(time without time zone, time without time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."time_dist"(time without time zone, time without time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."time_dist"(time without time zone, time without time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."ts_dist"(timestamp without time zone, timestamp without time zone) TO "postgres";
GRANT ALL ON FUNCTION "public"."ts_dist"(timestamp without time zone, timestamp without time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."ts_dist"(timestamp without time zone, timestamp without time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."ts_dist"(timestamp without time zone, timestamp without time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."tstz_dist"(timestamp with time zone, timestamp with time zone) TO "postgres";
GRANT ALL ON FUNCTION "public"."tstz_dist"(timestamp with time zone, timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."tstz_dist"(timestamp with time zone, timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."tstz_dist"(timestamp with time zone, timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."update_config_with_log"("p_entity_type" "text", "p_entity_id" "text", "p_updates" "jsonb", "p_user_id" "uuid", "p_user_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."update_config_with_log"("p_entity_type" "text", "p_entity_id" "text", "p_updates" "jsonb", "p_user_id" "uuid", "p_user_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_config_with_log"("p_entity_type" "text", "p_entity_id" "text", "p_updates" "jsonb", "p_user_id" "uuid", "p_user_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_multiple_entities_with_log"("p_payload" "jsonb", "p_user_id" "uuid", "p_user_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."update_multiple_entities_with_log"("p_payload" "jsonb", "p_user_id" "uuid", "p_user_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_multiple_entities_with_log"("p_payload" "jsonb", "p_user_id" "uuid", "p_user_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";
























GRANT ALL ON TABLE "public"."access_tickets" TO "anon";
GRANT ALL ON TABLE "public"."access_tickets" TO "authenticated";
GRANT ALL ON TABLE "public"."access_tickets" TO "service_role";



GRANT ALL ON TABLE "public"."activity_logs" TO "anon";
GRANT ALL ON TABLE "public"."activity_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."activity_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."activity_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."activity_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."buildings" TO "anon";
GRANT ALL ON TABLE "public"."buildings" TO "authenticated";
GRANT ALL ON TABLE "public"."buildings" TO "service_role";



GRANT ALL ON TABLE "public"."cars" TO "anon";
GRANT ALL ON TABLE "public"."cars" TO "authenticated";
GRANT ALL ON TABLE "public"."cars" TO "service_role";



GRANT ALL ON TABLE "public"."event_store" TO "anon";
GRANT ALL ON TABLE "public"."event_store" TO "authenticated";
GRANT ALL ON TABLE "public"."event_store" TO "service_role";



GRANT ALL ON SEQUENCE "public"."event_store_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."event_store_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."event_store_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."floors" TO "anon";
GRANT ALL ON TABLE "public"."floors" TO "authenticated";
GRANT ALL ON TABLE "public"."floors" TO "service_role";



GRANT ALL ON TABLE "public"."latest_versions" TO "anon";
GRANT ALL ON TABLE "public"."latest_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."latest_versions" TO "service_role";



GRANT ALL ON TABLE "public"."parking_sites" TO "anon";
GRANT ALL ON TABLE "public"."parking_sites" TO "authenticated";
GRANT ALL ON TABLE "public"."parking_sites" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."recent_activities" TO "anon";
GRANT ALL ON TABLE "public"."recent_activities" TO "authenticated";
GRANT ALL ON TABLE "public"."recent_activities" TO "service_role";



GRANT ALL ON SEQUENCE "public"."recent_activities_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."recent_activities_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."recent_activities_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."reservations" TO "anon";
GRANT ALL ON TABLE "public"."reservations" TO "authenticated";
GRANT ALL ON TABLE "public"."reservations" TO "service_role";



GRANT ALL ON TABLE "public"."reservations_history" TO "anon";
GRANT ALL ON TABLE "public"."reservations_history" TO "authenticated";
GRANT ALL ON TABLE "public"."reservations_history" TO "service_role";



GRANT ALL ON SEQUENCE "public"."reservations_history_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."reservations_history_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."reservations_history_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."slots" TO "anon";
GRANT ALL ON TABLE "public"."slots" TO "authenticated";
GRANT ALL ON TABLE "public"."slots" TO "service_role";



GRANT ALL ON TABLE "public"."zones" TO "anon";
GRANT ALL ON TABLE "public"."zones" TO "authenticated";
GRANT ALL ON TABLE "public"."zones" TO "service_role";



GRANT ALL ON TABLE "public"."site_structure_view" TO "anon";
GRANT ALL ON TABLE "public"."site_structure_view" TO "authenticated";
GRANT ALL ON TABLE "public"."site_structure_view" TO "service_role";



GRANT ALL ON TABLE "public"."slot_recurring_rules" TO "anon";
GRANT ALL ON TABLE "public"."slot_recurring_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."slot_recurring_rules" TO "service_role";



GRANT ALL ON TABLE "public"."slot_status_overrides" TO "anon";
GRANT ALL ON TABLE "public"."slot_status_overrides" TO "authenticated";
GRANT ALL ON TABLE "public"."slot_status_overrides" TO "service_role";



GRANT ALL ON TABLE "public"."snapshots" TO "anon";
GRANT ALL ON TABLE "public"."snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."user_bookmarks" TO "anon";
GRANT ALL ON TABLE "public"."user_bookmarks" TO "authenticated";
GRANT ALL ON TABLE "public"."user_bookmarks" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































