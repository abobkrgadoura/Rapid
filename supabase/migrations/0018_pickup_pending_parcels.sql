-- Phase 21 - real parcels in the pickup scanner and a "today" shipments filter.
--
--   * pickup_pending_parcels(): the pending parcels a pickup driver may still
--     collect (the same rows pickup_merchant_groups() counts), one row per
--     parcel, so the scanner can show real tracking codes, weights and pieces
--     instead of mock values. Logistics fields only: no recipient name, phone,
--     dropoff address or dropoff GPS.
--   * pickup_driver_shipments(): gains updated_at so the Shipments tab can keep
--     only rows created or touched today.
--
-- Partial pickup needs no change to confirm_batch_pickup(text[]): it updates
-- only the codes it is given (WHERE tracking_code = ANY (v_codes)), so parcels
-- the driver did not scan stay pending for the next trip.

DROP FUNCTION IF EXISTS public.pickup_pending_parcels();

CREATE FUNCTION public.pickup_pending_parcels()
RETURNS TABLE (
  id uuid,
  tracking_code text,
  weight_kg numeric,
  pieces_count integer,
  created_at timestamptz,
  merchant_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    o.id,
    o.tracking_code,
    o.weight_kg,
    o.pieces_count,
    o.created_at,
    o.merchant_id
  FROM public.orders AS o
  WHERE o.status = 'pending'
    AND (o.pickup_driver_id IS NULL OR o.pickup_driver_id = auth.uid())
    AND auth.uid() IS NOT NULL
    AND public.current_user_role() = 'driver'
    AND coalesce(
      (SELECT d.staff_type::text FROM public.profiles AS d WHERE d.id = auth.uid()),
      'pickup_driver'
    ) = 'pickup_driver'
  ORDER BY o.created_at, o.id
  LIMIT 500;
$fn$;

REVOKE ALL ON FUNCTION public.pickup_pending_parcels() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pickup_pending_parcels() TO authenticated;

DROP FUNCTION IF EXISTS public.pickup_driver_shipments();

CREATE FUNCTION public.pickup_driver_shipments()
RETURNS TABLE (
  id uuid,
  tracking_code text,
  status text,
  weight_kg numeric,
  pieces_count integer,
  created_at timestamptz,
  updated_at timestamptz,
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
    o.updated_at,
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
    AND coalesce(
      (SELECT d.staff_type::text FROM public.profiles AS d WHERE d.id = auth.uid()),
      'pickup_driver'
    ) = 'pickup_driver'
  -- Pending parcels sort first so the LIMIT can never cut off a parcel the
  -- driver still has to collect, however old it is.
  ORDER BY (o.status = 'pending') DESC, o.created_at DESC, o.id
  LIMIT 200;
$fn$;

REVOKE ALL ON FUNCTION public.pickup_driver_shipments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pickup_driver_shipments() TO authenticated;
