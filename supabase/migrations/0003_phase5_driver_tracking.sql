-- Phase 5 (Part 2) — driver delivery flow and public tracking.
--
-- 1. orders gains lifecycle timestamps (for the tracking timeline) and the
--    GPS fix the driver reported at handoff. A trigger stamps the timestamps
--    from status changes, so no client can write them.
-- 2. start_delivery moves picked_up -> in_transit. complete_delivery moves
--    picked_up / in_transit -> delivered and stores the location. Neither
--    posts money: post_delivery_ledger (Phase 4) still does that, and still
--    requires status = 'delivered' and, for prepaid, a verified OTP.
-- 3. track_order_details is the anonymous read path for the tracking page.
--    It returns status, step timestamps, and the assigned driver's name and
--    phone while the order is still active. Nothing else leaves the database.
-- 4. Closes a gap in 0002: REVOKE SELECT (delivery_otp) was a no-op because
--    authenticated held a table-level SELECT, and a column revoke never
--    overrides a table grant. SELECT is now granted per column, without
--    delivery_otp.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.orders
  ADD COLUMN picked_up_at timestamptz,
  ADD COLUMN in_transit_at timestamptz,
  ADD COLUMN delivered_at timestamptz,
  ADD COLUMN delivered_latitude numeric(9, 6),
  ADD COLUMN delivered_longitude numeric(9, 6),
  ADD COLUMN delivered_accuracy_meters numeric(9, 1);

ALTER TABLE public.orders
  ADD CONSTRAINT orders_delivered_latitude_range CHECK (
    delivered_latitude IS NULL OR delivered_latitude BETWEEN -90 AND 90
  ),
  ADD CONSTRAINT orders_delivered_longitude_range CHECK (
    delivered_longitude IS NULL OR delivered_longitude BETWEEN -180 AND 180
  ),
  ADD CONSTRAINT orders_delivered_accuracy_nonnegative CHECK (
    delivered_accuracy_meters IS NULL OR delivered_accuracy_meters >= 0
  ),
  ADD CONSTRAINT orders_delivered_location_pair CHECK (
    (delivered_latitude IS NULL) = (delivered_longitude IS NULL)
  );

COMMENT ON COLUMN public.orders.picked_up_at IS
  'Stamped by orders_stamp_lifecycle when status becomes picked_up. Null for orders that predate this column.';
COMMENT ON COLUMN public.orders.in_transit_at IS
  'Stamped when status becomes in_transit (out for delivery).';
COMMENT ON COLUMN public.orders.delivered_at IS
  'Stamped when status becomes delivered.';
COMMENT ON COLUMN public.orders.delivered_latitude IS
  'Driver GPS latitude at handoff, written only by complete_delivery.';
COMMENT ON COLUMN public.orders.delivered_longitude IS
  'Driver GPS longitude at handoff, written only by complete_delivery.';
COMMENT ON COLUMN public.orders.delivered_accuracy_meters IS
  'Reported GPS accuracy radius in meters at handoff.';

-- ---------------------------------------------------------------------------
-- Lifecycle trigger. Timestamps are derived, never client-supplied. The GPS
-- columns can only change while app.trusted_order_write is on, which only
-- complete_delivery sets.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.stamp_order_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_trusted boolean := current_setting('app.trusted_order_write', true) = 'on';
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.picked_up_at := NULL;
    NEW.in_transit_at := NULL;
    NEW.delivered_at := NULL;
    NEW.delivered_latitude := NULL;
    NEW.delivered_longitude := NULL;
    NEW.delivered_accuracy_meters := NULL;
    RETURN NEW;
  END IF;

  NEW.picked_up_at := OLD.picked_up_at;
  NEW.in_transit_at := OLD.in_transit_at;
  NEW.delivered_at := OLD.delivered_at;

  IF NOT v_trusted THEN
    NEW.delivered_latitude := OLD.delivered_latitude;
    NEW.delivered_longitude := OLD.delivered_longitude;
    NEW.delivered_accuracy_meters := OLD.delivered_accuracy_meters;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'picked_up' THEN
      NEW.picked_up_at := coalesce(NEW.picked_up_at, now());
    ELSIF NEW.status = 'in_transit' THEN
      NEW.in_transit_at := coalesce(NEW.in_transit_at, now());
    ELSIF NEW.status = 'delivered' THEN
      NEW.delivered_at := coalesce(NEW.delivered_at, now());
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER orders_stamp_lifecycle
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_order_lifecycle();

