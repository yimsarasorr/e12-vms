-- =============================================
-- [Updated] Calculate Availability Functions (Restored from Backup Schema)
-- Uses correct table 'slots' and 'vehicle_type_code'
-- Implements Shared Pool logic (No booking_type filtering)
-- =============================================

-- =============================================
-- 1. find_best_available_slot
-- Finds a specific slot ID to assign directly
-- =============================================
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


-- =============================================
-- 2. get_building_availability
-- Returns availability grouped by Floor and Zone
-- Logic: Total - Occupied (Shared Pool)
-- =============================================
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


-- =============================================
-- 3. get_building_slots_availability
-- Returns availability count for each time interval
-- Logic: Loop intervals -> Count (Total - Occupied), Shared Pool
-- =============================================
CREATE OR REPLACE FUNCTION "public"."get_building_slots_availability"("p_building_id" "text", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone, "p_interval_minutes" integer, "p_vehicle_type" "text", "p_duration_minutes" integer DEFAULT NULL) RETURNS TABLE("slot_time" timestamp with time zone, "total_capacity" bigint, "reserved_count" bigint, "available_count" bigint)
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
