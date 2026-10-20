-- Phase 13.1 — order address and parcel details, fortified delivery
-- attempts, driver preferences, and merchant pickup handover.
--
-- 0009 is the Phase 12 financial engine, so this file is 0010.
--
-- A failed attempt is an event, not a new order_status. The parcel stays on
-- its current status (usually in_transit). exception_reason, failed_attempts,
-- and order_exception_logs are the record. Adding an `exception` enum value
-- would force every status machine to grow a state that is really an event.
--
-- internal_notes are merchant/admin only and are never printed on the AWB.
-- The column is not granted to authenticated; orders_readable reads it
-- through order_internal_notes(), which returns null for everyone else.
--
-- Pickup drivers still have no SELECT on orders. Handover lookup is a
-- security-definer function that returns merchant pickup fields only.

-- ---------------------------------------------------------------------------
-- Orders: address, parcel, attempt snapshot, partial delivery
-- ---------------------------------------------------------------------------

ALTER TABLE public.orders
  ADD COLUMN building_name text,
  ADD COLUMN floor_number text,
  ADD COLUMN apartment_number text,
  ADD COLUMN landmark text,
  ADD COLUMN is_work_address boolean NOT NULL DEFAULT false,
  ADD COLUMN parcel_size text NOT NULL DEFAULT 'small',
  ADD COLUMN pieces_count integer NOT NULL DEFAULT 1,
  ADD COLUMN product_description text,
  ADD COLUMN product_image_url text,
  ADD COLUMN allow_opening boolean NOT NULL DEFAULT false,
  ADD COLUMN delivery_notes text,
  ADD COLUMN internal_notes text,
  ADD COLUMN exception_reason text,
  ADD COLUMN call_log_proof_url text,
  ADD COLUMN whatsapp_proof_url text,
  ADD COLUMN door_photo_proof_url text,
  ADD COLUMN attempt_gps_lat double precision,
  ADD COLUMN attempt_gps_lng double precision,
  ADD COLUMN attempt_distance_meters integer,
  ADD COLUMN is_gps_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN last_attempt_at timestamptz,
  ADD COLUMN suspicious_attempt_flag boolean NOT NULL DEFAULT false,
  ADD COLUMN failed_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN is_partial_delivery boolean NOT NULL DEFAULT false,
  ADD COLUMN delivered_pieces_count integer,
  ADD COLUMN returned_pieces_count integer,
  ADD COLUMN partial_collected_amount numeric(12, 2);

ALTER TABLE public.orders
  ADD CONSTRAINT orders_building_name_len CHECK (
    building_name IS NULL OR char_length(building_name) BETWEEN 1 AND 80
  ),
  ADD CONSTRAINT orders_floor_number_len CHECK (
    floor_number IS NULL OR char_length(floor_number) BETWEEN 1 AND 20
  ),
  ADD CONSTRAINT orders_apartment_number_len CHECK (
    apartment_number IS NULL OR char_length(apartment_number) BETWEEN 1 AND 20
  ),
  ADD CONSTRAINT orders_landmark_len CHECK (
    landmark IS NULL OR char_length(landmark) BETWEEN 1 AND 120
  ),
  ADD CONSTRAINT orders_parcel_size_known CHECK (
    parcel_size IN ('small', 'medium', 'large', 'heavy', 'bulky')
  ),
  ADD CONSTRAINT orders_pieces_count_range CHECK (pieces_count BETWEEN 1 AND 99),
  ADD CONSTRAINT orders_product_description_len CHECK (
    product_description IS NULL OR char_length(product_description) BETWEEN 1 AND 240
  ),
  ADD CONSTRAINT orders_product_image_url_shape CHECK (
    product_image_url IS NULL
    OR (
      char_length(product_image_url) <= 400000
      AND (
        product_image_url ~ '^https://[^[:space:]]{1,2000}$'
        OR product_image_url ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$'
      )
    )
  ),
  ADD CONSTRAINT orders_delivery_notes_len CHECK (
    delivery_notes IS NULL OR char_length(delivery_notes) BETWEEN 1 AND 240
  ),
  ADD CONSTRAINT orders_internal_notes_len CHECK (
    internal_notes IS NULL OR char_length(internal_notes) BETWEEN 1 AND 240
  ),
  ADD CONSTRAINT orders_exception_reason_known CHECK (
    exception_reason IS NULL
    OR exception_reason IN (
      'no_answer', 'phone_off', 'postponed', 'refused', 'wrong_address'
    )
  ),
  ADD CONSTRAINT orders_call_log_proof_url_shape CHECK (
    call_log_proof_url IS NULL OR call_log_proof_url ~ '^https://[^[:space:]]{1,2000}$'
  ),
  ADD CONSTRAINT orders_whatsapp_proof_url_shape CHECK (
    whatsapp_proof_url IS NULL OR whatsapp_proof_url ~ '^https://[^[:space:]]{1,2000}$'
  ),
  ADD CONSTRAINT orders_door_photo_proof_url_shape CHECK (
    door_photo_proof_url IS NULL OR door_photo_proof_url ~ '^https://[^[:space:]]{1,2000}$'
  ),
  ADD CONSTRAINT orders_attempt_gps_lat_range CHECK (
    attempt_gps_lat IS NULL OR attempt_gps_lat BETWEEN -90 AND 90
  ),
  ADD CONSTRAINT orders_attempt_gps_lng_range CHECK (
    attempt_gps_lng IS NULL OR attempt_gps_lng BETWEEN -180 AND 180
  ),
  ADD CONSTRAINT orders_attempt_distance_nonnegative CHECK (
    attempt_distance_meters IS NULL OR attempt_distance_meters >= 0
  ),
  ADD CONSTRAINT orders_failed_attempts_range CHECK (failed_attempts BETWEEN 0 AND 99),
  ADD CONSTRAINT orders_delivered_pieces_nonnegative CHECK (
    delivered_pieces_count IS NULL OR delivered_pieces_count >= 0
  ),
  ADD CONSTRAINT orders_returned_pieces_nonnegative CHECK (
    returned_pieces_count IS NULL OR returned_pieces_count >= 0
  ),
  ADD CONSTRAINT orders_partial_collected_nonnegative CHECK (
    partial_collected_amount IS NULL OR partial_collected_amount >= 0
  );

