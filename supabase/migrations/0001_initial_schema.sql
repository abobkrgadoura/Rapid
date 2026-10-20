-- Rapid Logistics — initial schema
--
-- Auth credentials stay in auth.users. public.profiles is the app user,
-- keyed by that id. One wallet per driver. Every balance change is posted
-- through public.apply_wallet_entry, which inserts the transactions row
-- and updates the wallet in the same operation.
--
-- Wallet sign: positive means the platform owes the driver; negative means
-- the driver owes the platform.
--
-- order_status uses the Phase 2 states. `pending` is the pre-assignment
-- state (plan.md calls this "created") and `in_transit` is the leg after
-- pickup from the architecture plan.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE public.user_role AS ENUM (
  'admin',
  'merchant',
  'driver',
  'customer'
);

CREATE TYPE public.employment_type AS ENUM (
  'freelance',
  'in_house'
);

CREATE TYPE public.order_status AS ENUM (
  'pending',
  'assigned',
  'picked_up',
  'in_transit',
  'delivered',
  'cancelled'
);

CREATE TYPE public.payment_type AS ENUM (
  'cod',
  'prepaid'
);

CREATE TYPE public.transaction_type AS ENUM (
  'cod_debt',
  'prepaid_earning',
  'settlement',
  'payout',
  'adjustment'
);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  role public.user_role NOT NULL DEFAULT 'customer',
  employment_type public.employment_type,
  full_name text,
  phone text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_email_key UNIQUE (email),
  CONSTRAINT profiles_employment_type_drivers_only CHECK (
    employment_type IS NULL OR role = 'driver'
  )
);

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_code text NOT NULL UNIQUE DEFAULT (
    'RP' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
  ),
  merchant_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  customer_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  driver_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  status public.order_status NOT NULL DEFAULT 'pending',
  payment_type public.payment_type NOT NULL,
  product_price numeric(12, 2) NOT NULL,
  delivery_fee numeric(12, 2) NOT NULL,
  platform_commission numeric(12, 2) NOT NULL,
  pickup_address text NOT NULL,
  dropoff_address text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_product_price_nonnegative CHECK (product_price >= 0),
  CONSTRAINT orders_delivery_fee_nonnegative CHECK (delivery_fee >= 0),
  CONSTRAINT orders_platform_commission_nonnegative CHECK (platform_commission >= 0),
  CONSTRAINT orders_commission_within_delivery_fee CHECK (
    platform_commission <= delivery_fee
  ),
  CONSTRAINT orders_driver_not_merchant CHECK (driver_id IS DISTINCT FROM merchant_id),
  CONSTRAINT orders_assigned_requires_driver CHECK (
    status IN ('pending', 'cancelled') OR driver_id IS NOT NULL
  )
);

CREATE TABLE public.wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL UNIQUE REFERENCES public.profiles (id) ON DELETE RESTRICT,
  balance numeric(14, 2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'EGP',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallets_currency_code CHECK (char_length(currency) = 3)
);

CREATE TABLE public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES public.wallets (id) ON DELETE RESTRICT,
  order_id uuid REFERENCES public.orders (id) ON DELETE RESTRICT,
  type public.transaction_type NOT NULL,
  amount numeric(14, 2) NOT NULL,
  balance_after numeric(14, 2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transactions_amount_nonzero CHECK (amount <> 0),
  CONSTRAINT transactions_amount_sign CHECK (
    (type = 'cod_debt' AND amount < 0)
    OR (type = 'prepaid_earning' AND amount > 0)
    OR (type = 'settlement' AND amount > 0)
    OR (type = 'payout' AND amount < 0)
    OR (type = 'adjustment')
  ),
  CONSTRAINT transactions_order_link CHECK (
    (type IN ('cod_debt', 'prepaid_earning') AND order_id IS NOT NULL)
    OR (type IN ('settlement', 'payout', 'adjustment'))
  )
);

CREATE INDEX orders_merchant_id_idx ON public.orders (merchant_id);
CREATE INDEX orders_customer_id_idx ON public.orders (customer_id);
CREATE INDEX orders_driver_id_idx ON public.orders (driver_id);
CREATE INDEX orders_status_idx ON public.orders (status);
CREATE INDEX transactions_wallet_id_idx ON public.transactions (wallet_id);
CREATE INDEX transactions_order_id_idx ON public.transactions (order_id);
CREATE INDEX profiles_role_idx ON public.profiles (role);

-- One COD debt and one prepaid earning per order. Settlements, payouts, and
-- adjustments may repeat and may omit order_id.
CREATE UNIQUE INDEX transactions_one_order_posting_idx
  ON public.transactions (order_id, type)
  WHERE type IN ('cod_debt', 'prepaid_earning');

COMMENT ON TABLE public.profiles IS
  'App user. id matches auth.users. Role is resolved from this row, never from a client field.';
COMMENT ON COLUMN public.wallets.balance IS
  'Signed. Positive: platform owes the driver. Negative: driver owes the platform.';
COMMENT ON COLUMN public.transactions.amount IS
  'Signed balance change. COD debt and payouts are negative; prepaid earnings and settlements are positive.';
