-- Phase 14 — admin exception review and order corrections.
--
-- 0011 is the pro driver PWA, so this file is 0012.
--
-- An open exception is an order whose exception_reason is set or whose
-- failed_attempts is above zero, and that an admin has not reviewed yet.
-- Accepting it sends the parcel back to the warehouse (at_hub), or marks it
-- returned to the merchant when the customer refused or the driver has
-- already failed three times. Rejecting it clears exception_reason and
-- leaves a driver_alerts row so the driver tries again.
--
-- Customer phone and street address live on dropoff_address. COD is
-- product_price. Those corrections, and delivery_notes, are admin-only and
-- are written through admin_edit_order_details, which also inserts
-- order_history. A posted ledger or a delivered parcel still cannot have
-- its price rewritten.

-- ---------------------------------------------------------------------------
-- Review stamp, audit log, driver alerts
-- ---------------------------------------------------------------------------

ALTER TABLE public.orders
  ADD COLUMN exception_reviewed_at timestamptz;

COMMENT ON COLUMN public.orders.exception_reviewed_at IS
  'When an admin accepted or rejected the open delivery exception. Null means it is still in the review queue.';

GRANT SELECT (exception_reviewed_at) ON TABLE public.orders TO authenticated;

CREATE TABLE public.order_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders (id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  action text NOT NULL,
  changes jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_history_action_known CHECK (
    action IN ('edit_details', 'accept_exception', 'reject_exception')
  ),
  CONSTRAINT order_history_changes_object CHECK (jsonb_typeof(changes) = 'object')
);

CREATE INDEX order_history_order_id_idx
  ON public.order_history (order_id, created_at DESC);

COMMENT ON TABLE public.order_history IS
  'Admin corrections and exception decisions. One row per change, written only by security-definer functions.';

CREATE TABLE public.driver_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders (id) ON DELETE CASCADE,
  tracking_code text NOT NULL,
  kind text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  seen_at timestamptz,
  CONSTRAINT driver_alerts_kind_known CHECK (kind IN ('retry_delivery', 'return_to_hub')),
  CONSTRAINT driver_alerts_message_len CHECK (char_length(message) BETWEEN 1 AND 240),
  CONSTRAINT driver_alerts_code_len CHECK (char_length(tracking_code) BETWEEN 4 AND 32)
);

CREATE INDEX driver_alerts_open_idx
  ON public.driver_alerts (driver_id, created_at DESC)
  WHERE seen_at IS NULL;

COMMENT ON TABLE public.driver_alerts IS
  'Messages an admin decision leaves for the assigned driver. The driver marks them seen.';

ALTER TABLE public.order_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY order_history_admin_select
  ON public.order_history
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY driver_alerts_select
  ON public.driver_alerts
  FOR SELECT
  TO authenticated
  USING (driver_id = auth.uid() OR public.is_admin());

REVOKE ALL ON TABLE public.order_history FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.driver_alerts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.order_history TO authenticated;
GRANT SELECT ON TABLE public.driver_alerts TO authenticated;

-- ---------------------------------------------------------------------------
-- Readable view. New column is appended; replace cannot reorder columns.
-- ---------------------------------------------------------------------------

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
  dropoff_gps_url,
  country_code,
  pickup_fee,
  building_name,
  floor_number,
  apartment_number,
  landmark,
  is_work_address,
  parcel_size,
  pieces_count,
  product_description,
  product_image_url,
  allow_opening,
  delivery_notes,
  public.order_internal_notes(id) AS internal_notes,
  exception_reason,
  call_log_proof_url,
  whatsapp_proof_url,
  door_photo_proof_url,
  attempt_gps_lat,
  attempt_gps_lng,
  attempt_distance_meters,
  is_gps_verified,
  last_attempt_at,
  suspicious_attempt_flag,
  failed_attempts,
  is_partial_delivery,
  delivered_pieces_count,
  returned_pieces_count,
  partial_collected_amount,
  exception_reviewed_at
FROM public.orders;

REVOKE ALL ON TABLE public.orders_readable FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.orders_readable TO authenticated;

