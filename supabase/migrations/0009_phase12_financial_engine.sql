-- Phase 12 — merchant wallets, company vault, cash settlement, merchant payouts.
--
-- Driver wallets (0001) stay as they are: positive means the platform owes
-- the driver, negative means the driver owes the platform. This migration
-- adds two more wallet kinds on the same table:
--   merchant — one row per merchant. Positive means the platform owes them
--              collected COD minus shipping fees.
--   vault    — the single company cash account. Settling a driver's
--              current_cash_in_hand receipts this wallet and zeros the cash.
--
-- current_cash_in_hand (0008) is physical COD in the driver's pocket. It is
-- not the driver wallet balance. A COD delivery adds the product price to
-- that column. settle_driver_cash moves it into the vault.
--
-- Depends on 0008 (current_cash_in_hand, pickup_fee, SDG default).

-- ---------------------------------------------------------------------------
-- Wallet owners
-- ---------------------------------------------------------------------------

ALTER TABLE public.wallets
  ALTER COLUMN driver_id DROP NOT NULL;

ALTER TABLE public.wallets
  ADD COLUMN merchant_id uuid UNIQUE REFERENCES public.profiles (id) ON DELETE RESTRICT,
  ADD COLUMN kind text NOT NULL DEFAULT 'driver';

ALTER TABLE public.wallets
  ADD CONSTRAINT wallets_kind_check CHECK (kind IN ('driver', 'merchant', 'vault')),
  ADD CONSTRAINT wallets_owner_shape CHECK (
    (kind = 'driver' AND driver_id IS NOT NULL AND merchant_id IS NULL)
    OR (kind = 'merchant' AND merchant_id IS NOT NULL AND driver_id IS NULL)
    OR (kind = 'vault' AND driver_id IS NULL AND merchant_id IS NULL)
  );

CREATE UNIQUE INDEX wallets_one_vault_idx
  ON public.wallets (kind)
  WHERE kind = 'vault';

COMMENT ON COLUMN public.wallets.kind IS
  'driver: the existing settlement wallet. merchant: COD collected minus fees. vault: company cash account, one row.';
COMMENT ON COLUMN public.wallets.merchant_id IS
  'Set only when kind = merchant. The merchant reads this wallet and its transactions.';

ALTER TABLE public.transactions
  ADD COLUMN description text;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_description_length CHECK (
    description IS NULL OR char_length(btrim(description)) BETWEEN 1 AND 120
  );

COMMENT ON COLUMN public.transactions.description IS
  'Arabic label shown on the merchant and admin ledgers, e.g. تحصيل شحنة.';

-- ---------------------------------------------------------------------------
-- Owner check. The original trigger rejected anything that was not a driver.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_wallet_driver()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_role public.user_role;
BEGIN
  IF NEW.kind = 'vault' THEN
    IF NEW.driver_id IS NOT NULL OR NEW.merchant_id IS NOT NULL THEN
      RAISE EXCEPTION 'vault wallet has no owner';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.kind = 'driver' THEN
    SELECT role INTO v_role FROM public.profiles WHERE id = NEW.driver_id;
    IF v_role IS DISTINCT FROM 'driver' THEN
      RAISE EXCEPTION 'wallets of kind driver belong only to driver profiles';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.kind = 'merchant' THEN
    SELECT role INTO v_role FROM public.profiles WHERE id = NEW.merchant_id;
    IF v_role IS DISTINCT FROM 'merchant' THEN
      RAISE EXCEPTION 'wallets of kind merchant belong only to merchant profiles';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'unknown wallet kind';
END;
$fn$;