COMMENT ON COLUMN public.transactions.balance_after IS
  'Wallet balance immediately after this row was posted.';

-- ---------------------------------------------------------------------------
-- Helpers used by RLS. SECURITY DEFINER so policies can read role without
-- recursing through profiles RLS. Both functions only describe the caller.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.profiles
  WHERE id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

-- ---------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_profile_privileges()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role <> 'driver' THEN
    NEW.employment_type := NULL;
  END IF;

  IF TG_OP = 'UPDATE' AND NOT public.is_admin() THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.employment_type IS DISTINCT FROM OLD.employment_type
       OR NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'only an admin can change role or employment type';
    END IF;

    -- Auth is the source of truth for email. The auth.users trigger may copy
    -- a confirmed change; a direct profile update may not invent one.
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
$$;

CREATE TRIGGER profiles_protect_privileges
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_privileges();

CREATE OR REPLACE FUNCTION public.enforce_order_role_refs()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_role public.user_role;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id THEN
    SELECT role INTO v_role FROM public.profiles WHERE id = NEW.merchant_id;
    IF v_role IS DISTINCT FROM 'merchant' THEN
      RAISE EXCEPTION 'merchant_id must reference a merchant profile';
    END IF;
  END IF;

  IF NEW.customer_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.customer_id IS DISTINCT FROM OLD.customer_id) THEN
    SELECT role INTO v_role FROM public.profiles WHERE id = NEW.customer_id;
    IF v_role IS DISTINCT FROM 'customer' THEN
      RAISE EXCEPTION 'customer_id must reference a customer profile';
    END IF;
  END IF;

  IF NEW.driver_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.driver_id IS DISTINCT FROM OLD.driver_id) THEN
    SELECT role INTO v_role FROM public.profiles WHERE id = NEW.driver_id;
    IF v_role IS DISTINCT FROM 'driver' THEN
      RAISE EXCEPTION 'driver_id must reference a driver profile';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_enforce_role_refs
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_order_role_refs();

CREATE OR REPLACE FUNCTION public.enforce_wallet_driver()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_role public.user_role;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = NEW.driver_id;
  IF v_role IS DISTINCT FROM 'driver' THEN
    RAISE EXCEPTION 'wallets belong only to driver profiles';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER wallets_driver_only
  BEFORE INSERT ON public.wallets
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_wallet_driver();

