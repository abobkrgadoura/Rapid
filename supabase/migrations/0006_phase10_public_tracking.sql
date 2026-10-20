-- Phase 10: anonymous tracking returns only what a customer may see.
--
-- track_order_details is granted to anon, so its columns are the public API.
-- This replaces the Phase 5 signature (which included the driver's phone)
-- with a strict field list. delivery_otp, platform_commission, street
-- addresses, GPS links, and phone numbers are not selected.

DROP FUNCTION IF EXISTS public.track_order_details(text);

-- A city or zone fragment. Street, floor, apartment, landmark, phone, and
-- URL fragments fail the check and are never returned.
CREATE OR REPLACE FUNCTION public.public_area_piece_safe(p_piece text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT
    p_piece IS NOT NULL
    AND char_length(btrim(p_piece)) BETWEEN 2 AND 48
    AND btrim(p_piece) ~ '[A-Za-zء-ي].*[A-Za-zء-ي]'
    AND btrim(p_piece) !~* '(https?:|www\.|maps\.|goo\.gl|waze|gps|@|\+)'
    AND char_length(
      regexp_replace(
        translate(btrim(p_piece), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
        '[^0-9]',
        '',
        'g'
      )
    ) <= 2
    AND btrim(p_piece) !~ '(شارع|شقه|شقة|شقق|طابق|طوابق|مبنى|مباني|مبني|عمارة|عمارات|عماره|برج|حارة|حاره|فيلا|منزل|الدور|أدوار|فوق|بجوار|أمام|امام|خلف|رقم)'
    AND btrim(p_piece) !~* '(apartment|flat|floor|floors|building|bldg|street|road|suite|unit|villa|above|beside|opposite|behind)'
    AND btrim(p_piece) !~ '(^|[[:space:]])دور([[:space:]]|$)'
    AND btrim(p_piece) !~ '(^|[[:space:]])عند([[:space:]]|$)';
$$;

-- First safe city/zone piece from the stored dropoff blob. Name, phone, and
-- alt: lines are skipped the same way the app decodes a recipient. Anything
-- that is not a short place name becomes the generic label.
CREATE OR REPLACE FUNCTION public.public_area_label(p_dropoff text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  parts text[];
  index integer := 1;
  phone text;
  body text := '';
  line text;
  piece text;
BEGIN
  IF p_dropoff IS NULL OR btrim(p_dropoff) = '' THEN
    RETURN 'منطقة التوصيل';
  END IF;

  parts := regexp_split_to_array(p_dropoff, E'[\\n\\r]+');
  IF parts IS NULL OR array_length(parts, 1) IS NULL THEN
    RETURN 'منطقة التوصيل';
  END IF;

  IF array_length(parts, 1) >= 3 THEN
    phone := btrim(parts[2]);
    IF phone ~ '^\+?[0-9][0-9 ().-]{6,18}$' THEN
      index := 3;
      IF array_length(parts, 1) >= 4 AND btrim(parts[3]) ~* '^alt:' THEN
        index := 4;
      END IF;
    END IF;
  END IF;

  WHILE index <= array_length(parts, 1) LOOP
    line := btrim(parts[index]);
    IF line <> '' AND line !~* '^(ref|item|back):' THEN
      body := body || ' ' || line;
    END IF;
    index := index + 1;
  END LOOP;

  FOREACH piece IN ARRAY regexp_split_to_array(btrim(body), '[,،;؛]+') LOOP
    IF public.public_area_piece_safe(piece) THEN
      RETURN btrim(piece);
    END IF;
  END LOOP;

  RETURN 'منطقة التوصيل';
END;
$$;

CREATE OR REPLACE FUNCTION public.track_order_details(p_tracking_code text)
RETURNS TABLE (
  tracking_code text,
  status public.order_status,
  payment_type public.payment_type,
  total_collectible numeric,
  merchant_name text,
  destination_summary text,
  created_at timestamptz,
  picked_up_at timestamptz,
  in_transit_at timestamptz,
  delivered_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    o.tracking_code,
    o.status,
    o.payment_type,
    CASE
      WHEN o.payment_type = 'cod' THEN o.product_price
      ELSE 0
    END,
    CASE
      WHEN char_length(
        regexp_replace(
          translate(merchant.display_name, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
          '[^0-9]',
          '',
          'g'
        )
      ) >= 7
        OR merchant.display_name ~* 'https?://|www\.' THEN 'Rapid'
      ELSE merchant.display_name
    END,
    public.public_area_label(o.dropoff_address),
    o.created_at,
    o.picked_up_at,
    o.in_transit_at,
    o.delivered_at
  FROM public.orders AS o
  JOIN LATERAL (
    SELECT left(
      coalesce(
        nullif(btrim(p.company_name), ''),
        nullif(btrim(p.full_name), ''),
        'Rapid'
      ),
      120
    ) AS display_name
    FROM public.profiles AS p
    WHERE p.id = o.merchant_id
  ) AS merchant ON true
  WHERE o.tracking_code = p_tracking_code
    AND p_tracking_code ~ '^[A-Z0-9][A-Z0-9-]{3,31}$';
$$;

REVOKE ALL ON FUNCTION public.public_area_piece_safe(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.public_area_label(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.track_order_details(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_order_details(text) TO anon, authenticated;

COMMENT ON FUNCTION public.track_order_details(text) IS
  'Exact-code anonymous tracking. Public fields only: code, status, payment type, COD product amount (0 when prepaid), merchant display name, city/zone summary, and lifecycle timestamps.';
