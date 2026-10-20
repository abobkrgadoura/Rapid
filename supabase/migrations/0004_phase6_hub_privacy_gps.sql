-- Phase 6 — Hub & Spoke logistics, pickup-driver privacy, batch pickup, GPS links.
--
-- Flow:  Merchant -> Pickup Driver (batch scan) -> Admin Hub (scan)
--        -> Delivery Driver (scan) -> Customer
--
--   pending --confirm_batch_pickup--> picked_up --receive_order_at_hub--> at_hub
--   at_hub --start_delivery_from_hub--> in_transit --complete_delivery--> delivered
--
-- orders.driver_id is now strictly the DELIVERY driver. orders.pickup_driver_id
-- is the PICKUP driver. A pickup driver has no orders policy at all, so they
-- cannot read a customer's name, phone, address, or dropoff GPS link through
-- the table or the orders_readable view. What they see is produced by
-- pickup_merchant_groups(), which returns merchant fields only. The delivery
-- driver gets the existing orders_driver_select policy (driver_id = me), which
-- only matches once start_delivery_from_hub has assigned them.
--
-- Additive migration: no table is dropped or rewritten. Functions that already
-- exist are replaced in place (CREATE OR REPLACE), and two Phase 4/5 entry
-- points that would bypass the hub are revoked rather than deleted.
--
-- Enum note: ALTER TYPE ... ADD VALUE cannot be used in the transaction that
-- adds it. Nothing below evaluates the 'at_hub' literal while this file runs:
-- constraints compare status::text, and every function that names 'at_hub' is
-- plpgsql (the literal is resolved when the function runs, after commit).

-- ---------------------------------------------------------------------------
-- Enum, columns
-- ---------------------------------------------------------------------------

ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'at_hub' AFTER 'picked_up';

ALTER TABLE public.profiles
  ADD COLUMN company_name text;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_company_name_shape CHECK (
    company_name IS NULL
    OR (btrim(company_name) <> '' AND char_length(company_name) <= 120)
  );

COMMENT ON COLUMN public.profiles.company_name IS
  'Merchant trading name. Shown to pickup drivers and used in customer messages. Falls back to full_name when empty.';

ALTER TABLE public.orders
  ADD COLUMN pickup_driver_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  ADD COLUMN pickup_gps_url text,
  ADD COLUMN dropoff_gps_url text;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_pickup_gps_url_shape CHECK (
    pickup_gps_url IS NULL
    OR (pickup_gps_url ~ '^https://[^[:space:]]+$' AND char_length(pickup_gps_url) <= 2048)
  ),
  ADD CONSTRAINT orders_dropoff_gps_url_shape CHECK (
    dropoff_gps_url IS NULL
    OR (dropoff_gps_url ~ '^https://[^[:space:]]+$' AND char_length(dropoff_gps_url) <= 2048)
  ),
  ADD CONSTRAINT orders_pickup_driver_not_merchant CHECK (
    pickup_driver_id IS DISTINCT FROM merchant_id
  );

CREATE INDEX orders_pickup_driver_id_idx ON public.orders (pickup_driver_id);

COMMENT ON COLUMN public.orders.driver_id IS
  'Delivery driver. Set by start_delivery_from_hub (or an admin). Never the pickup driver.';
COMMENT ON COLUMN public.orders.pickup_driver_id IS
  'Pickup driver who collected the batch from the merchant. Set by confirm_batch_pickup. Not selectable through any driver policy.';
COMMENT ON COLUMN public.orders.pickup_gps_url IS
  'Map link to the merchant pickup point. https only.';
COMMENT ON COLUMN public.orders.dropoff_gps_url IS
  'Map link to the customer dropoff point. https only. Visible to the delivery driver, never the pickup driver.';

-- The old rule demanded driver_id for every order past pending. After pickup an
-- order has a pickup driver and no delivery driver yet. Delivery states still
-- need the delivery driver.
ALTER TABLE public.orders
  DROP CONSTRAINT orders_assigned_requires_driver;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_progress_requires_driver CHECK (
    status::text IN ('pending', 'cancelled')
    OR driver_id IS NOT NULL
    OR pickup_driver_id IS NOT NULL
  ),
  ADD CONSTRAINT orders_delivery_requires_driver CHECK (
    status::text NOT IN ('in_transit', 'delivered')
    OR driver_id IS NOT NULL
  );

