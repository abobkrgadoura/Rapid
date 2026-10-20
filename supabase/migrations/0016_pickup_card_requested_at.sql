-- Pickup cards show when the oldest pending parcel for a merchant was created.
-- Return type gains earliest_created_at, so the previous function is replaced.

DROP FUNCTION IF EXISTS public.pickup_merchant_groups();

CREATE FUNCTION public.pickup_merchant_groups()
RETURNS TABLE (
  merchant_id uuid,
  company_name text,
  phone text,
  pickup_address text,
  pickup_gps_url text,
  pending_count bigint,
  pickup_fee numeric,
  earliest_created_at timestamptz
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
    END AS pickup_fee,
    min(o.created_at) AS earliest_created_at
  FROM public.orders AS o
  JOIN public.profiles AS p ON p.id = o.merchant_id
  WHERE o.status = 'pending'
    AND (o.pickup_driver_id IS NULL OR o.pickup_driver_id = auth.uid())
    AND auth.uid() IS NOT NULL
    AND public.current_user_role() = 'driver'
  GROUP BY o.merchant_id, p.company_name, p.full_name, p.phone
  ORDER BY 2, 1;
$fn$;

REVOKE ALL ON FUNCTION public.pickup_merchant_groups() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pickup_merchant_groups() TO authenticated;
