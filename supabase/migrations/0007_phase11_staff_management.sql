-- Phase 11 — Admin Control Tower: staff management, fleet dispatching, returns.
--
-- 1. profiles gains three operational attributes. They are attributes of a
--    `driver` profile, not new roles: the platform still has only admin,
--    merchant, driver, and customer.
--      staff_type  delivery_driver | pickup_driver | hub_operator
--                  NULL = a driver created before this migration, who may
--                  work either leg.
--      is_active   false suspends the account without touching any order or
--                  ledger row that points at it.
--      hub_zone    the hub or area the person works from.
-- 2. An inactive profile stops resolving to a role. is_admin() and
--    current_user_role() are what every policy and every driver RPC consult,
--    so a suspended driver loses the orders policies, the wallet policy, and
--    every hub RPC in one place.
-- 3. order_status gains `returned` (return to origin).
-- 4. Admin-only RPCs: dispatch a batch to a driver, override an order status,
--    deactivate a staff member (releasing their shipments to the dispatch
--    pool), and delete a staff member that has no ledger history.
-- 5. A pickup driver may only claim a pending parcel that is unreserved or
--    reserved for them, so an admin's pickup assignment actually holds.
--
-- Enum note (same as 0004): ALTER TYPE ... ADD VALUE cannot be used in the
-- transaction that adds it. Nothing below evaluates the 'returned' literal
-- while this file runs: constraints compare status::text, and the functions
-- that name it are plpgsql, which resolves the literal when they run.

-- ---------------------------------------------------------------------------
-- Enum, columns
-- ---------------------------------------------------------------------------

ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'returned' AFTER 'delivered';

CREATE TYPE public.staff_type AS ENUM (
  'delivery_driver',
  'pickup_driver',
  'hub_operator'
);

ALTER TABLE public.profiles
  ADD COLUMN staff_type public.staff_type,
  ADD COLUMN is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN hub_zone text;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_staff_type_drivers_only CHECK (
    staff_type IS NULL OR role = 'driver'
  ),
  ADD CONSTRAINT profiles_hub_zone_shape CHECK (
    hub_zone IS NULL
    OR (btrim(hub_zone) <> '' AND char_length(hub_zone) <= 80)
  );

CREATE INDEX profiles_staff_type_idx ON public.profiles (staff_type)
  WHERE staff_type IS NOT NULL;

COMMENT ON COLUMN public.profiles.staff_type IS
  'Operational specialisation of a driver profile. NULL on drivers that predate Phase 11 (either leg). Admin-writable only.';
COMMENT ON COLUMN public.profiles.is_active IS
  'false suspends the account. History (orders, wallet, transactions) is untouched. Admin-writable only.';
COMMENT ON COLUMN public.profiles.hub_zone IS
  'Hub or area the staff member operates from, shown to the admin. Admin-writable only.';

GRANT USAGE ON TYPE public.staff_type TO authenticated;

-- Hub operators are staff records on a driver profile. They get no admin
-- powers. The constraint below keeps the pool states honest: a parcel that is
-- back at the hub, or returned, needs no driver.
ALTER TABLE public.orders
  DROP CONSTRAINT orders_progress_requires_driver;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_progress_requires_driver CHECK (
    status::text IN ('pending', 'cancelled', 'returned', 'at_hub')
    OR driver_id IS NOT NULL
    OR pickup_driver_id IS NOT NULL
  );

-- ---------------------------------------------------------------------------
-- Inactive accounts resolve to no role
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
      AND is_active
  );
$fn$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT role
  FROM public.profiles
  WHERE id = auth.uid()
    AND is_active;
$fn$;

