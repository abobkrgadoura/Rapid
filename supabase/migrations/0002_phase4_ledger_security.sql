-- Phase 4 — delivery ledger, manifest pickup, and prepaid OTP.
--
-- Wallet sign is unchanged: positive means the platform owes the driver,
-- negative means the driver owes the platform. COD posts a negative
-- cod_debt of (product_price + platform_commission). Prepaid posts a
-- positive prepaid_earning of (delivery_fee - platform_commission).
-- Both go through public.ledger_post, which inserts the transactions row
-- and updates the wallet in the same function (one transaction).
--
-- apply_wallet_entry remains the admin / service-role entry point and now
-- delegates to ledger_post. Delivery, settlement, and payout actions call
-- ledger_post only after their own session checks. ledger_post itself is
-- not granted to client roles.
--
-- orders.delivery_otp holds the prepaid 4-digit code. SELECT and UPDATE on
-- that column are revoked from authenticated clients. Drivers prove the
-- handoff with verify_delivery_otp. A prepaid earning cannot post until
-- that verification has succeeded.

-- ---------------------------------------------------------------------------
-- Order columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.orders
  ADD COLUMN delivery_otp text,
  ADD COLUMN otp_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN otp_verified_at timestamptz,
  ADD COLUMN ledger_posted_at timestamptz;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_delivery_otp_format CHECK (
    delivery_otp IS NULL OR delivery_otp ~ '^[0-9]{4}$'
  ),
  ADD CONSTRAINT orders_delivery_otp_prepaid_only CHECK (
    delivery_otp IS NULL OR payment_type = 'prepaid'
  ),
  ADD CONSTRAINT orders_otp_attempts_range CHECK (
    otp_attempts BETWEEN 0 AND 5
  ),
  ADD CONSTRAINT orders_otp_verified_requires_code CHECK (
    otp_verified_at IS NULL OR delivery_otp IS NOT NULL
  );

COMMENT ON COLUMN public.orders.delivery_otp IS
  'Prepaid handoff code. Hidden from authenticated SELECT and UPDATE; issued and read through security-definer functions.';
COMMENT ON COLUMN public.orders.otp_attempts IS
  'Failed verify_delivery_otp attempts. Locked at 5 until the code is reissued. Keep in sync with DELIVERY_OTP_ATTEMPT_LIMIT.';
COMMENT ON COLUMN public.orders.otp_verified_at IS
  'When the assigned driver (or an admin) presented the prepaid OTP. Required before a prepaid earning posts.';
COMMENT ON COLUMN public.orders.ledger_posted_at IS
  'When the delivery wallet entry was posted. A zero net movement still stamps this so the order cannot post twice.';

-- ---------------------------------------------------------------------------
-- Mutation guard. Direct client updates cannot assign a driver, advance an
-- operational status, or touch OTP / ledger columns. Batch pickup and the
-- OTP functions set app.trusted_order_write for the current transaction.
-- Financial figures freeze once the order leaves pending, including for admins,
-- so a posted amount cannot be rewritten. Corrections are ledger entries.
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

    IF public.is_admin() THEN
      RETURN NEW;
    END IF;

    IF NEW.status IS DISTINCT FROM 'pending' OR NEW.driver_id IS NOT NULL THEN
      RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
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

  IF NEW.driver_id IS DISTINCT FROM OLD.driver_id
     AND NOT v_trusted
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT v_trusted
     AND NOT public.is_admin() THEN
    -- Merchants may cancel an order that is still pending. Every other
    -- transition goes through an admin or a trusted function.
    IF NEW.status IS DISTINCT FROM 'cancelled'
       OR OLD.status IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER orders_guard_security
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_order_security();

-- ---------------------------------------------------------------------------
-- Shared ledger write. Same checks and row lock as the original
-- apply_wallet_entry body. No role check here: callers enforce that.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ledger_post(
  p_wallet_id uuid,
  p_order_id uuid,
  p_type public.transaction_type,
  p_amount numeric
)
RETURNS public.transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_wallet public.wallets;
  v_order_driver uuid;
  v_new_balance numeric(14, 2);
  v_tx public.transactions;