COMMENT ON COLUMN public.orders.delivery_notes IS
  'Printed on the AWB in the notes row.';
COMMENT ON COLUMN public.orders.internal_notes IS
  'Private to the merchant and admins. Never printed on the AWB and not granted to other roles.';
COMMENT ON COLUMN public.orders.exception_reason IS
  'Latest failed attempt: no_answer, phone_off, postponed, refused, or wrong_address.';
COMMENT ON COLUMN public.orders.call_log_proof_url IS
  'Screenshot of the driver call log. https only.';
COMMENT ON COLUMN public.orders.whatsapp_proof_url IS
  'Screenshot of the driver WhatsApp chat with the customer. https only.';
COMMENT ON COLUMN public.orders.door_photo_proof_url IS
  'Live photo of the closed door or premises. https only.';
COMMENT ON COLUMN public.orders.is_gps_verified IS
  'True when the logged attempt was within 200 meters of the dropoff.';
COMMENT ON COLUMN public.orders.suspicious_attempt_flag IS
  'True when this driver logged 3 or more exceptions within 60 seconds.';
COMMENT ON COLUMN public.orders.partial_collected_amount IS
  'Cash collected when only some pieces were delivered.';

-- ---------------------------------------------------------------------------
-- Attempt history. The latest row is copied onto orders by trigger.
-- ---------------------------------------------------------------------------

