-- Phase 16 — in-app notifications.
--
-- 0013 is merchant support tickets, so this file is 0014.
--
-- Each row belongs to one profile. The signed-in user may read and mark
-- their own rows. Nothing else is writable, and there is no insert policy:
-- rows are created by the order trigger below (or the service role).
-- Pickup and delivery drivers are not notified here; only the merchant is.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  type text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
  CONSTRAINT notifications_title_len CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  CONSTRAINT notifications_message_len CHECK (char_length(btrim(message)) BETWEEN 1 AND 500),
  CONSTRAINT notifications_type_known CHECK (type IN ('order', 'finance', 'system'))
);

CREATE INDEX notifications_user_created_idx
  ON public.notifications (user_id, created_at DESC);

CREATE INDEX notifications_user_unread_idx
  ON public.notifications (user_id, created_at DESC)
  WHERE NOT is_read;

COMMENT ON TABLE public.notifications IS
  'In-app notifications. A user reads and marks only their own rows. Inserts come from trusted server paths.';

-- ---------------------------------------------------------------------------
-- A user may flip is_read on their own row. Title, body, type, and owner stay fixed.
-- A missing auth.uid() is the SQL editor or the service role.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.message IS DISTINCT FROM OLD.message
     OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'rapid:immutable' USING ERRCODE = 'P0001';
  END IF;

  IF auth.uid() IS NOT NULL AND NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS notifications_guard ON public.notifications;
CREATE TRIGGER notifications_guard
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_notification();

-- ---------------------------------------------------------------------------
-- Merchant notice when a shipment is delivered or returned.
-- SECURITY DEFINER so the insert succeeds while a driver or admin is the
-- session user. auth.uid() is still that user; the row owner is merchant_id.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_merchant_order_outcome()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_title text;
  v_message text;
BEGIN
  IF TG_OP <> 'UPDATE' OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status::text = 'delivered' THEN
    v_title := 'تم تسليم الشحنة';
    v_message := 'تم تسليم الشحنة ' || NEW.tracking_code;
  ELSIF NEW.status::text = 'returned' THEN
    v_title := 'تم إرجاع الشحنة';
    v_message := 'تم إرجاع الشحنة ' || NEW.tracking_code;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, title, message, type)
  VALUES (NEW.merchant_id, v_title, v_message, 'order');

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS orders_notify_merchant_outcome ON public.orders;
CREATE TRIGGER orders_notify_merchant_outcome
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_merchant_order_outcome();

-- ---------------------------------------------------------------------------
-- Row level security. Deny by default: no policy means no access.
-- ---------------------------------------------------------------------------

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_select_own
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY notifications_update_own
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

REVOKE ALL ON TABLE public.notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.notifications TO authenticated;
GRANT UPDATE (is_read) ON TABLE public.notifications TO authenticated;

REVOKE ALL ON FUNCTION public.guard_notification() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_merchant_order_outcome() FROM PUBLIC, anon, authenticated;