-- ---------------------------------------------------------------------------
-- Privilege guard. Same body as 0001 plus the three new columns: nobody but an
-- admin can reactivate themselves, retitle themselves, or move zones.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_profile_privileges()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.role <> 'driver' THEN
    NEW.employment_type := NULL;
    NEW.staff_type := NULL;
  END IF;

  IF TG_OP = 'UPDATE' AND NOT public.is_admin() THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.employment_type IS DISTINCT FROM OLD.employment_type
       OR NEW.staff_type IS DISTINCT FROM OLD.staff_type
       OR NEW.is_active IS DISTINCT FROM OLD.is_active
       OR NEW.hub_zone IS DISTINCT FROM OLD.hub_zone
       OR NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'only an admin can change role, staff type, zone, or active status';
    END IF;

    -- Auth is the source of truth for email. The auth.users trigger may copy
    -- a confirmed change; a direct profile update may not invent one.
    IF NEW.email IS DISTINCT FROM OLD.email AND NOT EXISTS (
      SELECT 1
      FROM auth.users
      WHERE id = NEW.id
        AND email IS NOT DISTINCT FROM NEW.email
    ) THEN
      RAISE EXCEPTION 'profile email must match the auth user';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Pickup reservations. A pickup driver sees and claims only pending parcels