REVOKE ALL ON FUNCTION public.stamp_order_lifecycle() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- start_delivery: picked_up -> in_transit. Idempotent when already in transit.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.start_delivery(p_order_id uuid)
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

  IF p_order_id IS NULL THEN
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

  IF v_order.status = 'in_transit' THEN
    RETURN jsonb_build_object('order_id', v_order.id, 'status', v_order.status);
  END IF;

  IF v_order.status IS DISTINCT FROM 'picked_up' OR v_order.driver_id IS NULL THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('app.trusted_order_write', 'on', true);

  UPDATE public.orders
  SET status = 'in_transit'
  WHERE id = v_order.id;

  RETURN jsonb_build_object('order_id', v_order.id, 'status', 'in_transit');
EXCEPTION
  WHEN check_violation THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
END;
$fn$;

-- ---------------------------------------------------------------------------
-- complete_delivery: picked_up / in_transit -> delivered, with the GPS fix.
--
-- Prepaid orders need otp_verified_at (set by verify_delivery_otp). A COD
-- order has no OTP. Already delivered but not yet posted returns the stored
-- state, so a failed ledger post can be retried without a second handoff.
-- Once ledger_posted_at is set the order is final (rapid:conflict).
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
     OR v_order.status NOT IN ('picked_up', 'in_transit') THEN
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

REVOKE ALL ON FUNCTION public.start_delivery(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_delivery(uuid, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_delivery(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_delivery(uuid, numeric, numeric, numeric) TO authenticated;

-- ---------------------------------------------------------------------------
-- Public tracking. Anonymous callers look an order up by tracking code and
-- learn only the fields below. The driver is shown while the order is
-- active; once it is delivered or cancelled the driver's contact details are
-- no longer returned.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.track_order_details(p_tracking_code text)
RETURNS TABLE (
  tracking_code text,
  status public.order_status,
  created_at timestamptz,
  picked_up_at timestamptz,
  in_transit_at timestamptz,
  delivered_at timestamptz,
  driver_assigned boolean,
  driver_name text,
  driver_phone text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    o.tracking_code,
    o.status,
    o.created_at,
    o.picked_up_at,
    o.in_transit_at,
    o.delivered_at,
    (o.driver_id IS NOT NULL AND o.status NOT IN ('delivered', 'cancelled')),
    CASE
      WHEN o.status IN ('delivered', 'cancelled') THEN NULL
      ELSE nullif(btrim(p.full_name), '')
    END,
    CASE
      WHEN o.status IN ('delivered', 'cancelled') THEN NULL
      ELSE nullif(btrim(p.phone), '')
    END
  FROM public.orders AS o
  LEFT JOIN public.profiles AS p ON p.id = o.driver_id
  WHERE o.tracking_code = p_tracking_code;
$$;

REVOKE ALL ON FUNCTION public.track_order_details(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_order_details(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Keep delivery_otp unreadable. Replace the table-level SELECT with a column
-- list that leaves it out. The security-definer functions run as the owner
-- and still read it. Any column added to public.orders later needs its own
-- GRANT SELECT (column) or clients will not see it.
-- ---------------------------------------------------------------------------

REVOKE SELECT ON TABLE public.orders FROM PUBLIC, anon, authenticated;

GRANT SELECT (
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
  delivered_accuracy_meters
) ON TABLE public.orders TO authenticated;

-- New columns are appended so the existing view columns keep their order.
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
  delivered_accuracy_meters
FROM public.orders;

REVOKE ALL ON TABLE public.orders_readable FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.orders_readable TO authenticated;