CREATE OR REPLACE FUNCTION public.guard_wallet_balance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF NEW.driver_id IS DISTINCT FROM OLD.driver_id
     OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
     OR NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'wallet owner is immutable';
  END IF;

  IF NEW.balance IS DISTINCT FROM OLD.balance
     AND current_setting('app.wallet_ledger', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'wallet balance can only change inside public.apply_wallet_entry';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Ledger write. The 4-argument function stays for existing callers and
-- delegates here. Description is optional and never comes from a client role:
-- this function is not granted to authenticated.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ledger_post(
  p_wallet_id uuid,
  p_order_id uuid,
  p_type public.transaction_type,
  p_amount numeric,
  p_description text
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
  v_description text;
BEGIN
  IF p_type IN ('cod_debt', 'prepaid_earning') AND p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id is required for %', p_type;
  END IF;

  v_description := nullif(btrim(coalesce(p_description, '')), '');
  IF v_description IS NOT NULL AND char_length(v_description) > 120 THEN
    v_description := left(v_description, 120);
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

  INSERT INTO public.transactions (
    wallet_id, order_id, type, amount, balance_after, description
  )
  VALUES (p_wallet_id, p_order_id, p_type, p_amount, v_new_balance, v_description)
  RETURNING * INTO v_tx;

  UPDATE public.wallets
  SET balance = v_new_balance
  WHERE id = p_wallet_id;

  RETURN v_tx;
END;
$fn$;

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
BEGIN
  RETURN public.ledger_post(p_wallet_id, p_order_id, p_type, p_amount, NULL::text);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- One merchant wallet on signup or promotion. Drivers keep the 0001 path.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ensure_driver_wallet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.role = 'driver'
     AND (TG_OP = 'INSERT' OR OLD.role IS DISTINCT FROM 'driver') THEN
    INSERT INTO public.wallets (driver_id, kind, currency)
    VALUES (NEW.id, 'driver', 'SDG')
    ON CONFLICT (driver_id) DO NOTHING;
  ELSIF NEW.role = 'merchant'
     AND (TG_OP = 'INSERT' OR OLD.role IS DISTINCT FROM 'merchant') THEN
    INSERT INTO public.wallets (merchant_id, kind, currency)
    VALUES (NEW.id, 'merchant', 'SDG')
    ON CONFLICT (merchant_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$fn$;

INSERT INTO public.wallets (merchant_id, kind, currency)
SELECT p.id, 'merchant', 'SDG'
FROM public.profiles AS p
WHERE p.role = 'merchant'
ON CONFLICT (merchant_id) DO NOTHING;

INSERT INTO public.wallets (kind, currency)
SELECT 'vault', 'SDG'
WHERE NOT EXISTS (
  SELECT 1 FROM public.wallets WHERE kind = 'vault'
);

-- ---------------------------------------------------------------------------
-- Payout requests. Money does not move until an admin runs payout_merchant.
-- ---------------------------------------------------------------------------

CREATE TABLE public.withdrawal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  amount numeric(14, 2) NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT withdrawal_requests_amount_positive CHECK (amount > 0),
  CONSTRAINT withdrawal_requests_status_check CHECK (
    status IN ('pending', 'paid', 'rejected')
  )
);

CREATE UNIQUE INDEX withdrawal_requests_one_open_idx
  ON public.withdrawal_requests (merchant_id)
  WHERE status = 'pending';

CREATE INDEX withdrawal_requests_merchant_id_idx
  ON public.withdrawal_requests (merchant_id);

COMMENT ON TABLE public.withdrawal_requests IS
  'Merchant payout request. Pending does not change the wallet. payout_merchant marks it paid and debits the balance.';

ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY withdrawal_requests_admin_select
  ON public.withdrawal_requests
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY withdrawal_requests_merchant_select
  ON public.withdrawal_requests
  FOR SELECT
  TO authenticated
  USING (
    merchant_id = auth.uid()
    AND public.current_user_role() = 'merchant'
  );

CREATE POLICY wallets_merchant_select
  ON public.wallets
  FOR SELECT
  TO authenticated
  USING (
    merchant_id = auth.uid()
    AND public.current_user_role() = 'merchant'
  );

CREATE POLICY transactions_merchant_select
  ON public.transactions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.wallets AS w
      WHERE w.id = wallet_id
        AND w.merchant_id = auth.uid()
    )
    AND public.current_user_role() = 'merchant'
  );