-- that nobody reserved, or that an admin reserved for them. Bodies match 0004
-- apart from the reservation condition.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.pickup_merchant_groups()
RETURNS TABLE (
  merchant_id uuid,
  company_name text,
  phone text,
  pickup_address text,
  pickup_gps_url text,
  pending_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    o.merchant_id,
    coalesce(
      nullif(btrim(p.company_name), ''),
      nullif(btrim(p.full_name), ''),
      'Merchant'
    ) AS company_name,
    nullif(btrim(p.phone), '') AS phone,
    (array_agg(o.pickup_address ORDER BY o.created_at DESC))[1] AS pickup_address,
    (
      array_agg(o.pickup_gps_url ORDER BY o.created_at DESC)
        FILTER (WHERE o.pickup_gps_url IS NOT NULL)
    )[1] AS pickup_gps_url,
    count(*) AS pending_count
  FROM public.orders AS o
  JOIN public.profiles AS p ON p.id = o.merchant_id
  WHERE o.status = 'pending'
    AND (o.pickup_driver_id IS NULL OR o.pickup_driver_id = auth.uid())
    AND auth.uid() IS NOT NULL
    AND public.current_user_role() = 'driver'
  GROUP BY o.merchant_id, p.company_name, p.full_name, p.phone
  ORDER BY 2, 1;
$fn$;

CREATE OR REPLACE FUNCTION public.scan_pickup_parcel(
  p_merchant_id uuid,
  p_tracking_code text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_code text;
  v_order public.orders;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'rapid:unauthorized' USING ERRCODE = 'P0001';
  END IF;

  IF public.current_user_role() IS DISTINCT FROM 'driver' THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;

  v_code := upper(btrim(coalesce(p_tracking_code, '')));
  IF p_merchant_id IS NULL OR v_code !~ '^[A-Z0-9][A-Z0-9-]{3,31}$' THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE tracking_code = v_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'rapid:not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_order.merchant_id IS DISTINCT FROM p_merchant_id THEN
    RAISE EXCEPTION 'rapid:wrong_merchant' USING ERRCODE = 'P0001';
  END IF;

  IF v_order.status IS DISTINCT FROM 'pending'
     OR (
       v_order.pickup_driver_id IS NOT NULL
       AND v_order.pickup_driver_id IS DISTINCT FROM auth.uid()
     ) THEN
    RAISE EXCEPTION 'rapid:not_pending' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'tracking_code', v_order.tracking_code,
    'merchant_id', v_order.merchant_id
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.confirm_batch_pickup(p_tracking_codes text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_codes text[];
  v_order public.orders;
  v_found integer := 0;
  v_merchant uuid := NULL;
  v_updated bigint := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'rapid:unauthorized' USING ERRCODE = 'P0001';
  END IF;

  IF public.current_user_role() IS DISTINCT FROM 'driver' THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;

  IF p_tracking_codes IS NULL
     OR cardinality(p_tracking_codes) < 1
     OR cardinality(p_tracking_codes) > 100
     OR EXISTS (SELECT 1 FROM unnest(p_tracking_codes) AS c WHERE c IS NULL) THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT array_agg(upper(btrim(c)) ORDER BY ord)
  INTO v_codes
  FROM unnest(p_tracking_codes) WITH ORDINALITY AS t(c, ord);

  IF EXISTS (
       SELECT 1 FROM unnest(v_codes) AS c WHERE c !~ '^[A-Z0-9][A-Z0-9-]{3,31}$'
     )
     OR (SELECT count(DISTINCT c) FROM unnest(v_codes) AS c) <> cardinality(v_codes) THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  -- Lock in a fixed order so two drivers scanning overlapping codes cannot
  -- deadlock. The loser sees status <> pending once the winner commits.
  FOR v_order IN
    SELECT *
    FROM public.orders
    WHERE tracking_code = ANY (v_codes)
    ORDER BY id
    FOR UPDATE
  LOOP
    v_found := v_found + 1;

    IF v_merchant IS NULL THEN
      v_merchant := v_order.merchant_id;
    ELSIF v_merchant IS DISTINCT FROM v_order.merchant_id THEN
      RAISE EXCEPTION 'rapid:wrong_merchant' USING ERRCODE = 'P0001';
    END IF;

    IF v_order.status IS DISTINCT FROM 'pending'
       OR (
         v_order.pickup_driver_id IS NOT NULL
         AND v_order.pickup_driver_id IS DISTINCT FROM auth.uid()
       ) THEN
      RAISE EXCEPTION 'rapid:not_pending' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  IF v_found <> cardinality(v_codes) THEN
    RAISE EXCEPTION 'rapid:not_found' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('app.trusted_order_write', 'on', true);

  UPDATE public.orders
  SET status = 'picked_up',
      pickup_driver_id = auth.uid()
  WHERE tracking_code = ANY (v_codes)
    AND status = 'pending'
    AND (pickup_driver_id IS NULL OR pickup_driver_id = auth.uid());

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> cardinality(v_codes) THEN
    RAISE EXCEPTION 'rapid:failed' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'tracking_codes', to_jsonb(v_codes),
    'count', v_updated,
    'merchant_id', v_merchant
  );
EXCEPTION
  WHEN check_violation THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Admin dispatch. One call assigns a batch to one active driver.
--
--   leg = 'pickup'    pending parcels get pickup_driver_id = the driver. The
--                     status stays pending; the reservation is what the pickup
--                     functions above honour.
--   leg = 'delivery'  at_hub (or already in_transit) parcels become in_transit
--                     with driver_id = the driver. This is the admin version of
--                     start_delivery_from_hub, so the parcel's own pickup driver
--                     is refused for the same privacy reason.
--
-- Each parcel is judged on its own. The result lists what moved and what was
-- skipped with a reason, so a mixed scan of a bulk selection is not all-or-none.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_dispatch_orders(
  p_tracking_codes text[],
  p_driver_id uuid,
  p_leg text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_leg text;
  v_codes text[];
  v_driver public.profiles;
  v_order public.orders;
  v_code text;
  v_assigned text[] := ARRAY[]::text[];
  v_newly_out text[] := ARRAY[]::text[];
  v_skipped jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'rapid:unauthorized' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;

  v_leg := lower(btrim(coalesce(p_leg, '')));
  IF v_leg NOT IN ('pickup', 'delivery') OR p_driver_id IS NULL THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  IF p_tracking_codes IS NULL
     OR cardinality(p_tracking_codes) < 1
     OR cardinality(p_tracking_codes) > 200
     OR EXISTS (SELECT 1 FROM unnest(p_tracking_codes) AS c WHERE c IS NULL) THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT array_agg(DISTINCT upper(btrim(c)))
  INTO v_codes
  FROM unnest(p_tracking_codes) AS c;

  IF EXISTS (
    SELECT 1 FROM unnest(v_codes) AS c WHERE c !~ '^[A-Z0-9][A-Z0-9-]{3,31}$'
  ) THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_driver
  FROM public.profiles
  WHERE id = p_driver_id;

  IF NOT FOUND OR v_driver.role IS DISTINCT FROM 'driver' THEN
    RAISE EXCEPTION 'rapid:not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT v_driver.is_active THEN
    RAISE EXCEPTION 'rapid:inactive' USING ERRCODE = 'P0001';
  END IF;

  IF v_driver.staff_type = 'hub_operator'
     OR (v_leg = 'pickup' AND v_driver.staff_type = 'delivery_driver')
     OR (v_leg = 'delivery' AND v_driver.staff_type = 'pickup_driver') THEN
    RAISE EXCEPTION 'rapid:wrong_staff_type' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('app.trusted_order_write', 'on', true);

  -- Sorted by code so two overlapping dispatches lock in the same order.
  FOR v_code IN
    SELECT c FROM unnest(v_codes) AS c ORDER BY c
  LOOP
    SELECT *
    INTO v_order
    FROM public.orders
    WHERE tracking_code = v_code
    FOR UPDATE;

    IF NOT FOUND THEN
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object('code', v_code, 'reason', 'not_found')
      );
      CONTINUE;
    END IF;

    BEGIN
      IF v_leg = 'pickup' THEN
        IF v_order.status::text IS DISTINCT FROM 'pending' THEN
          v_skipped := v_skipped || jsonb_build_array(
            jsonb_build_object('code', v_code, 'reason', 'not_pending')
          );
          CONTINUE;
        END IF;

        UPDATE public.orders
        SET pickup_driver_id = p_driver_id
        WHERE id = v_order.id;

        v_assigned := array_append(v_assigned, v_code);
      ELSE
        IF v_order.status::text NOT IN ('at_hub', 'in_transit') THEN
          v_skipped := v_skipped || jsonb_build_array(
            jsonb_build_object('code', v_code, 'reason', 'not_at_hub')
          );
          CONTINUE;
        END IF;

        IF v_order.pickup_driver_id IS NOT DISTINCT FROM p_driver_id THEN
          v_skipped := v_skipped || jsonb_build_array(
            jsonb_build_object('code', v_code, 'reason', 'same_driver')
          );
          CONTINUE;
        END IF;

        IF v_order.status::text = 'at_hub'
           OR v_order.driver_id IS DISTINCT FROM p_driver_id THEN
          UPDATE public.orders
          SET status = 'in_transit',
              driver_id = p_driver_id
          WHERE id = v_order.id;
        END IF;

        v_assigned := array_append(v_assigned, v_code);
        IF v_order.status::text = 'at_hub' THEN
          v_newly_out := array_append(v_newly_out, v_code);
        END IF;
      END IF;
    EXCEPTION
      WHEN check_violation THEN
        v_skipped := v_skipped || jsonb_build_array(
          jsonb_build_object('code', v_code, 'reason', 'invalid')
        );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'leg', v_leg,
    'driver_id', p_driver_id,
    'assigned', to_jsonb(v_assigned),
    'newly_out_for_delivery', to_jsonb(v_newly_out),
    'skipped', v_skipped
  );
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Admin status override. Corrects a parcel's position or releases a driver.
-- Delivered parcels and parcels with a posted ledger entry are locked: money
-- already moved, and corrections there are ledger entries. `delivered` is not
-- a valid target either; only the driver's OTP and GPS handoff produces it.
--
--   p_status    pending | picked_up | at_hub | in_transit | returned | cancelled,
--               or NULL to keep the status.
--   p_unassign  delivery | pickup | both, or NULL.
--
-- Unassigning the delivery driver of an in_transit parcel (with no explicit
-- status) sends it back to at_hub; unassigning the pickup driver of a
-- picked_up parcel sends it back to pending. Either way it is in the pool.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_override_order(
  p_tracking_code text,
  p_status text DEFAULT NULL,
  p_unassign text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_code text;
  v_order public.orders;
  v_unassign text;
  v_status text;
  v_new text;
  v_driver uuid;
  v_pickup uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'rapid:unauthorized' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;

  v_code := upper(btrim(coalesce(p_tracking_code, '')));
  v_status := nullif(lower(btrim(coalesce(p_status, ''))), '');
  v_unassign := nullif(lower(btrim(coalesce(p_unassign, ''))), '');

  IF v_code !~ '^[A-Z0-9][A-Z0-9-]{3,31}$'
     OR (v_status IS NOT NULL AND v_status NOT IN (
       'pending', 'picked_up', 'at_hub', 'in_transit', 'returned', 'cancelled'
     ))
     OR (v_unassign IS NOT NULL AND v_unassign NOT IN ('delivery', 'pickup', 'both')) THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE tracking_code = v_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'rapid:not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_order.status::text = 'delivered' OR v_order.ledger_posted_at IS NOT NULL THEN
    RAISE EXCEPTION 'rapid:locked' USING ERRCODE = 'P0001';
  END IF;

  v_driver := v_order.driver_id;
  v_pickup := v_order.pickup_driver_id;
  v_new := coalesce(v_status, v_order.status::text);

  IF v_unassign IN ('delivery', 'both') THEN
    v_driver := NULL;
  END IF;
  IF v_unassign IN ('pickup', 'both') THEN
    v_pickup := NULL;
  END IF;

  IF v_status IS NULL THEN
    IF v_unassign IN ('delivery', 'both') AND v_order.status::text = 'in_transit' THEN
      v_new := 'at_hub';
    ELSIF v_unassign IN ('pickup', 'both') AND v_order.status::text = 'picked_up' THEN
      v_new := 'pending';
    END IF;
  END IF;

  -- Positions that cannot have a delivery driver.
  IF v_new IN ('pending', 'picked_up', 'at_hub') THEN
    v_driver := NULL;
  END IF;
  IF v_new = 'pending' THEN
    v_pickup := NULL;
  END IF;

  IF (v_new = 'in_transit' AND v_driver IS NULL)
     OR (v_new = 'picked_up' AND v_pickup IS NULL) THEN
    RAISE EXCEPTION 'rapid:needs_driver' USING ERRCODE = 'P0001';
  END IF;

  IF v_new = v_order.status::text
     AND v_driver IS NOT DISTINCT FROM v_order.driver_id
     AND v_pickup IS NOT DISTINCT FROM v_order.pickup_driver_id THEN
    RETURN jsonb_build_object(
      'tracking_code', v_order.tracking_code,
      'status', v_order.status::text,
      'changed', false
    );
  END IF;

  PERFORM set_config('app.trusted_order_write', 'on', true);

  UPDATE public.orders
  SET status = v_new::public.order_status,
      driver_id = v_driver,
      pickup_driver_id = v_pickup
  WHERE id = v_order.id;

  RETURN jsonb_build_object(
    'tracking_code', v_order.tracking_code,
    'status', v_new,
    'changed', true
  );
EXCEPTION
  WHEN check_violation THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Staff offboarding.
--
-- release_staff_shipments puts every unfinished parcel a staff member holds
-- back in the dispatch pool. Delivered, returned, and cancelled parcels keep
-- their driver for the record. Internal: not callable by clients.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.release_staff_shipments(p_staff_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_delivery bigint := 0;
  v_pickup bigint := 0;
  v_repooled bigint := 0;
  v_legacy bigint := 0;
BEGIN
  PERFORM set_config('app.trusted_order_write', 'on', true);

  -- Out for delivery with this driver: back to the hub, unassigned.
  UPDATE public.orders
  SET status = 'at_hub', driver_id = NULL
  WHERE driver_id = p_staff_id
    AND status::text = 'in_transit';
  GET DIAGNOSTICS v_delivery = ROW_COUNT;

  -- Collected from the merchant by this driver but not yet at the hub: the
  -- parcel is no longer accounted for, so it is pending pickup again.
  UPDATE public.orders
  SET status = 'pending', pickup_driver_id = NULL
  WHERE pickup_driver_id = p_staff_id
    AND status::text = 'picked_up';
  GET DIAGNOSTICS v_repooled = ROW_COUNT;

  -- Reserved for this driver's pickup but not collected: release the hold.
  UPDATE public.orders
  SET pickup_driver_id = NULL
  WHERE pickup_driver_id = p_staff_id
    AND status::text = 'pending';
  GET DIAGNOSTICS v_pickup = ROW_COUNT;

  -- Legacy `assigned` parcels (pre-hub flow).
  UPDATE public.orders
  SET status = 'pending', driver_id = NULL, pickup_driver_id = NULL
  WHERE (driver_id = p_staff_id OR pickup_driver_id = p_staff_id)
    AND status::text = 'assigned';
  GET DIAGNOSTICS v_legacy = ROW_COUNT;

  RETURN jsonb_build_object(
    'released_delivery', v_delivery,
    'released_pickup', v_pickup + v_legacy,
    'repooled_pickup', v_repooled
  );
END;
$fn$;

-- Suspend a staff member. Their parcels return to the pool and, because the
-- account is inactive, they resolve to no role. History stays.
CREATE OR REPLACE FUNCTION public.admin_deactivate_staff(p_staff_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_target public.profiles;
  v_released jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'rapid:unauthorized' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;

  IF p_staff_id IS NULL THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_target
  FROM public.profiles
  WHERE id = p_staff_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'rapid:not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_target.role IS DISTINCT FROM 'driver' THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.profiles
  SET is_active = false
  WHERE id = p_staff_id;

  v_released := public.release_staff_shipments(p_staff_id);

  RETURN jsonb_build_object('staff_id', p_staff_id) || v_released;
END;
$fn$;

-- Permanently remove a staff member who has no history that must be kept: no
-- delivered parcel, no ledger row, and a zero wallet. Their unfinished parcels
-- return to the pool, the wallet row and login are removed, and old parcels
-- that only named them as pickup driver are unlinked by the foreign key.
-- Anyone with history is refused with rapid:has_history; deactivate instead.
CREATE OR REPLACE FUNCTION public.admin_delete_staff(p_staff_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_target public.profiles;
  v_wallet public.wallets;
  v_released jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'rapid:unauthorized' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;

  IF p_staff_id IS NULL THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_target
  FROM public.profiles
  WHERE id = p_staff_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'rapid:not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_target.role IS DISTINCT FROM 'driver' OR v_target.id = auth.uid() THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_wallet
  FROM public.wallets
  WHERE driver_id = p_staff_id
  FOR UPDATE;

  IF EXISTS (
       SELECT 1
       FROM public.orders
       WHERE driver_id = p_staff_id
         AND status::text = 'delivered'
     )
     OR (
       FOUND
       AND (
         v_wallet.balance <> 0
         OR EXISTS (
           SELECT 1 FROM public.transactions WHERE wallet_id = v_wallet.id
         )
       )
     ) THEN
    RAISE EXCEPTION 'rapid:has_history' USING ERRCODE = 'P0001';
  END IF;

  v_released := public.release_staff_shipments(p_staff_id);

  DELETE FROM public.wallets WHERE driver_id = p_staff_id;

  -- profiles.id references auth.users ON DELETE CASCADE.
  DELETE FROM auth.users WHERE id = p_staff_id;

  RETURN jsonb_build_object('staff_id', p_staff_id) || v_released;
EXCEPTION
  WHEN foreign_key_violation OR check_violation THEN
    RAISE EXCEPTION 'rapid:has_history' USING ERRCODE = 'P0001';
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Grants. Admin RPCs are callable by signed-in users and re-check is_admin()
-- inside. The release helper is internal.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.admin_dispatch_orders(text[], uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_override_order(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_deactivate_staff(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_delete_staff(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.release_staff_shipments(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_dispatch_orders(text[], uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_override_order(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_deactivate_staff(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_staff(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.protect_profile_privileges() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pickup_merchant_groups() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.scan_pickup_parcel(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_batch_pickup(text[]) FROM PUBLIC, anon;