-- Orders collected before this migration were picked up by the driver now on
-- driver_id. Record that fact so the pickup / delivery split is truthful.
DO $backfill$
BEGIN
  PERFORM set_config('app.trusted_order_write', 'on', true);

  UPDATE public.orders
  SET pickup_driver_id = driver_id
  WHERE pickup_driver_id IS NULL
    AND driver_id IS NOT NULL
    AND status::text IN ('picked_up', 'in_transit', 'delivered');
END
$backfill$;

-- ---------------------------------------------------------------------------
-- Signup: merchants may supply company_name in user metadata.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_role_text text;
  v_role public.user_role;
  v_employment_text text;
  v_employment public.employment_type;
  v_company text;
BEGIN
  v_role_text := lower(coalesce(NEW.raw_user_meta_data ->> 'role', 'customer'));

  IF v_role_text IN ('merchant', 'driver', 'customer') THEN
    v_role := v_role_text::public.user_role;
  ELSE
    v_role := 'customer';
  END IF;

  v_employment := NULL;
  IF v_role = 'driver' THEN
    v_employment_text := lower(coalesce(NEW.raw_user_meta_data ->> 'employment_type', ''));
    IF v_employment_text IN ('freelance', 'in_house') THEN
      v_employment := v_employment_text::public.employment_type;
    END IF;
  END IF;

  v_company := NULL;
  IF v_role = 'merchant' THEN
    v_company := nullif(
      btrim(left(coalesce(NEW.raw_user_meta_data ->> 'company_name', ''), 120)),
      ''
    );
  END IF;

  INSERT INTO public.profiles (id, role, employment_type, full_name, phone, email, company_name)
  VALUES (
    NEW.id,
    v_role,
    v_employment,
    coalesce(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name'),
    coalesce(NEW.phone, NEW.raw_user_meta_data ->> 'phone'),
    NEW.email,
    v_company
  );

  IF v_role = 'driver' THEN
    INSERT INTO public.wallets (driver_id)
    VALUES (NEW.id)
    ON CONFLICT (driver_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Triggers. Same bodies as 0001 / 0002 plus the two new driver-ish columns.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_order_role_refs()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_role public.user_role;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id THEN
    SELECT role INTO v_role FROM public.profiles WHERE id = NEW.merchant_id;
    IF v_role IS DISTINCT FROM 'merchant' THEN
      RAISE EXCEPTION 'merchant_id must reference a merchant profile';
    END IF;
  END IF;

  IF NEW.customer_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.customer_id IS DISTINCT FROM OLD.customer_id) THEN
    SELECT role INTO v_role FROM public.profiles WHERE id = NEW.customer_id;
    IF v_role IS DISTINCT FROM 'customer' THEN
      RAISE EXCEPTION 'customer_id must reference a customer profile';
    END IF;
  END IF;

  IF NEW.driver_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.driver_id IS DISTINCT FROM OLD.driver_id) THEN
    SELECT role INTO v_role FROM public.profiles WHERE id = NEW.driver_id;
    IF v_role IS DISTINCT FROM 'driver' THEN
      RAISE EXCEPTION 'driver_id must reference a driver profile';
    END IF;
  END IF;

  IF NEW.pickup_driver_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.pickup_driver_id IS DISTINCT FROM OLD.pickup_driver_id) THEN
    SELECT role INTO v_role FROM public.profiles WHERE id = NEW.pickup_driver_id;
    IF v_role IS DISTINCT FROM 'driver' THEN
      RAISE EXCEPTION 'pickup_driver_id must reference a driver profile';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.guard_order_security()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_trusted boolean := current_setting('app.trusted_order_write', true) = 'on';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.delivery_otp IS NOT NULL
       OR NEW.otp_attempts IS DISTINCT FROM 0
       OR NEW.otp_verified_at IS NOT NULL
       OR NEW.ledger_posted_at IS NOT NULL THEN
      RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
    END IF;

    IF public.is_admin() THEN
      RETURN NEW;
    END IF;

    IF NEW.status IS DISTINCT FROM 'pending'
       OR NEW.driver_id IS NOT NULL
       OR NEW.pickup_driver_id IS NOT NULL THEN
      RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.product_price IS DISTINCT FROM OLD.product_price
     OR NEW.delivery_fee IS DISTINCT FROM OLD.delivery_fee
     OR NEW.platform_commission IS DISTINCT FROM OLD.platform_commission
     OR NEW.payment_type IS DISTINCT FROM OLD.payment_type THEN
    IF OLD.status IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.delivery_otp IS DISTINCT FROM OLD.delivery_otp
     OR NEW.otp_attempts IS DISTINCT FROM OLD.otp_attempts
     OR NEW.otp_verified_at IS DISTINCT FROM OLD.otp_verified_at
     OR NEW.ledger_posted_at IS DISTINCT FROM OLD.ledger_posted_at THEN
    IF NOT v_trusted THEN
      RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF (
       NEW.driver_id IS DISTINCT FROM OLD.driver_id
       OR NEW.pickup_driver_id IS DISTINCT FROM OLD.pickup_driver_id
     )
     AND NOT v_trusted
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;

  -- A merchant may correct a map link only while the order is still pending.
  IF (
       NEW.pickup_gps_url IS DISTINCT FROM OLD.pickup_gps_url
       OR NEW.dropoff_gps_url IS DISTINCT FROM OLD.dropoff_gps_url
     )
     AND OLD.status IS DISTINCT FROM 'pending'
     AND NOT v_trusted
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT v_trusted
     AND NOT public.is_admin() THEN
    -- Merchants may cancel an order that is still pending. Every other
    -- transition goes through an admin or a trusted function.
    IF NEW.status IS DISTINCT FROM 'cancelled'
       OR OLD.status IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Pickup driver: what they may see. Merchant fields only, grouped by