-- ---------------------------------------------------------------------------
-- Cash column. Delivery (the driver) and settlement (the admin) are the only
-- non-admin writers, and only while app.trusted_cash_write is on.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_profile_privileges()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_trusted_cash boolean := current_setting('app.trusted_cash_write', true) = 'on';
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
       OR (
         NEW.current_cash_in_hand IS DISTINCT FROM OLD.current_cash_in_hand
         AND NOT v_trusted_cash
       )
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
-- Delivery posting. Same driver entry as 0002, then the merchant ledger:
-- COD credits the product price (تحصيل شحنة) and every delivery debits the
-- shipping fees (خصم رسوم شحن). COD also adds the product price to the
-- driver's cash in hand. One transaction: a failure rolls the driver entry
-- back with the merchant entry.
-- ---------------------------------------------------------------------------

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

  IF v_order.payment_type = 'cod' AND v_order.product_price > 0 THEN
    PERFORM public.ledger_post(
      v_merchant_wallet,
      v_order.id,
      'settlement',
      v_order.product_price,
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

  IF v_order.payment_type = 'cod' AND v_order.product_price > 0 THEN
    IF v_order.product_price > 2000000000 THEN
      RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
    END IF;

    v_cash_add := round(v_order.product_price)::integer;
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
-- Admin: receive the cash a driver is holding. Vault settlement, then zero.
-- The amount is read here. The client cannot name a figure.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.settle_driver_cash(p_driver_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_cash integer;
  v_vault_id uuid;
  v_amount numeric(14, 2);
  v_tx public.transactions;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'rapid:unauthorized' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;
  IF p_driver_id IS NULL THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT current_cash_in_hand
  INTO v_cash
  FROM public.profiles
  WHERE id = p_driver_id
    AND role = 'driver'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'rapid:not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_cash IS NULL OR v_cash <= 0 THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT id
  INTO v_vault_id
  FROM public.wallets
  WHERE kind = 'vault'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  v_amount := v_cash::numeric(14, 2);
  v_tx := public.ledger_post(
    v_vault_id,
    NULL,
    'settlement',
    v_amount,
    'استلام عهدة مندوب'
  );

  PERFORM set_config('app.trusted_cash_write', 'on', true);

  UPDATE public.profiles
  SET current_cash_in_hand = 0
  WHERE id = p_driver_id
    AND role = 'driver';

  RETURN jsonb_build_object(
    'driver_id', p_driver_id,
    'amount', v_amount::numeric(14, 2)::text,
    'transaction_id', v_tx.id,
    'vault_balance', v_tx.balance_after::numeric(14, 2)::text
  );
EXCEPTION
  WHEN check_violation THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Admin: pay the merchant their full available balance.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.payout_merchant(p_merchant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_wallet public.wallets;
  v_tx public.transactions;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'rapid:unauthorized' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;
  IF p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_merchant_id AND role = 'merchant'
  ) THEN
    RAISE EXCEPTION 'rapid:not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_wallet
  FROM public.wallets
  WHERE merchant_id = p_merchant_id
    AND kind = 'merchant'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'rapid:not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_wallet.balance <= 0 THEN
    RAISE EXCEPTION 'rapid:insufficient' USING ERRCODE = 'P0001';
  END IF;

  v_tx := public.ledger_post(
    v_wallet.id,
    NULL,
    'payout',
    -v_wallet.balance,
    'تحويل أرباح للتاجر'
  );

  UPDATE public.withdrawal_requests
  SET status = 'paid'
  WHERE merchant_id = p_merchant_id
    AND status = 'pending';

  RETURN jsonb_build_object(
    'merchant_id', p_merchant_id,
    'amount', (-v_tx.amount)::numeric(14, 2)::text,
    'transaction_id', v_tx.id,
    'balance_after', v_tx.balance_after::numeric(14, 2)::text
  );
EXCEPTION
  WHEN check_violation THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Merchant: ask to withdraw the current balance. Does not move money.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.request_merchant_payout()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_wallet public.wallets;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'rapid:unauthorized' USING ERRCODE = 'P0001';
  END IF;
  IF public.current_user_role() IS DISTINCT FROM 'merchant' THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_wallet
  FROM public.wallets
  WHERE merchant_id = auth.uid()
    AND kind = 'merchant'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'rapid:not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_wallet.balance <= 0 THEN
    RAISE EXCEPTION 'rapid:insufficient' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.withdrawal_requests (merchant_id, amount)
  VALUES (auth.uid(), v_wallet.balance)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'request_id', v_id,
    'amount', v_wallet.balance::numeric(14, 2)::text
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'rapid:conflict' USING ERRCODE = 'P0001';
  WHEN check_violation THEN
    RAISE EXCEPTION 'rapid:invalid' USING ERRCODE = 'P0001';
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.ledger_post(uuid, uuid, public.transaction_type, numeric, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ledger_post(uuid, uuid, public.transaction_type, numeric)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enforce_wallet_driver() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_wallet_balance() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_driver_wallet() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_profile_privileges() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.settle_driver_cash(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.payout_merchant(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_merchant_payout() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.settle_driver_cash(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payout_merchant(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_merchant_payout() TO authenticated;

REVOKE ALL ON TABLE public.withdrawal_requests FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.withdrawal_requests TO authenticated;