-- ---------------------------------------------------------------------------
-- Price guard. A trusted admin function may correct COD (product_price)
-- after the order leaves pending, until money has posted or it is delivered.
-- Delivery fee, commission, and payment type stay frozen.
-- ---------------------------------------------------------------------------

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

    IF NOT v_trusted AND NOT public.is_admin() THEN
      NEW.exception_reason := NULL;
      NEW.call_log_proof_url := NULL;
      NEW.whatsapp_proof_url := NULL;
      NEW.door_photo_proof_url := NULL;
      NEW.attempt_gps_lat := NULL;
      NEW.attempt_gps_lng := NULL;
      NEW.attempt_distance_meters := NULL;
      NEW.is_gps_verified := false;
      NEW.last_attempt_at := NULL;
      NEW.suspicious_attempt_flag := false;
      NEW.failed_attempts := 0;
      NEW.is_partial_delivery := false;
      NEW.delivered_pieces_count := NULL;
      NEW.returned_pieces_count := NULL;
      NEW.partial_collected_amount := NULL;
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

  IF NOT v_trusted AND NOT public.is_admin() THEN
    IF NEW.exception_reason IS DISTINCT FROM OLD.exception_reason
       OR NEW.call_log_proof_url IS DISTINCT FROM OLD.call_log_proof_url
       OR NEW.whatsapp_proof_url IS DISTINCT FROM OLD.whatsapp_proof_url
       OR NEW.door_photo_proof_url IS DISTINCT FROM OLD.door_photo_proof_url
       OR NEW.attempt_gps_lat IS DISTINCT FROM OLD.attempt_gps_lat
       OR NEW.attempt_gps_lng IS DISTINCT FROM OLD.attempt_gps_lng
       OR NEW.attempt_distance_meters IS DISTINCT FROM OLD.attempt_distance_meters
       OR NEW.is_gps_verified IS DISTINCT FROM OLD.is_gps_verified
       OR NEW.last_attempt_at IS DISTINCT FROM OLD.last_attempt_at
       OR NEW.suspicious_attempt_flag IS DISTINCT FROM OLD.suspicious_attempt_flag
       OR NEW.failed_attempts IS DISTINCT FROM OLD.failed_attempts
       OR NEW.exception_reviewed_at IS DISTINCT FROM OLD.exception_reviewed_at
       OR NEW.is_partial_delivery IS DISTINCT FROM OLD.is_partial_delivery
       OR NEW.delivered_pieces_count IS DISTINCT FROM OLD.delivered_pieces_count
       OR NEW.returned_pieces_count IS DISTINCT FROM OLD.returned_pieces_count
       OR NEW.partial_collected_amount IS DISTINCT FROM OLD.partial_collected_amount THEN
      RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
    END IF;

    IF OLD.status IS DISTINCT FROM 'pending'
       AND (
         NEW.building_name IS DISTINCT FROM OLD.building_name
         OR NEW.floor_number IS DISTINCT FROM OLD.floor_number
         OR NEW.apartment_number IS DISTINCT FROM OLD.apartment_number
         OR NEW.landmark IS DISTINCT FROM OLD.landmark
         OR NEW.is_work_address IS DISTINCT FROM OLD.is_work_address
         OR NEW.parcel_size IS DISTINCT FROM OLD.parcel_size
         OR NEW.pieces_count IS DISTINCT FROM OLD.pieces_count
         OR NEW.product_description IS DISTINCT FROM OLD.product_description
         OR NEW.product_image_url IS DISTINCT FROM OLD.product_image_url
         OR NEW.allow_opening IS DISTINCT FROM OLD.allow_opening
         OR NEW.delivery_notes IS DISTINCT FROM OLD.delivery_notes
         OR NEW.internal_notes IS DISTINCT FROM OLD.internal_notes
       ) THEN
      RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.product_price IS DISTINCT FROM OLD.product_price
     OR NEW.delivery_fee IS DISTINCT FROM OLD.delivery_fee
     OR NEW.platform_commission IS DISTINCT FROM OLD.platform_commission
     OR NEW.payment_type IS DISTINCT FROM OLD.payment_type THEN
    IF OLD.status IS DISTINCT FROM 'pending' THEN
      IF NOT (
        v_trusted
        AND public.is_admin()
        AND OLD.ledger_posted_at IS NULL
        AND OLD.status::text IS DISTINCT FROM 'delivered'
        AND NEW.product_price IS DISTINCT FROM OLD.product_price
        AND NEW.delivery_fee IS NOT DISTINCT FROM OLD.delivery_fee
        AND NEW.platform_commission IS NOT DISTINCT FROM OLD.platform_commission
        AND NEW.payment_type IS NOT DISTINCT FROM OLD.payment_type
      ) THEN
        RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
      END IF;
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
    IF NEW.status IS DISTINCT FROM 'cancelled'
       OR OLD.status IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Accept or reject an open exception. Admin only.