-- merchant. There is no customer column anywhere in this result.
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
    AND auth.uid() IS NOT NULL
    AND public.current_user_role() = 'driver'
  GROUP BY o.merchant_id, p.company_name, p.full_name, p.phone
  ORDER BY 2, 1;
$fn$;

-- One scan inside the batch modal. Says whether this parcel can join the
-- batch for this merchant. Returns the tracking code and merchant id only.
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

  IF v_order.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'rapid:not_pending' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'tracking_code', v_order.tracking_code,
    'merchant_id', v_order.merchant_id
  );
END;
$fn$;

-- All scanned codes become picked_up with pickup_driver_id = the caller, or
-- none do. Every code must exist, be pending, and belong to one merchant.
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

    IF v_order.status IS DISTINCT FROM 'pending' THEN
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
    AND status = 'pending';

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
-- Hub. Admin only. picked_up -> at_hub. Scanning a parcel twice is safe.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.receive_order_at_hub(p_tracking_code text)
RETURNS jsonb
LANGUAGE plpgsql
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

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;

  v_code := upper(btrim(coalesce(p_tracking_code, '')));
  IF v_code !~ '^[A-Z0-9][A-Z0-9-]{3,31}$' THEN
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

  IF v_order.status::text = 'at_hub' THEN
    RETURN jsonb_build_object(
      'order_id', v_order.id,
      'tracking_code', v_order.tracking_code,
      'status', 'at_hub',
      'already_received', true
    );
  END IF;

  IF v_order.status::text IN ('pending', 'assigned') THEN
    RAISE EXCEPTION 'rapid:not_picked_up' USING ERRCODE = 'P0001';
  END IF;

  IF v_order.status::text IS DISTINCT FROM 'picked_up' THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('app.trusted_order_write', 'on', true);

  UPDATE public.orders
  SET status = 'at_hub'
  WHERE id = v_order.id;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'tracking_code', v_order.tracking_code,
    'status', 'at_hub',
    'already_received', false
  );
EXCEPTION
  WHEN check_violation THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Delivery driver loads a parcel from the hub. at_hub -> in_transit and
-- driver_id = caller. The pickup driver of the same parcel cannot take it:
-- the privacy split only holds if one person never plays both roles.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.start_delivery_from_hub(p_tracking_code text)
RETURNS jsonb
LANGUAGE plpgsql
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
  IF v_code !~ '^[A-Z0-9][A-Z0-9-]{3,31}$' THEN
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

  IF v_order.status::text = 'in_transit' THEN
    IF v_order.driver_id IS NOT DISTINCT FROM auth.uid() THEN
      RETURN jsonb_build_object(
        'order_id', v_order.id,
        'tracking_code', v_order.tracking_code,
        'status', 'in_transit',
        'payment_type', v_order.payment_type,
        'already_loaded', true
      );
    END IF;
    RAISE EXCEPTION 'rapid:taken' USING ERRCODE = 'P0001';
  END IF;

  IF v_order.status::text IN ('pending', 'assigned', 'picked_up') THEN
    RAISE EXCEPTION 'rapid:not_at_hub' USING ERRCODE = 'P0001';
  END IF;

  IF v_order.status::text IS DISTINCT FROM 'at_hub' THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  IF v_order.pickup_driver_id IS NOT DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'rapid:same_driver' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('app.trusted_order_write', 'on', true);

  UPDATE public.orders
  SET status = 'in_transit',
      driver_id = auth.uid()
  WHERE id = v_order.id;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'tracking_code', v_order.tracking_code,
    'status', 'in_transit',
    'payment_type', v_order.payment_type,
    'already_loaded', false
  );
