-- Merchant edits of their own orders, and only while the order is still pending.
-- Requires orders.pieces_count from 0010. order_history from 0012 is used when
-- it exists; the edit still saves if that table has not been created yet.

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'pieces_count'
  ) THEN
    RAISE EXCEPTION 'Apply 0010_phase13_orders_exceptions_driver_pro.sql before 0015. orders.pieces_count is missing.';
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- A merchant may update only their own pending rows, and the row must stay
-- pending. Status changes (including cancel) are not part of this policy.
-- Admins keep orders_admin_all.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS orders_merchant_update ON public.orders;

CREATE POLICY orders_merchant_update
  ON public.orders
  FOR UPDATE
  TO authenticated
  USING (
    merchant_id = auth.uid()
    AND public.current_user_role() = 'merchant'
    AND status = 'pending'
  )
  WITH CHECK (
    merchant_id = auth.uid()
    AND public.current_user_role() = 'merchant'
    AND status = 'pending'
  );

COMMENT ON POLICY orders_merchant_update ON public.orders IS
  'Merchants update their own orders only while status is pending, and cannot move the status off pending.';

-- ---------------------------------------------------------------------------
-- Extra write guard for direct updates. Security-definer logistics functions
-- set app.trusted_order_write and are not limited here. Admins are not limited
-- here. A merchant JWT cannot change fees, payment type, ownership, or the
-- tracking code, and cannot change the address or COD once the order leaves
-- pending. Prepaid product_price stays put.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_merchant_order_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_trusted boolean := current_setting('app.trusted_order_write', true) = 'on';
BEGIN
  IF TG_OP IS DISTINCT FROM 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF v_trusted OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.delivery_fee IS DISTINCT FROM OLD.delivery_fee
     OR NEW.platform_commission IS DISTINCT FROM OLD.platform_commission
     OR NEW.payment_type IS DISTINCT FROM OLD.payment_type
     OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
     OR NEW.tracking_code IS DISTINCT FROM OLD.tracking_code THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;

  IF OLD.status IS DISTINCT FROM 'pending'
     AND NEW.dropoff_address IS DISTINCT FROM OLD.dropoff_address THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.product_price IS DISTINCT FROM OLD.product_price
     AND (
       OLD.status IS DISTINCT FROM 'pending'
       OR OLD.payment_type::text IS DISTINCT FROM 'cod'
     ) THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS orders_guard_merchant_edit ON public.orders;

CREATE TRIGGER orders_guard_merchant_edit
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_merchant_order_edit();

REVOKE ALL ON FUNCTION public.guard_merchant_order_edit() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- History actions. Skipped when 0012 has not created the table yet.
-- ---------------------------------------------------------------------------