CREATE TABLE public.order_exception_logs (
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

CREATE INDEX order_exception_logs_order_id_idx
  ON public.order_exception_logs (order_id, created_at DESC);
CREATE INDEX order_exception_logs_driver_recent_idx
  ON public.order_exception_logs (driver_id, created_at DESC);

COMMENT ON TABLE public.order_exception_logs IS
  'One row per failed delivery attempt. Three proofs, GPS, and the 60-second burst flag.';

-- GPS is verified only when a distance was supplied and it is within 200m.
-- The client-supplied boolean is ignored.
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

CREATE TRIGGER order_exception_logs_normalize
  BEFORE INSERT ON public.order_exception_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_exception_log();

-- Copies the attempt onto the order and raises the burst flag when this
-- driver has logged 3 or more exceptions in the last 60 seconds.
CREATE OR REPLACE FUNCTION public.apply_exception_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_recent integer;
  v_burst boolean;
BEGIN
  SELECT count(*)::integer
  INTO v_recent
  FROM public.order_exception_logs
  WHERE driver_id = NEW.driver_id
    AND created_at >= now() - interval '60 seconds';

  v_burst := v_recent >= 3;

  IF v_burst THEN
    UPDATE public.order_exception_logs
    SET suspicious_attempt_flag = true
    WHERE driver_id = NEW.driver_id
      AND created_at >= now() - interval '60 seconds';
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
      suspicious_attempt_flag = v_burst,
      failed_attempts = LEAST(failed_attempts + 1, 99)
  WHERE id = NEW.order_id;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER order_exception_logs_apply
  AFTER INSERT ON public.order_exception_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_exception_log();

ALTER TABLE public.order_exception_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY order_exception_logs_admin_all
  ON public.order_exception_logs
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

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

CREATE POLICY order_exception_logs_driver_select
  ON public.order_exception_logs
  FOR SELECT
  TO authenticated
  USING (
    driver_id = auth.uid()
    AND public.current_user_role() = 'driver'
  );

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

GRANT SELECT, INSERT ON TABLE public.order_exception_logs TO authenticated;

-- ---------------------------------------------------------------------------
-- Driver preferences and the per-delivery earning rate
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN preferred_nav_app text NOT NULL DEFAULT 'google_maps',
  ADD COLUMN driver_dark_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN high_alert_sound boolean NOT NULL DEFAULT true,
  ADD COLUMN commission_per_delivery numeric(12, 2) NOT NULL DEFAULT 1000;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_preferred_nav_app_known CHECK (
    preferred_nav_app IN ('google_maps', 'waze', 'apple_maps')
  ),
  ADD CONSTRAINT profiles_commission_per_delivery_range CHECK (
    commission_per_delivery >= 0 AND commission_per_delivery <= 1000000
  );

COMMENT ON COLUMN public.profiles.preferred_nav_app IS
  'Driver navigation app: google_maps, waze, or apple_maps.';
COMMENT ON COLUMN public.profiles.driver_dark_mode IS
  'Driver app dark mode preference.';
COMMENT ON COLUMN public.profiles.high_alert_sound IS
  'Driver app plays a loud alert for a new assignment.';
COMMENT ON COLUMN public.profiles.commission_per_delivery IS
  'SDG earning rate per delivered shipment. Admin-writable only. Default 1000. Not posted to the wallet by this migration.';

-- Same body as 0008, plus commission_per_delivery (admin only). Drivers may
-- still change their own nav app, dark mode, and alert sound.
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

-- ---------------------------------------------------------------------------
-- Order write guard. Merchants may set parcel fields on a pending order.
-- Attempt proofs and partial delivery are admin or trusted-function only.
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

-- ---------------------------------------------------------------------------
-- Column grants and the readable view.
-- internal_notes is intentionally absent from the grant list.
-- ---------------------------------------------------------------------------

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

REVOKE ALL ON FUNCTION public.order_internal_notes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_internal_notes(uuid) TO authenticated;

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
) ON TABLE public.orders TO authenticated;

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
FROM public.orders;

REVOKE ALL ON TABLE public.orders_readable FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.orders_readable TO authenticated;

-- ---------------------------------------------------------------------------
-- Pickup requests. One open request per merchant. The handover token is the
-- QR the merchant shows and the pickup driver scans. It carries no customer
-- fields. The batch fee is 0 when this request holds at least
-- platform_settings.pickup_fee_free_from parcels (default 3).
-- ---------------------------------------------------------------------------

CREATE TABLE public.pickup_requests (
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

CREATE UNIQUE INDEX pickup_requests_one_open_idx
  ON public.pickup_requests (merchant_id)
  WHERE status = 'requested';

CREATE TABLE public.pickup_request_orders (
  pickup_request_id uuid NOT NULL REFERENCES public.pickup_requests (id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders (id) ON DELETE RESTRICT,
  PRIMARY KEY (pickup_request_id, order_id)
);

CREATE INDEX pickup_request_orders_order_id_idx
  ON public.pickup_request_orders (order_id);

COMMENT ON COLUMN public.pickup_requests.handover_qr_token IS
  'Digital handover QR payload. The merchant shows it; the pickup driver scans it.';
COMMENT ON COLUMN public.pickup_requests.pickup_fee IS
  'SDG fee for this batch. 0 when pending_count >= the free-pickup threshold.';

ALTER TABLE public.pickup_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pickup_request_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY pickup_requests_admin_select
  ON public.pickup_requests
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY pickup_requests_merchant_select
  ON public.pickup_requests
  FOR SELECT
  TO authenticated
  USING (
    merchant_id = auth.uid()
    AND public.current_user_role() = 'merchant'
  );

CREATE POLICY pickup_request_orders_admin_select
  ON public.pickup_request_orders
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

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

GRANT SELECT ON TABLE public.pickup_requests TO authenticated;
GRANT SELECT ON TABLE public.pickup_request_orders TO authenticated;

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

  -- Lock in id order so two overlapping requests cannot deadlock.
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

-- Merchant confirms the handover QR. The order status stays pending until
-- the pickup driver runs confirm_batch_pickup.
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

-- Pickup driver scans the merchant QR. Returns merchant pickup fields only.
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

REVOKE ALL ON FUNCTION public.normalize_exception_log() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_exception_log() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_profile_privileges() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_order_security() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_merchant_pickup() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.verify_handover_qr(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.scan_handover_qr(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.request_merchant_pickup() TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_handover_qr(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.scan_handover_qr(text) TO authenticated;