EXCEPTION
  WHEN check_violation THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
END;
$fn$;

-- ---------------------------------------------------------------------------
-- complete_delivery now accepts only in_transit. Before this a parcel could be
-- delivered straight from picked_up, which skips the hub. Same checks, GPS
-- fix, and idempotent retry as 0003 otherwise.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.complete_delivery(
  p_order_id uuid,
  p_latitude numeric,
  p_longitude numeric,
  p_accuracy_meters numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_order public.orders;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'rapid:unauthorized' USING ERRCODE = 'P0001';
  END IF;

  IF p_order_id IS NULL
     OR p_latitude IS NULL
     OR p_longitude IS NULL
     OR p_latitude NOT BETWEEN -90 AND 90
     OR p_longitude NOT BETWEEN -180 AND 180
     OR (p_accuracy_meters IS NOT NULL AND (
       p_accuracy_meters < 0 OR p_accuracy_meters > 9999999
     )) THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND
     OR (
       NOT public.is_admin()
       AND v_order.driver_id IS DISTINCT FROM auth.uid()
     ) THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;

  IF v_order.ledger_posted_at IS NOT NULL THEN
    RAISE EXCEPTION 'rapid:conflict' USING ERRCODE = 'P0001';
  END IF;

  IF v_order.status = 'delivered' THEN
    RETURN jsonb_build_object('order_id', v_order.id, 'status', v_order.status);
  END IF;

  IF v_order.driver_id IS NULL
     OR v_order.status IS DISTINCT FROM 'in_transit' THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  IF v_order.payment_type = 'prepaid' AND v_order.otp_verified_at IS NULL THEN
    RAISE EXCEPTION 'rapid:otp_required' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('app.trusted_order_write', 'on', true);

  UPDATE public.orders
  SET status = 'delivered',
      delivered_latitude = round(p_latitude, 6),
      delivered_longitude = round(p_longitude, 6),
      delivered_accuracy_meters = round(p_accuracy_meters, 1)
  WHERE id = v_order.id;

  RETURN jsonb_build_object('order_id', v_order.id, 'status', 'delivered');
EXCEPTION
  WHEN check_violation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Grants. New functions are callable by signed-in users only; each one checks
-- the caller's role itself. The Phase 4 / 5 entry points that skip the hub are
-- closed to clients (the functions stay, so history is readable).
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.pickup_merchant_groups() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.scan_pickup_parcel(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_batch_pickup(text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.receive_order_at_hub(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.start_delivery_from_hub(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.pickup_merchant_groups() TO authenticated;
GRANT EXECUTE ON FUNCTION public.scan_pickup_parcel(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_batch_pickup(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_order_at_hub(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_delivery_from_hub(text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.start_delivery(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.process_batch_pickup(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_order_role_refs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_order_security() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Column grants and the readable view. Column-level SELECT (0003) means a new
-- column is invisible to clients until it is granted. RLS still decides which
-- rows; a pickup driver matches no orders policy, so they read none of this.
-- ---------------------------------------------------------------------------

GRANT SELECT (pickup_driver_id, pickup_gps_url, dropoff_gps_url)
  ON TABLE public.orders TO authenticated;

CREATE OR REPLACE VIEW public.orders_readable
WITH (security_invoker = true) AS
SELECT
  id,
  tracking_code,
  merchant_id,
  customer_id,
  driver_id,
  status,
  payment_type,
  product_price,
  delivery_fee,
  platform_commission,
  pickup_address,
  dropoff_address,
  created_at,
  otp_attempts,
  otp_verified_at,
  ledger_posted_at,
  picked_up_at,
  in_transit_at,
  delivered_at,
  delivered_latitude,
  delivered_longitude,
  delivered_accuracy_meters,
  pickup_driver_id,
  pickup_gps_url,
  dropoff_gps_url
FROM public.orders;

REVOKE ALL ON TABLE public.orders_readable FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.orders_readable TO authenticated;
