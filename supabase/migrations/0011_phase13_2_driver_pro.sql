-- Phase 13.2 — Pro driver PWA.
--
-- 0010 already stores nav app, dark mode, alert sound, commission, attempt
-- proofs, and partial-delivery columns. This migration:
--   * lets proof screenshots be https links or inline image data URLs
--   * stores the driver's locale and the vehicle they are using right now
--   * flags an attempt when this driver logs another within 60 seconds,
--     or when the GPS fix is farther than 200 m from the dropoff
--   * posts a partial COD from the collected amount, not the full price
--   * returns the pickup fee on each merchant group so the handover receipt
--     can show it

-- ---------------------------------------------------------------------------
-- Proof images. Merchants open these on the order page, so a data URL has
-- to pass the same shape as product_image_url (png, jpeg, or webp).
-- ---------------------------------------------------------------------------

ALTER TABLE public.orders
  DROP CONSTRAINT orders_call_log_proof_url_shape,
  DROP CONSTRAINT orders_whatsapp_proof_url_shape,
  DROP CONSTRAINT orders_door_photo_proof_url_shape;

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

ALTER TABLE public.order_exception_logs
  DROP CONSTRAINT order_exception_logs_call_url,
  DROP CONSTRAINT order_exception_logs_whatsapp_url,
  DROP CONSTRAINT order_exception_logs_door_url;

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

-- ---------------------------------------------------------------------------
-- Locale and the vehicle the driver is using on this shift.
-- vehicle_type stays the KYC record and remains admin-only.
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN active_vehicle text,
  ADD COLUMN driver_locale text NOT NULL DEFAULT 'ar';

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_active_vehicle_known CHECK (
    active_vehicle IS NULL
    OR active_vehicle IN ('موتوسيكل', 'سيارة فان', 'سيارة ملاكي')
  ),
  ADD CONSTRAINT profiles_active_vehicle_drivers_only CHECK (
    active_vehicle IS NULL OR role = 'driver'
  ),
  ADD CONSTRAINT profiles_driver_locale_known CHECK (
    driver_locale IN ('ar', 'en')
  );

COMMENT ON COLUMN public.profiles.active_vehicle IS
  'Vehicle the driver is using now. The hub reads this for capacity. Distinct from KYC vehicle_type.';
COMMENT ON COLUMN public.profiles.driver_locale IS
  'Driver app language: ar (default, RTL) or en.';

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

-- ---------------------------------------------------------------------------
-- Attempt flag. "Multiple" means another exception from this driver inside
-- 60 seconds (two or more, including this row). A fix farther than 200 m
-- is outside the dropoff fence and is flagged on its own.
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Partial handoff. Pieces and the collected cash are written in the same
-- update that marks the order delivered, so a failed call leaves no partial
-- row behind. The ledger function below reads those columns.
-- ---------------------------------------------------------------------------

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

-- Same body as 0009, except a partial COD uses partial_collected_amount for
-- the driver debit, the merchant credit, and the cash the driver is holding.
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

-- ---------------------------------------------------------------------------
-- Merchant names for parcels this driver is carrying. Pickup drivers still
-- cannot read orders, and this function returns no customer fields.
-- ---------------------------------------------------------------------------

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

-- Return type gains pickup_fee, so the previous function has to be replaced.
DROP FUNCTION public.pickup_merchant_groups();

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

REVOKE ALL ON FUNCTION public.protect_profile_privileges() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_exception_log() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_partial_delivery(uuid, numeric, numeric, numeric, integer, integer, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.driver_assigned_merchants() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pickup_merchant_groups() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.complete_partial_delivery(uuid, numeric, numeric, numeric, integer, integer, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_assigned_merchants() TO authenticated;
GRANT EXECUTE ON FUNCTION public.pickup_merchant_groups() TO authenticated;
