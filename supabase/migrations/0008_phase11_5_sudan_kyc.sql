-- Phase 11.5 — Sudan-first launch: country, driver KYC, cash ceiling, pricing.
--
-- Egypt is postponed. New rows default to Sudan (SD). Currency on wallets
-- moves from EGP to SDG. Driver profiles gain KYC and a cash-custody ceiling.
-- Orders gain a pickup fee. delivery_fee already exists (0001) and stays the
-- column that stores the zone shipping price.
--
-- Pickup rule, enforced on insert: if the merchant already has fewer than
-- platform_settings.pickup_fee_free_from non-cancelled shipments (default 3),
-- pickup_fee is the configured amount. At or above that count it is 0.
-- A delivery driver whose current_cash_in_hand exceeds max_cash_limit cannot
-- be assigned a new COD shipment.

-- ---------------------------------------------------------------------------
-- Enums and profile / order columns
-- ---------------------------------------------------------------------------

CREATE TYPE public.kyc_status AS ENUM (
  'pending',
  'verified',
  'rejected'
);

ALTER TABLE public.profiles
  ADD COLUMN country_code text NOT NULL DEFAULT 'SD',
  ADD COLUMN vehicle_type text,
  ADD COLUMN emergency_phone text,
  ADD COLUMN kyc_status public.kyc_status,
  ADD COLUMN max_cash_limit integer NOT NULL DEFAULT 300000,
  ADD COLUMN current_cash_in_hand integer NOT NULL DEFAULT 0;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_country_code_shape CHECK (country_code ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT profiles_vehicle_type_check CHECK (
    vehicle_type IS NULL
    OR vehicle_type IN ('موتوسيكل', 'سيارة فان', 'سيارة ملاكي')
  ),
  ADD CONSTRAINT profiles_vehicle_type_drivers_only CHECK (
    vehicle_type IS NULL OR role = 'driver'
  ),
  ADD CONSTRAINT profiles_emergency_phone_drivers_only CHECK (
    emergency_phone IS NULL OR role = 'driver'
  ),
  ADD CONSTRAINT profiles_emergency_phone_shape CHECK (
    emergency_phone IS NULL
    OR emergency_phone ~ '^(\+249|0)[19][0-9]{8}$'
  ),
  ADD CONSTRAINT profiles_kyc_drivers_only CHECK (
    kyc_status IS NULL OR role = 'driver'
  ),
  ADD CONSTRAINT profiles_cash_custody_nonnegative CHECK (
    max_cash_limit >= 0
    AND max_cash_limit <= 100000000
    AND current_cash_in_hand >= 0
  );

COMMENT ON COLUMN public.profiles.country_code IS
  'ISO country. Sudan (SD) is the launch default.';
COMMENT ON COLUMN public.profiles.vehicle_type IS
  'Driver vehicle: موتوسيكل, سيارة فان, or سيارة ملاكي. Admin-writable only.';
COMMENT ON COLUMN public.profiles.emergency_phone IS
  'Sudan emergency contact (+249 or 09/01). Admin-writable only.';
COMMENT ON COLUMN public.profiles.kyc_status IS
  'pending, verified, or rejected. Admin-writable only.';
COMMENT ON COLUMN public.profiles.max_cash_limit IS
  'Most SDG cash this driver may hold. Above it, new COD assignments are refused.';
COMMENT ON COLUMN public.profiles.current_cash_in_hand IS
  'SDG cash the driver is holding. Positive means cash in custody, not a wallet credit.';

ALTER TABLE public.orders
  ADD COLUMN country_code text NOT NULL DEFAULT 'SD',
  ADD COLUMN pickup_fee numeric(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_country_code_shape CHECK (country_code ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT orders_pickup_fee_nonnegative CHECK (pickup_fee >= 0);

COMMENT ON COLUMN public.orders.country_code IS
  'ISO country of the shipment. Sudan (SD) is the launch default.';
COMMENT ON COLUMN public.orders.pickup_fee IS
  'Dynamic pickup fee in SDG. 0 once the merchant reaches the free-pickup threshold. delivery_fee (0001) stores the zone shipping price.';

ALTER TABLE public.wallets
  ALTER COLUMN currency SET DEFAULT 'SDG';

UPDATE public.wallets
SET currency = 'SDG'
WHERE currency = 'EGP';

GRANT USAGE ON TYPE public.kyc_status TO authenticated;

-- Column-level SELECT (0003): a new orders column is invisible until granted.
-- The security-invoker orders_readable view needs these grants or the whole
-- view errors for authenticated clients.
GRANT SELECT (country_code, pickup_fee) ON TABLE public.orders TO authenticated;

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
  pickup_fee
FROM public.orders;

REVOKE ALL ON TABLE public.orders_readable FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.orders_readable TO authenticated;

-- ---------------------------------------------------------------------------
-- Zone matrix and the singleton pricing / fleet row
-- ---------------------------------------------------------------------------

CREATE TABLE public.shipping_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_name text NOT NULL,
  city_name text NOT NULL DEFAULT '',
  fee_sdg integer NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  CONSTRAINT shipping_zones_state_shape CHECK (
    char_length(btrim(state_name)) BETWEEN 2 AND 80
  ),
  CONSTRAINT shipping_zones_city_shape CHECK (char_length(city_name) <= 80),
  CONSTRAINT shipping_zones_fee_nonnegative CHECK (fee_sdg >= 0 AND fee_sdg <= 10000000),
  CONSTRAINT shipping_zones_place_key UNIQUE (state_name, city_name)
);

CREATE TABLE public.platform_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  currency text NOT NULL DEFAULT 'SDG',
  country_code text NOT NULL DEFAULT 'SD',
  pickup_fee_sdg integer NOT NULL DEFAULT 2000,
  pickup_fee_free_from integer NOT NULL DEFAULT 3,
  default_max_cash_sdg integer NOT NULL DEFAULT 300000,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_settings_currency CHECK (currency = 'SDG'),
  CONSTRAINT platform_settings_country CHECK (country_code = 'SD'),
  CONSTRAINT platform_settings_pickup_fee CHECK (
    pickup_fee_sdg >= 0 AND pickup_fee_sdg <= 10000000
  ),
  CONSTRAINT platform_settings_free_from CHECK (
    pickup_fee_free_from BETWEEN 1 AND 100
  ),
  CONSTRAINT platform_settings_max_cash CHECK (
    default_max_cash_sdg >= 0 AND default_max_cash_sdg <= 100000000
  )
);

COMMENT ON TABLE public.shipping_zones IS
  'Admin zone matrix. fee_sdg is the shipping price for that state and city.';
COMMENT ON TABLE public.platform_settings IS
  'Singleton. Pickup fee applies while the merchant has fewer than pickup_fee_free_from shipments.';
COMMENT ON COLUMN public.platform_settings.pickup_fee_free_from IS
  'Existing non-cancelled shipments at or above this count make the next pickup free.';

INSERT INTO public.platform_settings (id, pickup_fee_sdg, pickup_fee_free_from, default_max_cash_sdg)
VALUES (true, 2000, 3, 300000);

INSERT INTO public.shipping_zones (state_name, city_name, fee_sdg, sort_order) VALUES
  ('ولاية الخرطوم', 'الخرطوم', 3000, 0),
  ('ولاية الخرطوم', 'أم درمان', 3000, 1),
  ('ولاية الخرطوم', 'الخرطوم بحري', 3200, 2),
  ('ولاية البحر الأحمر', 'بورتسودان', 5000, 3),
  ('ولاية الجزيرة', 'ود مدني', 4000, 4),
  ('ولاية نهر النيل', 'عطبرة', 4500, 5);

ALTER TABLE public.shipping_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY shipping_zones_admin_write
  ON public.shipping_zones
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY shipping_zones_merchant_read
  ON public.shipping_zones
  FOR SELECT
  TO authenticated
  USING (public.current_user_role() = 'merchant');

CREATE POLICY platform_settings_admin_write
  ON public.platform_settings
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY platform_settings_merchant_read
  ON public.platform_settings
  FOR SELECT
  TO authenticated
  USING (public.current_user_role() = 'merchant');

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.shipping_zones TO authenticated;
GRANT SELECT, UPDATE ON TABLE public.platform_settings TO authenticated;

-- ---------------------------------------------------------------------------
-- Pickup fee. Counts shipments that already exist, then charges X until the
-- merchant reaches the threshold.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.quote_pickup_fee(p_merchant_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_fee integer;
  v_free integer;
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'rapid:unauthorized' USING ERRCODE = 'P0001';
  END IF;

  IF public.current_user_role() IS DISTINCT FROM 'merchant' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;

  IF p_merchant_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;

  SELECT pickup_fee_sdg, pickup_fee_free_from
  INTO v_fee, v_free
  FROM public.platform_settings
  WHERE id;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  SELECT count(*)::integer
  INTO v_count
  FROM public.orders
  WHERE merchant_id = p_merchant_id
    AND status::text <> 'cancelled';

  IF v_count >= v_free THEN
    RETURN 0;
  END IF;

  RETURN v_fee;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.stamp_order_sudan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_fee integer;
  v_free integer;
  v_count integer;
BEGIN
  IF NEW.country_code IS NULL OR btrim(NEW.country_code) = '' THEN
    NEW.country_code := 'SD';
  END IF;

  -- Same rule as quote_pickup_fee, inlined so an insert is not blocked by
  -- that function's session check. The client-supplied pickup_fee is ignored.
  IF TG_OP = 'INSERT' THEN
    SELECT pickup_fee_sdg, pickup_fee_free_from
    INTO v_fee, v_free
    FROM public.platform_settings
    WHERE id;

    SELECT count(*)::integer
    INTO v_count
    FROM public.orders
    WHERE merchant_id = NEW.merchant_id
      AND status::text <> 'cancelled';

    IF v_free IS NULL OR v_count >= v_free THEN
      NEW.pickup_fee := 0;
    ELSE
      NEW.pickup_fee := coalesce(v_fee, 0);
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER orders_stamp_sudan
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_order_sudan();

-- ---------------------------------------------------------------------------
-- COD ceiling. Assigning a delivery driver to a COD shipment is refused when
-- that driver is already over max_cash_limit.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_driver_cash_ceiling()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_cash integer;
  v_limit integer;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.payment_type = 'cod'
     AND NEW.driver_id IS NOT NULL
     AND NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
    SELECT current_cash_in_hand, max_cash_limit
    INTO v_cash, v_limit
    FROM public.profiles
    WHERE id = NEW.driver_id
      AND role = 'driver';

    IF FOUND AND v_cash > v_limit THEN
      RAISE EXCEPTION 'rapid:cash_limit' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER orders_guard_driver_cash_ceiling
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_driver_cash_ceiling();

-- ---------------------------------------------------------------------------
-- Privilege guard. Same body as 0007, plus country, KYC, and cash columns:
-- only an admin may change them. A non-driver loses vehicle and KYC fields.
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
       OR NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'only an admin can change role, staff type, zone, KYC, cash ceiling, or active status';
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
-- Admin settings writes. One transaction replaces the zone matrix.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_save_pricing(
  p_zones jsonb,
  p_pickup_fee integer,
  p_free_from integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_item jsonb;
  v_index integer := 0;
  v_state text;
  v_city text;
  v_fee integer;
  v_active boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'rapid:unauthorized' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;
  IF p_pickup_fee IS NULL OR p_pickup_fee < 0 OR p_pickup_fee > 10000000
     OR p_free_from IS NULL OR p_free_from < 1 OR p_free_from > 100
     OR jsonb_typeof(p_zones) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_zones) > 40 THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_zones) AS item
    GROUP BY btrim(coalesce(item->>'state_name', '')), btrim(coalesce(item->>'city_name', ''))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_zones) LOOP
    v_state := btrim(coalesce(v_item->>'state_name', ''));
    v_city := btrim(coalesce(v_item->>'city_name', ''));
    IF v_item->>'fee_sdg' IS NULL OR v_item->>'fee_sdg' !~ '^[0-9]{1,8}$' THEN
      RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
    END IF;
    v_fee := (v_item->>'fee_sdg')::integer;
    IF v_item ? 'is_active' AND jsonb_typeof(v_item->'is_active') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
    END IF;
    v_active := coalesce((v_item->>'is_active')::boolean, true);
    IF char_length(v_state) < 2 OR char_length(v_state) > 80
       OR char_length(v_city) > 80
       OR v_fee < 0 OR v_fee > 10000000 THEN
      RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  UPDATE public.platform_settings
  SET pickup_fee_sdg = p_pickup_fee,
      pickup_fee_free_from = p_free_from,
      updated_at = now()
  WHERE id;

  DELETE FROM public.shipping_zones;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_zones) LOOP
    v_state := btrim(v_item->>'state_name');
    v_city := btrim(coalesce(v_item->>'city_name', ''));
    v_fee := (v_item->>'fee_sdg')::integer;
    v_active := coalesce((v_item->>'is_active')::boolean, true);
    INSERT INTO public.shipping_zones (state_name, city_name, fee_sdg, is_active, sort_order)
    VALUES (v_state, v_city, v_fee, v_active, v_index);
    v_index := v_index + 1;
  END LOOP;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_save_fleet_rules(p_default_max_cash integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'rapid:unauthorized' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;
  IF p_default_max_cash IS NULL
     OR p_default_max_cash < 0
     OR p_default_max_cash > 100000000 THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.platform_settings
  SET default_max_cash_sdg = p_default_max_cash,
      updated_at = now()
  WHERE id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.quote_pickup_fee(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.stamp_order_sudan() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_driver_cash_ceiling() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_profile_privileges() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_save_pricing(jsonb, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_save_fleet_rules(integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.quote_pickup_fee(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_pricing(jsonb, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_fleet_rules(integer) TO authenticated;