-- Balance changes and ledger inserts are rejected unless apply_wallet_entry
-- set the transaction-local flag. Admins still have table policies; the
-- trigger is what keeps the wallet and the ledger in the same operation.
CREATE OR REPLACE FUNCTION public.guard_wallet_balance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
    RAISE EXCEPTION 'wallet driver_id is immutable';
  END IF;

  IF NEW.balance IS DISTINCT FROM OLD.balance
     AND current_setting('app.wallet_ledger', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'wallet balance can only change inside public.apply_wallet_entry';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER wallets_guard_balance
  BEFORE UPDATE ON public.wallets
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_wallet_balance();

CREATE OR REPLACE FUNCTION public.guard_transaction_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_balance numeric(14, 2);
BEGIN
  IF current_setting('app.wallet_ledger', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'transactions can only be inserted by public.apply_wallet_entry';
  END IF;

  SELECT balance
  INTO v_balance
  FROM public.wallets
  WHERE id = NEW.wallet_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'wallet not found';
  END IF;

  IF NEW.balance_after IS DISTINCT FROM v_balance + NEW.amount THEN
    RAISE EXCEPTION 'balance_after must equal the wallet balance plus amount';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER transactions_guard_insert
  BEFORE INSERT ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_transaction_insert();

CREATE OR REPLACE FUNCTION public.prevent_transaction_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'transactions are append-only';
END;
$$;

CREATE TRIGGER transactions_append_only
  BEFORE UPDATE OR DELETE ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_transaction_mutation();

-- ---------------------------------------------------------------------------
-- Signup: profile row for every auth user, wallet when the role is driver.
-- Self-serve metadata may claim merchant, driver, or customer. An admin
-- claim is ignored. Promote the platform owner afterwards:
--   UPDATE public.profiles
--   SET role = 'admin', employment_type = NULL
--   WHERE id = '<auth user uuid>';
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role_text text;
  v_role public.user_role;
  v_employment_text text;
  v_employment public.employment_type;
BEGIN
  v_role_text := lower(coalesce(NEW.raw_user_meta_data ->> 'role', 'customer'));

  IF v_role_text IN ('merchant', 'driver', 'customer') THEN
    v_role := v_role_text::public.user_role;
  ELSE
    v_role := 'customer';
  END IF;

  v_employment := NULL;
  IF v_role = 'driver' THEN
    v_employment_text := lower(coalesce(NEW.raw_user_meta_data ->> 'employment_type', ''));
    IF v_employment_text IN ('freelance', 'in_house') THEN
      v_employment := v_employment_text::public.employment_type;
    END IF;
  END IF;

  INSERT INTO public.profiles (id, role, employment_type, full_name, phone, email)
  VALUES (
    NEW.id,
    v_role,
    v_employment,
    coalesce(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name'),
    coalesce(NEW.phone, NEW.raw_user_meta_data ->> 'phone'),
    NEW.email
  );

  IF v_role = 'driver' THEN
    INSERT INTO public.wallets (driver_id)
    VALUES (NEW.id)
    ON CONFLICT (driver_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.handle_user_email_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.profiles
    SET email = NEW.email
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_email_updated
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_user_email_change();

-- An admin may later promote a profile to driver. That promotion still needs
-- the one wallet the ledger assumes.
CREATE OR REPLACE FUNCTION public.ensure_driver_wallet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'driver'
     AND (TG_OP = 'INSERT' OR OLD.role IS DISTINCT FROM 'driver') THEN
    INSERT INTO public.wallets (driver_id)
    VALUES (NEW.id)
    ON CONFLICT (driver_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_ensure_driver_wallet
  AFTER INSERT OR UPDATE OF role ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_driver_wallet();

-- ---------------------------------------------------------------------------
-- Ledger write path. Caller must be an admin (user JWT) or the service role.
-- ---------------------------------------------------------------------------

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
AS $$
DECLARE
  v_wallet public.wallets;
  v_order_driver uuid;
  v_new_balance numeric(14, 2);
  v_tx public.transactions;
BEGIN
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'service_role'
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'only an admin can post wallet entries';
  END IF;

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
$$;

-- Supabase grants EXECUTE on new public functions to anon and authenticated.
-- Strip those grants, then re-grant only the functions clients may call.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_user_email_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_driver_wallet() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_profile_privileges() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_order_role_refs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_wallet_driver() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_wallet_balance() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_transaction_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_transaction_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_wallet_entry(uuid, uuid, public.transaction_type, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_admin() FROM anon;
REVOKE ALL ON FUNCTION public.current_user_role() FROM anon;

GRANT EXECUTE ON FUNCTION public.apply_wallet_entry(uuid, uuid, public.transaction_type, numeric)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Public tracking. Anonymous callers learn status only, looked up by code.
-- SECURITY DEFINER reads past RLS; the return list is the public surface.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.track_order(p_tracking_code text)
RETURNS TABLE (
  tracking_code text,
  status public.order_status,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.tracking_code, o.status, o.created_at
  FROM public.orders AS o
  WHERE o.tracking_code = p_tracking_code;
$$;

REVOKE ALL ON FUNCTION public.track_order(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_order(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Grants. RLS is the real gate. anon has no table privileges; the tracking
-- function is the only anonymous read path.
-- ---------------------------------------------------------------------------

REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.orders FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.wallets FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.transactions FROM PUBLIC, anon;

GRANT SELECT, UPDATE, DELETE ON TABLE public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.orders TO authenticated;
-- Wallet and transaction writes go through apply_wallet_entry (table owner),
-- which bypasses these grants and still posts both rows together.
GRANT SELECT ON TABLE public.wallets TO authenticated;
GRANT SELECT ON TABLE public.transactions TO authenticated;

GRANT USAGE ON TYPE public.user_role TO authenticated;
GRANT USAGE ON TYPE public.employment_type TO authenticated;
GRANT USAGE ON TYPE public.order_status TO anon, authenticated;
GRANT USAGE ON TYPE public.payment_type TO authenticated;
GRANT USAGE ON TYPE public.transaction_type TO authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security. No policy means deny.
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_select_own
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY profiles_select_admin
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY profiles_update_own
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY profiles_update_admin
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY profiles_delete_admin
  ON public.profiles
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

CREATE POLICY orders_admin_all
  ON public.orders
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY orders_merchant_select
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (
    merchant_id = auth.uid()
    AND public.current_user_role() = 'merchant'
  );

CREATE POLICY orders_merchant_insert
  ON public.orders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    merchant_id = auth.uid()
    AND public.current_user_role() = 'merchant'
  );

CREATE POLICY orders_merchant_update
  ON public.orders
  FOR UPDATE
  TO authenticated
  USING (
    merchant_id = auth.uid()
    AND public.current_user_role() = 'merchant'
  )
  WITH CHECK (
    merchant_id = auth.uid()
    AND public.current_user_role() = 'merchant'
  );

CREATE POLICY orders_merchant_delete
  ON public.orders
  FOR DELETE
  TO authenticated
  USING (
    merchant_id = auth.uid()
    AND public.current_user_role() = 'merchant'
  );

CREATE POLICY orders_driver_select
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (
    driver_id = auth.uid()
    AND public.current_user_role() = 'driver'
  );

CREATE POLICY orders_customer_select
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (
    customer_id = auth.uid()
    AND public.current_user_role() = 'customer'
  );

CREATE POLICY wallets_admin_select
  ON public.wallets
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY wallets_driver_select
  ON public.wallets
  FOR SELECT
  TO authenticated
  USING (
    driver_id = auth.uid()
    AND public.current_user_role() = 'driver'
  );

CREATE POLICY transactions_admin_select
  ON public.transactions
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY transactions_driver_select
  ON public.transactions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.wallets AS w
      WHERE w.id = wallet_id
        AND w.driver_id = auth.uid()
    )
    AND public.current_user_role() = 'driver'
  );
