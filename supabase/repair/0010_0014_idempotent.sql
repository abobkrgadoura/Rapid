-- Repair for a database where 0010–0014 columns were already added, but a
-- re-run died on `column ... already exists` before functions, triggers, and
-- policies were created.
--
-- Safe to run more than once in the Supabase SQL editor. This file does not
-- contain ALTER TABLE ... ADD COLUMN.
--
-- /merchant/pickups calls public.request_merchant_pickup() and
-- public.verify_handover_qr(text). Both are created below, with the
-- pickup_requests tables they write to.
--
-- Where a later migration replaced an object, this file keeps the later body:
--   protect_profile_privileges, apply_exception_log,
--   pickup_merchant_groups          from 0011
--   guard_order_security, orders_readable from 0012
-- If exception_reviewed_at or active_vehicle is not actually present, the
-- matching trigger function and view stay on the 0010 body so existing
-- order and profile writes keep working.

-- ---------------------------------------------------------------------------
-- Tables the later functions need. Skipped when a previous run created them.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.order_exception_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders (id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  exception_reason text NOT NULL,
  call_log_proof_url text,
  whatsapp_proof_url text,
  door_photo_proof_url text,
  attempt_gps_lat double precision,
  attempt_gps_lng double precision,
  attempt_distance_meters integer,
  is_gps_verified boolean NOT NULL DEFAULT false,
  suspicious_attempt_flag boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_exception_logs_reason_known CHECK (
    exception_reason IN (
      'no_answer', 'phone_off', 'postponed', 'refused', 'wrong_address'
    )
  ),
  CONSTRAINT order_exception_logs_call_url CHECK (
    call_log_proof_url IS NULL OR call_log_proof_url ~ '^https://[^[:space:]]{1,2000}$'
  ),
  CONSTRAINT order_exception_logs_whatsapp_url CHECK (
    whatsapp_proof_url IS NULL OR whatsapp_proof_url ~ '^https://[^[:space:]]{1,2000}$'
  ),
  CONSTRAINT order_exception_logs_door_url CHECK (
    door_photo_proof_url IS NULL OR door_photo_proof_url ~ '^https://[^[:space:]]{1,2000}$'
  ),
  CONSTRAINT order_exception_logs_lat CHECK (
    attempt_gps_lat IS NULL OR attempt_gps_lat BETWEEN -90 AND 90
  ),
  CONSTRAINT order_exception_logs_lng CHECK (
    attempt_gps_lng IS NULL OR attempt_gps_lng BETWEEN -180 AND 180
  ),
  CONSTRAINT order_exception_logs_distance CHECK (
    attempt_distance_meters IS NULL OR attempt_distance_meters >= 0
  )
);