DO $do$
BEGIN
  IF to_regclass('public.order_history') IS NOT NULL THEN
    ALTER TABLE public.order_history DROP CONSTRAINT IF EXISTS order_history_action_known;
    ALTER TABLE public.order_history
      ADD CONSTRAINT order_history_action_known
      CHECK (
        action IN ('edit_details', 'merchant_edit', 'accept_exception', 'reject_exception')
      );
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- Merchant edit. The caller is the signed-in merchant. The function checks
-- that again, and that the order is still pending and belongs to them.
-- Phone, secondary phone, and the street are rewritten into dropoff_address.
-- The customer name and the exchange/return note lines are kept.
-- COD (product_price) changes only when payment_type is cod.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.merchant_edit_pending_order(
  p_order_id uuid,
  p_phone text,
  p_secondary_phone text,
  p_dropoff_address text,
  p_pieces_count integer,
  p_product_price text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_order public.orders;
  v_phone text;
  v_secondary text;
  v_street text;
  v_price_text text;
  v_price numeric(12, 2);
  v_lines text[];
  v_name text := '';
  v_meta text := '';
  v_line text;
  v_i integer;
  v_dropoff text;
  v_changes jsonb := '{}'::jsonb;
  v_sudan text := '^([+]249|0)[19][0-9]{8}$';
  v_egypt text := '^([+]201[0125][0-9]{8}|01[0125][0-9]{8})$';
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'rapid:unauthorized' USING ERRCODE = 'P0001';
  END IF;

  IF public.current_user_role() IS DISTINCT FROM 'merchant' THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;

  v_phone := btrim(coalesce(p_phone, ''));
  v_secondary := btrim(coalesce(p_secondary_phone, ''));
  v_street := btrim(coalesce(p_dropoff_address, ''));
  v_price_text := nullif(btrim(coalesce(p_product_price, '')), '');

  IF p_order_id IS NULL
     OR (v_phone !~ v_sudan AND v_phone !~ v_egypt)
     OR (
       v_secondary <> ''
       AND v_secondary !~ v_sudan
       AND v_secondary !~ v_egypt
     )
     OR char_length(v_street) < 1
     OR char_length(v_street) > 500
     OR p_pieces_count IS NULL
     OR p_pieces_count < 1
     OR p_pieces_count > 99
     OR (
       v_price_text IS NOT NULL
       AND v_price_text !~ '^(?:0|[1-9][0-9]{0,9})(?:\.[0-9]{1,2})?$'
     ) THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM regexp_split_to_table(v_street, E'\n') AS line
    WHERE btrim(line) ~* '^(alt|ref|item|back):'
  ) THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'rapid:not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_order.merchant_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;

  IF v_order.status::text IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'rapid:not_pending' USING ERRCODE = 'P0001';
  END IF;

  v_lines := regexp_split_to_array(coalesce(v_order.dropoff_address, ''), E'\n');

  IF coalesce(array_length(v_lines, 1), 0) >= 2
     AND btrim(v_lines[1]) <> ''
     AND (btrim(v_lines[2]) ~ v_sudan OR btrim(v_lines[2]) ~ v_egypt) THEN
    v_name := btrim(v_lines[1]);
  END IF;

  IF v_name = '' THEN
    v_name := 'العميل';
  END IF;

  FOR v_i IN 1..coalesce(array_length(v_lines, 1), 0) LOOP
    v_line := btrim(v_lines[v_i]);
    IF v_line ~* '^(ref|item|back):' THEN
      v_meta := v_meta || E'\n' || v_line;
    END IF;
  END LOOP;

  v_dropoff := v_name || E'\n' || v_phone;
  IF v_secondary <> '' THEN
    v_dropoff := v_dropoff || E'\n' || 'alt:' || v_secondary;
  END IF;
  v_dropoff := v_dropoff || E'\n' || v_street || v_meta;

  IF char_length(v_dropoff) > 2000 THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  IF v_dropoff IS DISTINCT FROM v_order.dropoff_address THEN
    v_changes := v_changes || jsonb_build_object(
      'dropoff_address',
      jsonb_build_object('from', v_order.dropoff_address, 'to', v_dropoff)
    );
  END IF;

  IF p_pieces_count IS DISTINCT FROM v_order.pieces_count THEN
    v_changes := v_changes || jsonb_build_object(
      'pieces_count',
      jsonb_build_object('from', v_order.pieces_count, 'to', p_pieces_count)
    );
  END IF;

  IF v_order.payment_type::text = 'cod' THEN
    IF v_price_text IS NULL THEN
      RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
    END IF;
    v_price := v_price_text::numeric(12, 2);
    IF v_price IS DISTINCT FROM v_order.product_price THEN
      v_changes := v_changes || jsonb_build_object(
        'product_price',
        jsonb_build_object('from', v_order.product_price, 'to', v_price)
      );
    ELSE
      v_price := NULL;
    END IF;
  ELSE
    IF v_price_text IS NOT NULL
       AND v_price_text::numeric(12, 2) IS DISTINCT FROM v_order.product_price THEN
      RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
    END IF;
    v_price := NULL;
  END IF;

  IF v_changes = '{}'::jsonb THEN
    RETURN jsonb_build_object(
      'id', v_order.id,
      'tracking_code', v_order.tracking_code,
      'changed', false
    );
  END IF;

  UPDATE public.orders
  SET dropoff_address = v_dropoff,
      pieces_count = p_pieces_count,
      product_price = COALESCE(v_price, product_price)
  WHERE id = v_order.id;

  IF to_regclass('public.order_history') IS NOT NULL THEN
    INSERT INTO public.order_history (order_id, actor_id, action, changes)
    VALUES (v_order.id, auth.uid(), 'merchant_edit', v_changes);
  END IF;

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

REVOKE ALL ON FUNCTION public.merchant_edit_pending_order(uuid, text, text, text, integer, text)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.merchant_edit_pending_order(uuid, text, text, text, integer, text)
  TO authenticated;

COMMENT ON FUNCTION public.merchant_edit_pending_order(uuid, text, text, text, integer, text) IS
  'Merchant correction of phone, secondary phone, dropoff street, pieces, and COD. Pending orders owned by the caller only.';