BEGIN
  IF p_type IN ('cod_debt', 'prepaid_earning') AND p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id is required for %', p_type;
  END IF;

  PERFORM set_config('app.wallet_ledger', 'on', true);

  SELECT *
  INTO v_wallet
  FROM public.wallets
  WHERE id = p_wallet_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'wallet not found';
  END IF;

  IF p_order_id IS NOT NULL THEN
    SELECT driver_id
    INTO v_order_driver
    FROM public.orders
    WHERE id = p_order_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'order not found';
    END IF;

    IF p_type IN ('cod_debt', 'prepaid_earning')
       AND v_order_driver IS DISTINCT FROM v_wallet.driver_id THEN
      RAISE EXCEPTION 'order is not assigned to this wallet''s driver';
    END IF;
  END IF;

  v_new_balance := v_wallet.balance + p_amount;

  INSERT INTO public.transactions (wallet_id, order_id, type, amount, balance_after)
  VALUES (p_wallet_id, p_order_id, p_type, p_amount, v_new_balance)
  RETURNING * INTO v_tx;

  UPDATE public.wallets
  SET balance = v_new_balance
  WHERE id = p_wallet_id;

  RETURN v_tx;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.apply_wallet_entry(
  p_wallet_id uuid,
  p_order_id uuid,
  p_type public.transaction_type,
  p_amount numeric
)
RETURNS public.transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'service_role'
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'only an admin can post wallet entries';
  END IF;

  RETURN public.ledger_post(p_wallet_id, p_order_id, p_type, p_amount);
END;
$fn$;