CREATE INDEX IF NOT EXISTS order_exception_logs_order_id_idx
  ON public.order_exception_logs (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS order_exception_logs_driver_recent_idx
  ON public.order_exception_logs (driver_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.pickup_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'requested',
  pending_count integer NOT NULL,
  pickup_fee numeric(12, 2) NOT NULL DEFAULT 0,
  handover_qr_token text NOT NULL UNIQUE,
  handover_verified_at timestamptz,
  scanned_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  scanned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pickup_requests_status_known CHECK (
    status IN ('requested', 'handed_over', 'cancelled')
  ),
  CONSTRAINT pickup_requests_count_positive CHECK (pending_count BETWEEN 1 AND 100),
  CONSTRAINT pickup_requests_fee_nonnegative CHECK (pickup_fee >= 0),
  CONSTRAINT pickup_requests_token_shape CHECK (handover_qr_token ~ '^[A-F0-9]{16}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS pickup_requests_one_open_idx
  ON public.pickup_requests (merchant_id)
  WHERE status = 'requested';

CREATE TABLE IF NOT EXISTS public.pickup_request_orders (
  pickup_request_id uuid NOT NULL REFERENCES public.pickup_requests (id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders (id) ON DELETE RESTRICT,
  PRIMARY KEY (pickup_request_id, order_id)
);

CREATE INDEX IF NOT EXISTS pickup_request_orders_order_id_idx
  ON public.pickup_request_orders (order_id);

CREATE TABLE IF NOT EXISTS public.order_history (
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

CREATE INDEX IF NOT EXISTS order_history_order_id_idx
  ON public.order_history (order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.driver_alerts (
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

CREATE INDEX IF NOT EXISTS driver_alerts_open_idx
  ON public.driver_alerts (driver_id, created_at DESC)
  WHERE seen_at IS NULL;

CREATE TABLE IF NOT EXISTS public.support_tickets (
  ticket_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL,
  subject text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_tickets_merchant_id_fkey
    FOREIGN KEY (merchant_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
  CONSTRAINT support_tickets_subject_len CHECK (char_length(btrim(subject)) BETWEEN 1 AND 160),
  CONSTRAINT support_tickets_description_len CHECK (char_length(btrim(description)) BETWEEN 1 AND 4000),
  CONSTRAINT support_tickets_status_known CHECK (
    status IN ('open', 'in_progress', 'resolved')
  )
);

CREATE INDEX IF NOT EXISTS support_tickets_merchant_idx
  ON public.support_tickets (merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_queue_idx
  ON public.support_tickets (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  type text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
  CONSTRAINT notifications_title_len CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  CONSTRAINT notifications_message_len CHECK (char_length(btrim(message)) BETWEEN 1 AND 500),
  CONSTRAINT notifications_type_known CHECK (type IN ('order', 'finance', 'system'))
);

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON public.notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON public.notifications (user_id, created_at DESC)
  WHERE NOT is_read;

COMMENT ON TABLE public.order_exception_logs IS
  'One row per failed delivery attempt. Three proofs, GPS, and the 60-second burst flag.';
COMMENT ON TABLE public.order_history IS
  'Admin corrections and exception decisions. One row per change, written only by security-definer functions.';
COMMENT ON TABLE public.driver_alerts IS
  'Messages an admin decision leaves for the assigned driver. The driver marks them seen.';
COMMENT ON TABLE public.support_tickets IS
  'Merchant support tickets. Merchants insert their own rows as open. Admins update status only.';
COMMENT ON TABLE public.notifications IS
  'In-app notifications. A user reads and marks only their own rows. Inserts come from trusted server paths.';
COMMENT ON COLUMN public.pickup_requests.handover_qr_token IS
  'Digital handover QR payload. The merchant shows it; the pickup driver scans it.';
COMMENT ON COLUMN public.pickup_requests.pickup_fee IS
  'SDG fee for this batch. 0 when pending_count >= the free-pickup threshold.';

-- 0011 loosens proof checks so a screenshot may be an https link or a data URL.
-- A failed check must not roll back the pickup functions, so this block notices
-- and continues.
DO $proof$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'call_log_proof_url'
  ) THEN
    EXECUTE $sql$
      ALTER TABLE public.orders
        DROP CONSTRAINT IF EXISTS orders_call_log_proof_url_shape,
        DROP CONSTRAINT IF EXISTS orders_whatsapp_proof_url_shape,
        DROP CONSTRAINT IF EXISTS orders_door_photo_proof_url_shape
    $sql$;
    EXECUTE $sql$
      ALTER TABLE public.orders
        ADD CONSTRAINT orders_call_log_proof_url_shape CHECK (
          call_log_proof_url IS NULL
          OR (
            char_length(call_log_proof_url) <= 400000
            AND (
              call_log_proof_url ~ '^https://[^[:space:]]{1,2000}$'
              OR call_log_proof_url ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$'
            )
          )
        ),
        ADD CONSTRAINT orders_whatsapp_proof_url_shape CHECK (
          whatsapp_proof_url IS NULL
          OR (
            char_length(whatsapp_proof_url) <= 400000
            AND (
              whatsapp_proof_url ~ '^https://[^[:space:]]{1,2000}$'
              OR whatsapp_proof_url ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$'
            )
          )
        ),
        ADD CONSTRAINT orders_door_photo_proof_url_shape CHECK (
          door_photo_proof_url IS NULL
          OR (
            char_length(door_photo_proof_url) <= 400000
            AND (
              door_photo_proof_url ~ '^https://[^[:space:]]{1,2000}$'
              OR door_photo_proof_url ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$'
            )
          )
        );
    $sql$;
  END IF;

  IF to_regclass('public.order_exception_logs') IS NOT NULL THEN
    EXECUTE $sql$
      ALTER TABLE public.order_exception_logs
        DROP CONSTRAINT IF EXISTS order_exception_logs_call_url,
        DROP CONSTRAINT IF EXISTS order_exception_logs_whatsapp_url,
        DROP CONSTRAINT IF EXISTS order_exception_logs_door_url
    $sql$;
    EXECUTE $sql$
      ALTER TABLE public.order_exception_logs
        ADD CONSTRAINT order_exception_logs_call_url CHECK (
          call_log_proof_url IS NULL
          OR (
            char_length(call_log_proof_url) <= 400000
            AND (
              call_log_proof_url ~ '^https://[^[:space:]]{1,2000}$'
              OR call_log_proof_url ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$'
            )
          )
        ),
        ADD CONSTRAINT order_exception_logs_whatsapp_url CHECK (
          whatsapp_proof_url IS NULL
          OR (
            char_length(whatsapp_proof_url) <= 400000
            AND (
              whatsapp_proof_url ~ '^https://[^[:space:]]{1,2000}$'
              OR whatsapp_proof_url ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$'
            )
          )
        ),
        ADD CONSTRAINT order_exception_logs_door_url CHECK (
          door_photo_proof_url IS NULL
          OR (
            char_length(door_photo_proof_url) <= 400000
            AND (
              door_photo_proof_url ~ '^https://[^[:space:]]{1,2000}$'
              OR door_photo_proof_url ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$'
            )
          )
        );
    $sql$;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'proof URL checks were not updated: %', SQLERRM;
END;
$proof$;

-- ---------------------------------------------------------------------------
-- Functions. Trigger functions that already exist are replaced in place.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.normalize_exception_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  NEW.is_gps_verified :=
    NEW.attempt_distance_meters IS NOT NULL
    AND NEW.attempt_distance_meters <= 200
    AND NEW.attempt_gps_lat IS NOT NULL
    AND NEW.attempt_gps_lng IS NOT NULL;
  NEW.suspicious_attempt_flag := false;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.apply_exception_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_recent integer;
  v_burst boolean;
  v_outside boolean;
  v_flag boolean;
BEGIN
  SELECT count(*)::integer
  INTO v_recent
  FROM public.order_exception_logs
  WHERE driver_id = NEW.driver_id
    AND created_at >= now() - interval '60 seconds';

  v_burst := v_recent >= 2;
  v_outside :=
    NEW.attempt_distance_meters IS NOT NULL
    AND NEW.attempt_distance_meters > 200;
  v_flag := v_burst OR v_outside;

  IF v_burst THEN
    UPDATE public.order_exception_logs
    SET suspicious_attempt_flag = true
    WHERE driver_id = NEW.driver_id
      AND created_at >= now() - interval '60 seconds';
  ELSIF v_outside THEN
    UPDATE public.order_exception_logs
    SET suspicious_attempt_flag = true
    WHERE id = NEW.id;
  END IF;

  PERFORM set_config('app.trusted_order_write', 'on', true);

  UPDATE public.orders
  SET exception_reason = NEW.exception_reason,
      call_log_proof_url = NEW.call_log_proof_url,
      whatsapp_proof_url = NEW.whatsapp_proof_url,
      door_photo_proof_url = NEW.door_photo_proof_url,
      attempt_gps_lat = NEW.attempt_gps_lat,
      attempt_gps_lng = NEW.attempt_gps_lng,
      attempt_distance_meters = NEW.attempt_distance_meters,
      is_gps_verified = NEW.is_gps_verified,
      last_attempt_at = NEW.created_at,
      suspicious_attempt_flag = v_flag,
      failed_attempts = LEAST(failed_attempts + 1, 99)
  WHERE id = NEW.order_id;

  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.order_internal_notes(p_order_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT o.internal_notes
  FROM public.orders AS o
  WHERE o.id = p_order_id
    AND (
      public.is_admin()
      OR (
        o.merchant_id = auth.uid()
        AND public.current_user_role() = 'merchant'
      )
    );
$fn$;

CREATE OR REPLACE FUNCTION public.request_merchant_pickup()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_existing public.pickup_requests;
  v_fee integer;
  v_free integer;
  v_charge numeric(12, 2);
  v_ids uuid[];
  v_token text;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'rapid:unauthorized' USING ERRCODE = 'P0001';
  END IF;
  IF public.current_user_role() IS DISTINCT FROM 'merchant' THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.pickup_requests
  WHERE merchant_id = auth.uid()
    AND status = 'requested'
  FOR UPDATE;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'id', v_existing.id,
      'token', v_existing.handover_qr_token,
      'pending_count', v_existing.pending_count,
      'pickup_fee', v_existing.pickup_fee,
      'verified', v_existing.handover_verified_at IS NOT NULL,
      'reused', true
    );
  END IF;

  SELECT array_agg(locked.id ORDER BY locked.id)
  INTO v_ids
  FROM (
    SELECT o.id
    FROM public.orders AS o
    WHERE o.merchant_id = auth.uid()
      AND o.status = 'pending'
    ORDER BY o.id
    FOR UPDATE
  ) AS locked;

  IF v_ids IS NULL OR cardinality(v_ids) < 1 THEN
    RAISE EXCEPTION 'rapid:empty' USING ERRCODE = 'P0001';
  END IF;
  IF cardinality(v_ids) > 100 THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT pickup_fee_sdg, pickup_fee_free_from
  INTO v_fee, v_free
  FROM public.platform_settings
  WHERE id;

  IF v_free IS NULL OR v_free < 1 THEN
    v_free := 3;
  END IF;
  IF v_fee IS NULL OR v_fee < 0 THEN
    v_fee := 2000;
  END IF;

  IF cardinality(v_ids) >= v_free THEN
    v_charge := 0;
  ELSE
    v_charge := v_fee;
  END IF;

  v_token := upper(encode(gen_random_bytes(8), 'hex'));
  INSERT INTO public.pickup_requests (
    merchant_id, status, pending_count, pickup_fee, handover_qr_token
  )
  VALUES (auth.uid(), 'requested', cardinality(v_ids), v_charge, v_token)
  RETURNING id INTO v_id;

  INSERT INTO public.pickup_request_orders (pickup_request_id, order_id)
  SELECT v_id, unnest(v_ids);

  RETURN jsonb_build_object(
    'id', v_id,
    'token', v_token,
    'pending_count', cardinality(v_ids),
    'pickup_fee', v_charge,
    'verified', false,
    'reused', false
  );
EXCEPTION
  WHEN unique_violation THEN
    SELECT *
    INTO v_existing
    FROM public.pickup_requests
    WHERE merchant_id = auth.uid()
      AND status = 'requested';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'rapid:failed' USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object(
      'id', v_existing.id,
      'token', v_existing.handover_qr_token,
      'pending_count', v_existing.pending_count,
      'pickup_fee', v_existing.pickup_fee,
      'verified', v_existing.handover_verified_at IS NOT NULL,
      'reused', true
    );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.verify_handover_qr(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_token text;
  v_row public.pickup_requests;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'rapid:unauthorized' USING ERRCODE = 'P0001';
  END IF;
  IF public.current_user_role() IS DISTINCT FROM 'merchant' THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;

  v_token := upper(regexp_replace(coalesce(p_token, ''), '[^A-Fa-f0-9]', '', 'g'));
  IF v_token !~ '^[A-F0-9]{16}$' THEN
    RAISE EXCEPTION 'rapid:mismatch' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.pickup_requests
  SET status = 'handed_over',
      handover_verified_at = now()
  WHERE merchant_id = auth.uid()
    AND status = 'requested'
    AND handover_qr_token = v_token
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'rapid:mismatch' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'token', v_row.handover_qr_token,
    'pending_count', v_row.pending_count,
    'pickup_fee', v_row.pickup_fee,
    'verified', true
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.scan_handover_qr(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_token text;
  v_row public.pickup_requests;
  v_name text;
  v_address text;
  v_phone text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'rapid:unauthorized' USING ERRCODE = 'P0001';
  END IF;
  IF public.current_user_role() IS DISTINCT FROM 'driver' THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;

  v_token := upper(regexp_replace(coalesce(p_token, ''), '[^A-Fa-f0-9]', '', 'g'));
  IF v_token !~ '^[A-F0-9]{16}$' THEN
    RAISE EXCEPTION 'rapid:mismatch' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_row
  FROM public.pickup_requests
  WHERE handover_qr_token = v_token
    AND status = 'requested'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'rapid:not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_row.scanned_by IS NOT NULL AND v_row.scanned_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'rapid:reserved' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.pickup_requests
  SET scanned_by = auth.uid(),
      scanned_at = coalesce(scanned_at, now())
  WHERE id = v_row.id;

  SELECT
    coalesce(nullif(btrim(company_name), ''), nullif(btrim(full_name), ''), 'Merchant'),
    (
      SELECT o.pickup_address
      FROM public.pickup_request_orders AS pro
      JOIN public.orders AS o ON o.id = pro.order_id
      WHERE pro.pickup_request_id = v_row.id
      ORDER BY o.created_at
      LIMIT 1
    ),
    nullif(btrim(phone), '')
  INTO v_name, v_address, v_phone
  FROM public.profiles
  WHERE id = v_row.merchant_id;

  RETURN jsonb_build_object(
    'merchant_name', v_name,
    'pickup_address', v_address,
    'phone', v_phone,
    'pending_count', v_row.pending_count,
    'pickup_fee', v_row.pickup_fee
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.complete_partial_delivery(
  p_order_id uuid,
  p_latitude numeric,
  p_longitude numeric,
  p_accuracy_meters numeric,
  p_delivered integer,
  p_returned integer,
  p_collected numeric
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
     ))
     OR p_delivered IS NULL
     OR p_returned IS NULL
     OR p_collected IS NULL
     OR p_delivered < 1
     OR p_returned < 1
     OR p_collected < 0 THEN
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
     OR v_order.status IS DISTINCT FROM 'in_transit'
     OR v_order.pieces_count < 2
     OR p_delivered + p_returned IS DISTINCT FROM v_order.pieces_count
     OR (v_order.payment_type = 'cod' AND p_collected > v_order.product_price)
     OR (v_order.payment_type = 'prepaid' AND p_collected <> 0) THEN
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
      delivered_accuracy_meters = round(p_accuracy_meters, 1),
      is_partial_delivery = true,
      delivered_pieces_count = p_delivered,
      returned_pieces_count = p_returned,
      partial_collected_amount = round(p_collected, 2)
  WHERE id = v_order.id;

  RETURN jsonb_build_object('order_id', v_order.id, 'status', 'delivered');
EXCEPTION
  WHEN check_violation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
END;
$fn$;

CREATE OR REPLACE FUNCTION public.post_delivery_ledger(
  p_order_id uuid,
  p_payment_type public.payment_type
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_order public.orders;
  v_wallet_id uuid;
  v_balance numeric(14, 2);
  v_amount numeric(14, 2);
  v_basis numeric(14, 2);
  v_tx public.transactions;
  v_tx_id uuid := NULL;
  v_type public.transaction_type;
  v_merchant_wallet uuid;
  v_fees numeric(14, 2);
  v_held integer;
  v_cash_add integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'rapid:unauthorized' USING ERRCODE = 'P0001';
  END IF;

  IF p_order_id IS NULL OR p_payment_type IS NULL THEN
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

  IF v_order.driver_id IS NULL
     OR v_order.status IS DISTINCT FROM 'delivered'
     OR v_order.payment_type IS DISTINCT FROM p_payment_type THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  IF v_order.ledger_posted_at IS NOT NULL THEN
    RAISE EXCEPTION 'rapid:conflict' USING ERRCODE = 'P0001';
  END IF;

  IF p_payment_type = 'prepaid' AND v_order.otp_verified_at IS NULL THEN
    RAISE EXCEPTION 'rapid:otp_required' USING ERRCODE = 'P0001';
  END IF;

  IF v_order.is_partial_delivery THEN
    IF v_order.partial_collected_amount IS NULL
       OR v_order.delivered_pieces_count IS NULL
       OR v_order.returned_pieces_count IS NULL
       OR v_order.delivered_pieces_count + v_order.returned_pieces_count
          IS DISTINCT FROM v_order.pieces_count THEN
      RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
    END IF;
    v_basis := v_order.partial_collected_amount;
  ELSE
    v_basis := v_order.product_price;
  END IF;

  v_type := CASE p_payment_type
    WHEN 'cod' THEN 'cod_debt'::public.transaction_type
    ELSE 'prepaid_earning'::public.transaction_type
  END;

  v_amount := public.order_wallet_delta(
    v_order.payment_type,
    CASE
      WHEN v_order.payment_type = 'cod' THEN v_basis
      ELSE v_order.product_price
    END,
    v_order.delivery_fee,
    v_order.platform_commission
  )::numeric(14, 2);

  IF v_amount IS NULL THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, balance
  INTO v_wallet_id, v_balance
  FROM public.wallets
  WHERE driver_id = v_order.driver_id
    AND kind = 'driver'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  IF v_amount <> 0 THEN
    v_tx := public.ledger_post(v_wallet_id, v_order.id, v_type, v_amount);
    v_tx_id := v_tx.id;
    v_balance := v_tx.balance_after;
  END IF;

  INSERT INTO public.wallets (merchant_id, kind, currency)
  VALUES (v_order.merchant_id, 'merchant', 'SDG')
  ON CONFLICT (merchant_id) DO NOTHING;

  SELECT id
  INTO v_merchant_wallet
  FROM public.wallets
  WHERE merchant_id = v_order.merchant_id
    AND kind = 'merchant'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  IF v_order.payment_type = 'cod' AND v_basis > 0 THEN
    PERFORM public.ledger_post(
      v_merchant_wallet,
      v_order.id,
      'settlement',
      v_basis,
      'تحصيل شحنة'
    );
  END IF;

  v_fees := (coalesce(v_order.delivery_fee, 0) + coalesce(v_order.pickup_fee, 0))::numeric(14, 2);
  IF v_fees > 0 THEN
    PERFORM public.ledger_post(
      v_merchant_wallet,
      v_order.id,
      'adjustment',
      -v_fees,
      'خصم رسوم شحن'
    );
  END IF;

  IF v_order.payment_type = 'cod' AND v_basis > 0 THEN
    IF v_basis > 2000000000 THEN
      RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
    END IF;

    v_cash_add := round(v_basis)::integer;
    IF v_cash_add > 0 THEN
      SELECT current_cash_in_hand
      INTO v_held
      FROM public.profiles
      WHERE id = v_order.driver_id
      FOR UPDATE;

      IF NOT FOUND OR v_held IS NULL THEN
        RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
      END IF;

      IF v_held::bigint + v_cash_add::bigint > 2147483647 THEN
        RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
      END IF;

      PERFORM set_config('app.trusted_cash_write', 'on', true);

      UPDATE public.profiles
      SET current_cash_in_hand = v_held + v_cash_add
      WHERE id = v_order.driver_id;
    END IF;
  END IF;

  PERFORM set_config('app.trusted_order_write', 'on', true);

  UPDATE public.orders
  SET ledger_posted_at = now()
  WHERE id = v_order.id;

  RETURN jsonb_build_object(
    'posted', v_amount <> 0,
    'transaction_id', v_tx_id,
    'wallet_id', v_wallet_id,
    'order_id', v_order.id,
    'type', CASE WHEN v_amount = 0 THEN NULL ELSE v_type::text END,
    'amount', v_amount::numeric(14, 2)::text,
    'balance_after', v_balance::numeric(14, 2)::text
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'rapid:conflict' USING ERRCODE = 'P0001';
  WHEN check_violation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
END;
$fn$;

CREATE OR REPLACE FUNCTION public.driver_assigned_merchants()
RETURNS TABLE (
  merchant_id uuid,
  company_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT DISTINCT
    o.merchant_id,
    coalesce(
      nullif(btrim(p.company_name), ''),
      nullif(btrim(p.full_name), ''),
      'متجر'
    ) AS company_name
  FROM public.orders AS o
  JOIN public.profiles AS p ON p.id = o.merchant_id
  WHERE o.driver_id = auth.uid()
    AND auth.uid() IS NOT NULL
    AND public.current_user_role() = 'driver'
    AND o.status IN ('in_transit', 'delivered');
$fn$;

-- Return type gains pickup_fee, so replace cannot be used on the old function.
DROP FUNCTION IF EXISTS public.pickup_merchant_groups();

CREATE FUNCTION public.pickup_merchant_groups()
RETURNS TABLE (
  merchant_id uuid,
  company_name text,
  phone text,
  pickup_address text,
  pickup_gps_url text,
  pending_count bigint,
  pickup_fee numeric
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
    count(*) AS pending_count,
    CASE
      WHEN count(*) >= coalesce(
        (SELECT s.pickup_fee_free_from FROM public.platform_settings AS s LIMIT 1),
        3
      ) THEN 0::numeric
      ELSE coalesce(
        (SELECT s.pickup_fee_sdg FROM public.platform_settings AS s LIMIT 1),
        2000
      )::numeric
    END AS pickup_fee
  FROM public.orders AS o
  JOIN public.profiles AS p ON p.id = o.merchant_id
  WHERE o.status = 'pending'
    AND (o.pickup_driver_id IS NULL OR o.pickup_driver_id = auth.uid())
    AND auth.uid() IS NOT NULL
    AND public.current_user_role() = 'driver'
  GROUP BY o.merchant_id, p.company_name, p.full_name, p.phone
  ORDER BY 2, 1;
$fn$;

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

CREATE OR REPLACE FUNCTION public.guard_support_ticket()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_role public.user_role;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT role
    INTO v_role
    FROM public.profiles
    WHERE id = NEW.merchant_id
      AND is_active;

    IF v_role IS DISTINCT FROM 'merchant' THEN
      RAISE EXCEPTION 'rapid:not_a_merchant' USING ERRCODE = 'P0001';
    END IF;

    IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
      IF NEW.merchant_id IS DISTINCT FROM auth.uid() OR NEW.status IS DISTINCT FROM 'open' THEN
        RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
      END IF;
    END IF;
    NEW.subject := btrim(NEW.subject);
    NEW.description := btrim(NEW.description);
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.ticket_id IS DISTINCT FROM OLD.ticket_id
     OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
     OR NEW.subject IS DISTINCT FROM OLD.subject
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'rapid:immutable' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND auth.uid() IS NOT NULL
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.guard_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.message IS DISTINCT FROM OLD.message
     OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'rapid:immutable' USING ERRCODE = 'P0001';
  END IF;

  IF auth.uid() IS NOT NULL AND NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.notify_merchant_order_outcome()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_title text;
  v_message text;
BEGIN
  IF TG_OP <> 'UPDATE' OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status::text = 'delivered' THEN
    v_title := 'تم تسليم الشحنة';
    v_message := 'تم تسليم الشحنة ' || NEW.tracking_code;
  ELSIF NEW.status::text = 'returned' THEN
    v_title := 'تم إرجاع الشحنة';
    v_message := 'تم إرجاع الشحنة ' || NEW.tracking_code;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, title, message, type)
  VALUES (NEW.merchant_id, v_title, v_message, 'order');

  RETURN NEW;
END;
$fn$;

-- Profile and order guards already have triggers from earlier migrations.
-- Replace the body only. 0011/0012 bodies read columns that a partial run
-- may not have added; fall back to the 0010 body in that case.
DO $profile_guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'active_vehicle'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'driver_locale'
  ) THEN
    EXECUTE $body$
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
          NEW.vehicle_type := NULL;
          NEW.active_vehicle := NULL;
          NEW.emergency_phone := NULL;
          NEW.kyc_status := NULL;
        END IF;

        IF TG_OP = 'UPDATE' AND NOT public.is_admin() THEN
          IF NEW.role IS DISTINCT FROM OLD.role
             OR NEW.employment_type IS DISTINCT FROM OLD.employment_type
             OR NEW.staff_type IS DISTINCT FROM OLD.staff_type
             OR NEW.is_active IS DISTINCT FROM OLD.is_active
             OR NEW.hub_zone IS DISTINCT FROM OLD.hub_zone
             OR NEW.country_code IS DISTINCT FROM OLD.country_code
             OR NEW.vehicle_type IS DISTINCT FROM OLD.vehicle_type
             OR NEW.emergency_phone IS DISTINCT FROM OLD.emergency_phone
             OR NEW.kyc_status IS DISTINCT FROM OLD.kyc_status
             OR NEW.max_cash_limit IS DISTINCT FROM OLD.max_cash_limit
             OR NEW.current_cash_in_hand IS DISTINCT FROM OLD.current_cash_in_hand
             OR NEW.commission_per_delivery IS DISTINCT FROM OLD.commission_per_delivery
             OR NEW.id IS DISTINCT FROM OLD.id THEN
            RAISE EXCEPTION 'only an admin can change role, staff type, zone, KYC, cash ceiling, commission, or active status';
          END IF;

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
    $body$;
  ELSIF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'commission_per_delivery'
  ) THEN
    RAISE NOTICE 'profiles.active_vehicle is missing; installed the 0010 profile guard';
    EXECUTE $body$
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
          NEW.vehicle_type := NULL;
          NEW.emergency_phone := NULL;
          NEW.kyc_status := NULL;
        END IF;

        IF TG_OP = 'UPDATE' AND NOT public.is_admin() THEN
          IF NEW.role IS DISTINCT FROM OLD.role
             OR NEW.employment_type IS DISTINCT FROM OLD.employment_type
             OR NEW.staff_type IS DISTINCT FROM OLD.staff_type
             OR NEW.is_active IS DISTINCT FROM OLD.is_active
             OR NEW.hub_zone IS DISTINCT FROM OLD.hub_zone
             OR NEW.country_code IS DISTINCT FROM OLD.country_code
             OR NEW.vehicle_type IS DISTINCT FROM OLD.vehicle_type
             OR NEW.emergency_phone IS DISTINCT FROM OLD.emergency_phone
             OR NEW.kyc_status IS DISTINCT FROM OLD.kyc_status
             OR NEW.max_cash_limit IS DISTINCT FROM OLD.max_cash_limit
             OR NEW.current_cash_in_hand IS DISTINCT FROM OLD.current_cash_in_hand
             OR NEW.commission_per_delivery IS DISTINCT FROM OLD.commission_per_delivery
             OR NEW.id IS DISTINCT FROM OLD.id THEN
            RAISE EXCEPTION 'only an admin can change role, staff type, zone, KYC, cash ceiling, commission, or active status';
          END IF;

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
    $body$;
  ELSE
    RAISE NOTICE 'profiles.commission_per_delivery is missing; left the existing profile guard in place';
  END IF;
END;
$profile_guard$;

DO $order_guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'exception_reviewed_at'
  ) THEN
    EXECUTE $body$
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
    $body$;
  ELSIF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'building_name'
  ) THEN
    RAISE NOTICE 'orders.exception_reviewed_at is missing; installed the 0010 order guard';
    EXECUTE $body$
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
    $body$;
  ELSE
    RAISE NOTICE 'orders.building_name is missing; left the existing order guard in place';
  END IF;
END;
$order_guard$;

-- ---------------------------------------------------------------------------
-- Triggers. Drop first so a second run does not raise "already exists".
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS order_exception_logs_normalize ON public.order_exception_logs;
CREATE TRIGGER order_exception_logs_normalize
  BEFORE INSERT ON public.order_exception_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_exception_log();

DROP TRIGGER IF EXISTS order_exception_logs_apply ON public.order_exception_logs;
CREATE TRIGGER order_exception_logs_apply
  AFTER INSERT ON public.order_exception_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_exception_log();

DROP TRIGGER IF EXISTS support_tickets_guard ON public.support_tickets;
CREATE TRIGGER support_tickets_guard
  BEFORE INSERT OR UPDATE ON public.support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_support_ticket();

DROP TRIGGER IF EXISTS notifications_guard ON public.notifications;
CREATE TRIGGER notifications_guard
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_notification();

DROP TRIGGER IF EXISTS orders_notify_merchant_outcome ON public.orders;
CREATE TRIGGER orders_notify_merchant_outcome
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_merchant_order_outcome();

-- ---------------------------------------------------------------------------
-- Policies. Drop first so a second run does not raise "already exists".
-- ---------------------------------------------------------------------------

ALTER TABLE public.order_exception_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pickup_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pickup_request_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS order_exception_logs_admin_all ON public.order_exception_logs;
CREATE POLICY order_exception_logs_admin_all
  ON public.order_exception_logs
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS order_exception_logs_merchant_select ON public.order_exception_logs;
CREATE POLICY order_exception_logs_merchant_select
  ON public.order_exception_logs
  FOR SELECT
  TO authenticated
  USING (
    public.current_user_role() = 'merchant'
    AND EXISTS (
      SELECT 1
      FROM public.orders AS o
      WHERE o.id = order_id
        AND o.merchant_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS order_exception_logs_driver_select ON public.order_exception_logs;
CREATE POLICY order_exception_logs_driver_select
  ON public.order_exception_logs
  FOR SELECT
  TO authenticated
  USING (
    driver_id = auth.uid()
    AND public.current_user_role() = 'driver'
  );

DROP POLICY IF EXISTS order_exception_logs_driver_insert ON public.order_exception_logs;
CREATE POLICY order_exception_logs_driver_insert
  ON public.order_exception_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    driver_id = auth.uid()
    AND public.current_user_role() = 'driver'
    AND EXISTS (
      SELECT 1
      FROM public.orders AS o
      WHERE o.id = order_id
        AND o.driver_id = auth.uid()
        AND o.status = 'in_transit'
    )
  );

DROP POLICY IF EXISTS pickup_requests_admin_select ON public.pickup_requests;
CREATE POLICY pickup_requests_admin_select
  ON public.pickup_requests
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS pickup_requests_merchant_select ON public.pickup_requests;
CREATE POLICY pickup_requests_merchant_select
  ON public.pickup_requests
  FOR SELECT
  TO authenticated
  USING (
    merchant_id = auth.uid()
    AND public.current_user_role() = 'merchant'
  );

DROP POLICY IF EXISTS pickup_request_orders_admin_select ON public.pickup_request_orders;
CREATE POLICY pickup_request_orders_admin_select
  ON public.pickup_request_orders
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS pickup_request_orders_merchant_select ON public.pickup_request_orders;
CREATE POLICY pickup_request_orders_merchant_select
  ON public.pickup_request_orders
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.pickup_requests AS pr
      WHERE pr.id = pickup_request_id
        AND pr.merchant_id = auth.uid()
        AND public.current_user_role() = 'merchant'
    )
  );

DROP POLICY IF EXISTS order_history_admin_select ON public.order_history;
CREATE POLICY order_history_admin_select
  ON public.order_history
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS driver_alerts_select ON public.driver_alerts;
CREATE POLICY driver_alerts_select
  ON public.driver_alerts
  FOR SELECT
  TO authenticated
  USING (driver_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS support_tickets_merchant_select ON public.support_tickets;
CREATE POLICY support_tickets_merchant_select
  ON public.support_tickets
  FOR SELECT
  TO authenticated
  USING (merchant_id = auth.uid());

DROP POLICY IF EXISTS support_tickets_admin_select ON public.support_tickets;
CREATE POLICY support_tickets_admin_select
  ON public.support_tickets
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS support_tickets_merchant_insert ON public.support_tickets;
CREATE POLICY support_tickets_merchant_insert
  ON public.support_tickets
  FOR INSERT
  TO authenticated
  WITH CHECK (
    merchant_id = auth.uid()
    AND status = 'open'
    AND EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role = 'merchant'
        AND is_active
    )
  );

DROP POLICY IF EXISTS support_tickets_admin_update ON public.support_tickets;
CREATE POLICY support_tickets_admin_update
  ON public.support_tickets
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
CREATE POLICY notifications_select_own
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Grants. Column grants skip a column that a partial run never added.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.normalize_exception_log() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_exception_log() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_profile_privileges() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_order_security() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_support_ticket() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_notification() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_merchant_order_outcome() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.order_internal_notes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_internal_notes(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.request_merchant_pickup() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.verify_handover_qr(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.scan_handover_qr(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_merchant_pickup() TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_handover_qr(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.scan_handover_qr(text) TO authenticated;

REVOKE ALL ON FUNCTION public.complete_partial_delivery(uuid, numeric, numeric, numeric, integer, integer, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.driver_assigned_merchants() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pickup_merchant_groups() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_partial_delivery(uuid, numeric, numeric, numeric, integer, integer, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_assigned_merchants() TO authenticated;
GRANT EXECUTE ON FUNCTION public.pickup_merchant_groups() TO authenticated;

REVOKE ALL ON FUNCTION public.admin_review_exception(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_edit_order_details(text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.acknowledge_driver_alert(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_exception(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_edit_order_details(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acknowledge_driver_alert(uuid) TO authenticated;

REVOKE ALL ON TABLE public.order_exception_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.order_exception_logs TO authenticated;

REVOKE ALL ON TABLE public.pickup_requests FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.pickup_request_orders FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.pickup_requests TO authenticated;
GRANT SELECT ON TABLE public.pickup_request_orders TO authenticated;

REVOKE ALL ON TABLE public.order_history FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.driver_alerts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.order_history TO authenticated;
GRANT SELECT ON TABLE public.driver_alerts TO authenticated;

REVOKE ALL ON TABLE public.support_tickets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.support_tickets TO authenticated;
GRANT UPDATE (status, updated_at) ON TABLE public.support_tickets TO authenticated;

REVOKE ALL ON TABLE public.notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.notifications TO authenticated;
GRANT UPDATE (is_read) ON TABLE public.notifications TO authenticated;

DO $column_grants$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'building_name'
  ) THEN
    EXECUTE $g$
      GRANT SELECT (
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
        partial_collected_amount
      ) ON TABLE public.orders TO authenticated
    $g$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'exception_reviewed_at'
  ) THEN
    EXECUTE 'GRANT SELECT (exception_reviewed_at) ON TABLE public.orders TO authenticated';
  ELSE
    RAISE NOTICE 'orders.exception_reviewed_at is missing; column grant skipped';
  END IF;
END;
$column_grants$;

-- Replace cannot insert a column in the middle of an existing view, and it
-- fails outright if exception_reviewed_at was never added. Append only when
-- that column is present; otherwise append the 0010 columns.
DO $readable$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'exception_reviewed_at'
  ) THEN
    EXECUTE $view$
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
      FROM public.orders
    $view$;
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'building_name'
  ) THEN
    RAISE NOTICE 'orders.exception_reviewed_at is missing; orders_readable stops at the 0010 columns';
    EXECUTE $view$
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
        partial_collected_amount
      FROM public.orders
    $view$;
  ELSE
    RAISE NOTICE 'orders.building_name is missing; left orders_readable unchanged';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'orders_readable was not replaced: %', SQLERRM;
END;
$readable$;

REVOKE ALL ON TABLE public.orders_readable FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.orders_readable TO authenticated;

DO $confirm$
BEGIN
  IF to_regprocedure('public.request_merchant_pickup()') IS NULL
     OR to_regprocedure('public.verify_handover_qr(text)') IS NULL
     OR to_regclass('public.pickup_requests') IS NULL THEN
    RAISE EXCEPTION 'pickup repair did not create request_merchant_pickup, verify_handover_qr, or pickup_requests';
  END IF;
END;
$confirm$;

NOTIFY pgrst, 'reload schema';
