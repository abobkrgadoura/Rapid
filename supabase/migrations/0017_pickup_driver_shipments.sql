-- Phase 21 - real shipments for the pickup driver.
--
-- A pickup driver has no orders policy on purpose (0004): the table and the
-- orders_readable view carry customer names, phones, addresses and dropoff GPS
-- links, and column-level grants cannot hide them from a row-level policy.
-- This function is the only door. It returns logistics fields and the
-- merchant's name and pickup address, and nothing about the recipient.
--
--   * orders.weight_kg: nullable parcel weight. No column existed. It is not
--     granted to any client role, so it stays NULL until a later phase lets the
--     merchant form or an admin RPC write it.
--   * pickup_driver_shipments(): rows where pickup_driver_id = the caller.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS weight_kg numeric(6, 2);

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_weight_kg_range;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_weight_kg_range CHECK (
    weight_kg IS NULL OR (weight_kg > 0 AND weight_kg <= 999.99)
  );

COMMENT ON COLUMN public.orders.weight_kg IS
  'Parcel weight in kilograms. Optional. Shown on the pickup driver shipments list. Not granted to client roles.';

DROP FUNCTION IF EXISTS public.pickup_driver_shipments();

CREATE FUNCTION public.pickup_driver_shipments()
RETURNS TABLE (
  id uuid,
  tracking_code text,
  status text,
  weight_kg numeric,
  pieces_count integer,
  created_at timestamptz,
  merchant_id uuid,
  company_name text,
  pickup_address text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    o.id,
    o.tracking_code,
    o.status::text,
    o.weight_kg,
    o.pieces_count,
    o.created_at,
    o.merchant_id,
    coalesce(
      nullif(btrim(p.company_name), ''),
      nullif(btrim(p.full_name), ''),
      'Merchant'
    ) AS company_name,
    o.pickup_address
  FROM public.orders AS o
  JOIN public.profiles AS p ON p.id = o.merchant_id
  WHERE o.pickup_driver_id = auth.uid()
    AND auth.uid() IS NOT NULL
    AND public.current_user_role() = 'driver'
    -- Delivery drivers and hub operators never read pickup work. Drivers created
    -- before 0007 have no staff_type and keep the generic behaviour.
    AND coalesce(
      (SELECT d.staff_type::text FROM public.profiles AS d WHERE d.id = auth.uid()),
      'pickup_driver'
    ) = 'pickup_driver'
  ORDER BY o.created_at DESC, o.id
  LIMIT 200;
$fn$;

REVOKE ALL ON FUNCTION public.pickup_driver_shipments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pickup_driver_shipments() TO authenticated;