-- Mirrors src/lib/money.ts. COD is a debit. Prepaid is a credit.
CREATE OR REPLACE FUNCTION public.order_wallet_delta(
  p_payment_type public.payment_type,
  p_product_price numeric,
  p_delivery_fee numeric,
  p_platform_commission numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT CASE p_payment_type
    WHEN 'cod' THEN -(p_product_price + p_platform_commission)
    WHEN 'prepaid' THEN (p_delivery_fee - p_platform_commission)
    ELSE NULL
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
  v_tx public.transactions;
  v_tx_id uuid := NULL;
  v_type public.transaction_type;
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

  v_type := CASE p_payment_type
    WHEN 'cod' THEN 'cod_debt'::public.transaction_type
    ELSE 'prepaid_earning'::public.transaction_type
  END;

  v_amount := public.order_wallet_delta(
    v_order.payment_type,
    v_order.product_price,
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
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  IF v_amount <> 0 THEN
    v_tx := public.ledger_post(v_wallet_id, v_order.id, v_type, v_amount);
    v_tx_id := v_tx.id;
    v_balance := v_tx.balance_after;
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
  WHEN check_violation THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
END;
$fn$;

CREATE OR REPLACE FUNCTION public.preview_delivery_ledger(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_order public.orders;
  v_amount numeric(14, 2);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'rapid:unauthorized' USING ERRCODE = 'P0001';
  END IF;

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id;

  IF NOT FOUND
     OR NOT (
       public.is_admin()
       OR v_order.merchant_id = auth.uid()
       OR v_order.driver_id = auth.uid()
       OR v_order.customer_id = auth.uid()
     ) THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;

  v_amount := public.order_wallet_delta(
    v_order.payment_type,
    v_order.product_price,
    v_order.delivery_fee,
    v_order.platform_commission
  )::numeric(14, 2);

  IF v_amount IS NULL THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'payment_type', v_order.payment_type,
    'product_price', v_order.product_price::text,
    'delivery_fee', v_order.delivery_fee::text,
    'platform_commission', v_order.platform_commission::text,
    'type', CASE v_order.payment_type
      WHEN 'cod' THEN 'cod_debt'
      ELSE 'prepaid_earning'
    END,
    'amount', v_amount::numeric(14, 2)::text
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.record_driver_cash_movement(
  p_driver_id uuid,
  p_amount numeric,
  p_order_id uuid,
  p_type public.transaction_type
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_order_driver uuid;
  v_wallet public.wallets;
  v_signed numeric(14, 2);
  v_tx public.transactions;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'rapid:unauthorized' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;

  IF p_driver_id IS NULL
     OR p_type NOT IN ('settlement', 'payout')
     OR p_amount IS NULL
     OR p_amount <= 0
     OR p_amount > 999999999999.99
     OR p_amount <> trunc(p_amount, 2) THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = p_driver_id
      AND role = 'driver'
  ) THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  -- Lock the order before the wallet, matching post_delivery_ledger.
  IF p_order_id IS NOT NULL THEN
    SELECT driver_id
    INTO v_order_driver
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF NOT FOUND OR v_order_driver IS DISTINCT FROM p_driver_id THEN
      RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT *
  INTO v_wallet
  FROM public.wallets
  WHERE driver_id = p_driver_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  IF p_type = 'settlement' THEN
    IF v_wallet.balance >= 0 THEN
      RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
    END IF;
    IF p_amount > abs(v_wallet.balance) THEN
      RAISE EXCEPTION 'rapid:insufficient' USING ERRCODE = 'P0001';
    END IF;
    v_signed := p_amount;
  ELSE
    IF v_wallet.balance <= 0 THEN
      RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
    END IF;
    IF p_amount > v_wallet.balance THEN
      RAISE EXCEPTION 'rapid:insufficient' USING ERRCODE = 'P0001';
    END IF;
    v_signed := -p_amount;
  END IF;

  v_tx := public.ledger_post(v_wallet.id, p_order_id, p_type, v_signed);

  RETURN jsonb_build_object(
    'posted', true,
    'transaction_id', v_tx.id,
    'wallet_id', v_tx.wallet_id,
    'order_id', v_tx.order_id,
    'type', v_tx.type,
    'amount', v_tx.amount::numeric(14, 2)::text,
    'balance_after', v_tx.balance_after::numeric(14, 2)::text
  );
EXCEPTION
  WHEN check_violation THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
END;
$fn$;

CREATE OR REPLACE FUNCTION public.record_driver_settlement(
  p_driver_id uuid,
  p_amount numeric,
  p_order_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  RETURN public.record_driver_cash_movement(
    p_driver_id,
    p_amount,
    p_order_id,
    'settlement'
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.record_driver_payout(
  p_driver_id uuid,
  p_amount numeric,
  p_order_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  RETURN public.record_driver_cash_movement(
    p_driver_id,
    p_amount,
    p_order_id,
    'payout'
  );
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Manifest scan. One function, one transaction: every pending order for this
-- merchant is assigned to the driver and marked picked_up, or none are.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.process_batch_pickup(
  p_driver_id uuid,
  p_merchant_id uuid,
  p_order_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_id uuid;
  v_locked bigint := 0;
  v_eligible bigint := 0;
  v_updated bigint := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'rapid:unauthorized' USING ERRCODE = 'P0001';
  END IF;

  IF p_driver_id IS NULL OR p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.is_admin() AND auth.uid() IS DISTINCT FROM p_driver_id THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;

  IF p_driver_id = p_merchant_id
     OR p_order_ids IS NULL
     OR cardinality(p_order_ids) < 1
     OR cardinality(p_order_ids) > 100
     OR EXISTS (
       SELECT 1 FROM unnest(p_order_ids) AS id WHERE id IS NULL
     ) THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  IF (
    SELECT count(*)
    FROM (SELECT DISTINCT id FROM unnest(p_order_ids) AS id) AS distinct_ids
  ) <> cardinality(p_order_ids) THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_driver_id AND role = 'driver'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_merchant_id AND role = 'merchant'
  ) THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  FOR v_id IN
    SELECT id
    FROM public.orders
    WHERE id = ANY (p_order_ids)
    ORDER BY id
    FOR UPDATE
  LOOP
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
    END IF;
    v_locked := v_locked + 1;
  END LOOP;

  SELECT count(*)
  INTO v_eligible
  FROM public.orders
  WHERE id = ANY (p_order_ids)
    AND merchant_id = p_merchant_id
    AND status = 'pending'
    AND (driver_id IS NULL OR driver_id = p_driver_id);

  IF v_locked <> cardinality(p_order_ids)
     OR v_eligible <> cardinality(p_order_ids) THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('app.trusted_order_write', 'on', true);

  UPDATE public.orders
  SET status = 'picked_up',
      driver_id = p_driver_id
  WHERE id = ANY (p_order_ids);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> cardinality(p_order_ids) THEN
    RAISE EXCEPTION 'rapid:failed' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('order_ids', to_jsonb(p_order_ids));
EXCEPTION
  WHEN check_violation THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Prepaid OTP. The code is generated in the application with crypto.randomInt
-- and stored here. Verification is capped at 5 failures.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.issue_delivery_otp(
  p_order_id uuid,
  p_code text
)
RETURNS text
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

  IF p_order_id IS NULL OR p_code IS NULL OR p_code !~ '^[0-9]{4}$' THEN
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
       AND v_order.merchant_id IS DISTINCT FROM auth.uid()
     ) THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;

  IF v_order.payment_type IS DISTINCT FROM 'prepaid'
     OR v_order.status = 'cancelled'
     OR v_order.ledger_posted_at IS NOT NULL THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  IF v_order.status = 'delivered' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('app.trusted_order_write', 'on', true);

  UPDATE public.orders
  SET delivery_otp = p_code,
      otp_attempts = 0,
      otp_verified_at = NULL
  WHERE id = p_order_id;

  RETURN p_code;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.verify_delivery_otp(
  p_order_id uuid,
  p_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_order public.orders;
  v_limit constant integer := 5;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'rapid:unauthorized' USING ERRCODE = 'P0001';
  END IF;

  IF p_order_id IS NULL OR p_code IS NULL OR p_code !~ '^[0-9]{4}$' THEN
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

  IF v_order.payment_type IS DISTINCT FROM 'prepaid'
     OR v_order.status = 'cancelled'
     OR v_order.delivery_otp IS NULL THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  IF v_order.otp_verified_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'valid', v_order.delivery_otp = p_code,
      'attempts_remaining', v_limit - v_order.otp_attempts
    );
  END IF;

  IF v_order.otp_attempts >= v_limit THEN
    RAISE EXCEPTION 'rapid:locked' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('app.trusted_order_write', 'on', true);

  IF v_order.delivery_otp = p_code THEN
    UPDATE public.orders
    SET otp_verified_at = now()
    WHERE id = p_order_id;

    RETURN jsonb_build_object(
      'valid', true,
      'attempts_remaining', v_limit - v_order.otp_attempts
    );
  END IF;

  UPDATE public.orders
  SET otp_attempts = v_order.otp_attempts + 1
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'valid', false,
    'attempts_remaining', v_limit - (v_order.otp_attempts + 1)
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.read_delivery_otp(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_order public.orders;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'rapid:unauthorized' USING ERRCODE = 'P0001';
  END IF;

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id;

  IF NOT FOUND
     OR NOT (
       public.is_admin()
       OR v_order.merchant_id = auth.uid()
       OR v_order.customer_id = auth.uid()
     ) THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;

  IF v_order.payment_type IS DISTINCT FROM 'prepaid'
     OR v_order.delivery_otp IS NULL THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_order.delivery_otp;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Grants. Client roles never call ledger_post or the pure delta helper.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.guard_order_security() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ledger_post(uuid, uuid, public.transaction_type, numeric) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.order_wallet_delta(public.payment_type, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.post_delivery_ledger(uuid, public.payment_type) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.preview_delivery_ledger(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_driver_cash_movement(uuid, numeric, uuid, public.transaction_type) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_driver_settlement(uuid, numeric, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_driver_payout(uuid, numeric, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.process_batch_pickup(uuid, uuid, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.issue_delivery_otp(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.verify_delivery_otp(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.read_delivery_otp(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.post_delivery_ledger(uuid, public.payment_type) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_delivery_ledger(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_driver_settlement(uuid, numeric, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_driver_payout(uuid, numeric, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_batch_pickup(uuid, uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_delivery_otp(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_delivery_otp(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.read_delivery_otp(uuid) TO authenticated;

-- Hide the handoff code from every authenticated select, including select *.
-- Trusted functions run as the migration owner and can still read it.
REVOKE SELECT (delivery_otp) ON TABLE public.orders FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (delivery_otp, otp_attempts, otp_verified_at, ledger_posted_at)
  ON TABLE public.orders FROM PUBLIC, anon, authenticated;

-- select * on orders fails once delivery_otp is hidden. This view is the
-- row clients can read; it never includes the handoff code. security_invoker
-- keeps the orders RLS policies in force.
CREATE VIEW public.orders_readable
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
  ledger_posted_at
FROM public.orders;

REVOKE ALL ON TABLE public.orders_readable FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.orders_readable TO authenticated;