--
-- accept:
--   refused, or 3+ failed attempts -> returned (back to the merchant)
--   otherwise -> at_hub (back to the warehouse for another dispatch)
--   a parcel still pending stays pending; it was never out with a driver
--   at_hub and returned release the delivery driver
-- reject:
--   clears exception_reason and tells the assigned driver to try again
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_review_exception(
  p_tracking_code text,
  p_decision text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_code text;
  v_decision text;
  v_order public.orders;
  v_target text;
  v_alerted boolean := false;
  v_message text;
  v_kind text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'rapid:unauthorized' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;

  v_code := upper(btrim(coalesce(p_tracking_code, '')));
  v_decision := lower(btrim(coalesce(p_decision, '')));

  IF v_code !~ '^[A-Z0-9][A-Z0-9-]{3,31}$'
     OR v_decision NOT IN ('accept', 'reject') THEN
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

  IF v_order.exception_reviewed_at IS NOT NULL
     OR (v_order.exception_reason IS NULL AND v_order.failed_attempts <= 0) THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  IF v_decision = 'accept'
     AND (
       v_order.status::text IN ('delivered', 'cancelled')
       OR v_order.ledger_posted_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'rapid:locked' USING ERRCODE = 'P0001';
  END IF;

  IF v_decision = 'accept' THEN
    IF v_order.exception_reason = 'refused' OR v_order.failed_attempts >= 3 THEN
      v_target := 'returned';
    ELSE
      v_target := 'at_hub';
    END IF;

    IF v_order.status::text = 'pending' AND v_target = 'at_hub' THEN
      v_target := 'pending';
    END IF;

    IF v_target IN ('at_hub', 'returned') AND v_order.driver_id IS NOT NULL THEN
      v_kind := 'return_to_hub';
      v_message := CASE
        WHEN v_target = 'returned' THEN
          'قُبل عذر الشحنة ' || v_order.tracking_code || '. أعدها إلى المخزن لترجيعها للتاجر.'
        ELSE
          'قُبل عذر الشحنة ' || v_order.tracking_code || '. أعدها إلى المخزن.'
      END;

      INSERT INTO public.driver_alerts (driver_id, order_id, tracking_code, kind, message)
      VALUES (v_order.driver_id, v_order.id, v_order.tracking_code, v_kind, v_message);
      v_alerted := true;
    END IF;

    PERFORM set_config('app.trusted_order_write', 'on', true);

    UPDATE public.orders
    SET status = v_target::public.order_status,
        driver_id = CASE
          WHEN v_target IN ('at_hub', 'returned') THEN NULL
          ELSE driver_id
        END,
        exception_reviewed_at = now()
    WHERE id = v_order.id;

    INSERT INTO public.order_history (order_id, actor_id, action, changes)
    VALUES (
      v_order.id,
      auth.uid(),
      'accept_exception',
      jsonb_build_object(
        'decision', 'accept',
        'exception_reason', v_order.exception_reason,
        'failed_attempts', v_order.failed_attempts,
        'status', jsonb_build_object('from', v_order.status::text, 'to', v_target)
      )
    );
  ELSE
    IF v_order.driver_id IS NOT NULL THEN
      INSERT INTO public.driver_alerts (driver_id, order_id, tracking_code, kind, message)
      VALUES (
        v_order.driver_id,
        v_order.id,
        v_order.tracking_code,
        'retry_delivery',
        'رفضت الإدارة عذر الشحنة ' || v_order.tracking_code || '. حاول التسليم مرة أخرى.'
      );
      v_alerted := true;
    END IF;

    PERFORM set_config('app.trusted_order_write', 'on', true);

    UPDATE public.orders
    SET exception_reason = NULL,
        exception_reviewed_at = now()
    WHERE id = v_order.id;

    INSERT INTO public.order_history (order_id, actor_id, action, changes)
    VALUES (
      v_order.id,
      auth.uid(),
      'reject_exception',
      jsonb_build_object(
        'decision', 'reject',
        'exception_reason', jsonb_build_object('from', v_order.exception_reason, 'to', NULL),
        'status', v_order.status::text
      )
    );

    v_target := v_order.status::text;
  END IF;

  RETURN jsonb_build_object(
    'id', v_order.id,
    'tracking_code', v_order.tracking_code,
    'decision', v_decision,
    'status', v_target,
    'alerted', v_alerted
  );
EXCEPTION
  WHEN check_violation THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Admin override of the customer phone, street address, COD, and notes.
-- Phone and address are the caller's already-encoded dropoff_address.
-- p_product_price is null or blank when COD must stay as it is.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_edit_order_details(
  p_tracking_code text,
  p_dropoff_address text,
  p_delivery_notes text,
  p_product_price text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_code text;
  v_order public.orders;
  v_dropoff text;
  v_notes text;
  v_price_text text;
  v_price numeric(12, 2);
  v_changes jsonb := '{}'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'rapid:unauthorized' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;

  v_code := upper(btrim(coalesce(p_tracking_code, '')));
  v_dropoff := btrim(coalesce(p_dropoff_address, ''));
  v_notes := nullif(btrim(coalesce(p_delivery_notes, '')), '');
  v_price_text := nullif(btrim(coalesce(p_product_price, '')), '');

  IF v_code !~ '^[A-Z0-9][A-Z0-9-]{3,31}$'
     OR char_length(v_dropoff) < 1
     OR char_length(v_dropoff) > 2000
     OR (v_notes IS NOT NULL AND char_length(v_notes) > 240)
     OR (
       v_price_text IS NOT NULL
       AND v_price_text !~ '^(?:0|[1-9][0-9]{0,9})(?:\.[0-9]{1,2})?$'
     ) THEN
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

  IF v_dropoff IS DISTINCT FROM v_order.dropoff_address THEN
    v_changes := v_changes || jsonb_build_object(
      'dropoff_address',
      jsonb_build_object('from', v_order.dropoff_address, 'to', v_dropoff)
    );
  END IF;

  IF v_notes IS DISTINCT FROM v_order.delivery_notes THEN
    v_changes := v_changes || jsonb_build_object(
      'delivery_notes',
      jsonb_build_object('from', v_order.delivery_notes, 'to', v_notes)
    );
  END IF;

  IF v_price_text IS NOT NULL THEN
    v_price := v_price_text::numeric(12, 2);
    IF v_price IS DISTINCT FROM v_order.product_price THEN
      IF v_order.payment_type::text IS DISTINCT FROM 'cod' THEN
        RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
      END IF;
      IF v_order.ledger_posted_at IS NOT NULL OR v_order.status::text = 'delivered' THEN
        RAISE EXCEPTION 'rapid:locked' USING ERRCODE = 'P0001';
      END IF;
      v_changes := v_changes || jsonb_build_object(
        'product_price',
        jsonb_build_object('from', v_order.product_price, 'to', v_price)
      );
    END IF;
  END IF;

  IF v_changes = '{}'::jsonb THEN
    RETURN jsonb_build_object(
      'id', v_order.id,
      'tracking_code', v_order.tracking_code,
      'changed', false
    );
  END IF;

  PERFORM set_config('app.trusted_order_write', 'on', true);

  UPDATE public.orders
  SET dropoff_address = v_dropoff,
      delivery_notes = v_notes,
      product_price = COALESCE(v_price, product_price)
  WHERE id = v_order.id;

  INSERT INTO public.order_history (order_id, actor_id, action, changes)
  VALUES (v_order.id, auth.uid(), 'edit_details', v_changes);

  RETURN jsonb_build_object(
    'id', v_order.id,
    'tracking_code', v_order.tracking_code,
    'changed', true
  );
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
END;
$fn$;

CREATE OR REPLACE FUNCTION public.acknowledge_driver_alert(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'rapid:unauthorized' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.driver_alerts
  SET seen_at = now()
  WHERE id = p_id
    AND driver_id = auth.uid()
    AND seen_at IS NULL
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'rapid:not_found' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('acknowledged', true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_review_exception(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_edit_order_details(text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.acknowledge_driver_alert(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_review_exception(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_edit_order_details(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acknowledge_driver_alert(uuid) TO authenticated;
