-- Phase 14.1 — merchant support tickets.
--
-- 0012 is admin exception review, so this file is 0013.
--
-- A merchant opens a ticket for their own profile. An admin reads every
-- ticket and is the only role that can move status. Subject, description,
-- and the merchant stay fixed after insert. There is no delete policy.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

CREATE TABLE public.support_tickets (
  ticket_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL,
  subject text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_tickets_merchant_id_fkey
    FOREIGN KEY (merchant_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
  CONSTRAINT support_tickets_subject_len CHECK (char_length(btrim(subject)) BETWEEN 1 AND 160),
  CONSTRAINT support_tickets_description_len CHECK (char_length(btrim(description)) BETWEEN 1 AND 4000),
  CONSTRAINT support_tickets_status_known CHECK (
    status IN ('open', 'in_progress', 'resolved')
  )
);

CREATE INDEX support_tickets_merchant_idx
  ON public.support_tickets (merchant_id, created_at DESC);

CREATE INDEX support_tickets_queue_idx
  ON public.support_tickets (status, created_at DESC);

COMMENT ON TABLE public.support_tickets IS
  'Merchant support tickets. Merchants insert their own rows as open. Admins update status only.';

-- ---------------------------------------------------------------------------
-- Guards. The session role is read inside the database, never from the payload.
-- A missing auth.uid() is the SQL editor or the service role.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_support_ticket()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_role public.user_role;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT role
    INTO v_role
    FROM public.profiles
    WHERE id = NEW.merchant_id
      AND is_active;

    IF v_role IS DISTINCT FROM 'merchant' THEN
      RAISE EXCEPTION 'rapid:not_a_merchant' USING ERRCODE = 'P0001';
    END IF;

    IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
      IF NEW.merchant_id IS DISTINCT FROM auth.uid() OR NEW.status IS DISTINCT FROM 'open' THEN
        RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
      END IF;
    END IF;
    NEW.subject := btrim(NEW.subject);
    NEW.description := btrim(NEW.description);
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.ticket_id IS DISTINCT FROM OLD.ticket_id
     OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
     OR NEW.subject IS DISTINCT FROM OLD.subject
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'rapid:immutable' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND auth.uid() IS NOT NULL
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'rapid:forbidden' USING ERRCODE = 'P0001';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS support_tickets_guard ON public.support_tickets;
CREATE TRIGGER support_tickets_guard
  BEFORE INSERT OR UPDATE ON public.support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_support_ticket();

-- ---------------------------------------------------------------------------
-- Row level security. Deny by default: no policy means no access.
-- ---------------------------------------------------------------------------

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY support_tickets_merchant_select
  ON public.support_tickets
  FOR SELECT
  TO authenticated
  USING (merchant_id = auth.uid());

CREATE POLICY support_tickets_admin_select
  ON public.support_tickets
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY support_tickets_merchant_insert
  ON public.support_tickets
  FOR INSERT
  TO authenticated
  WITH CHECK (
    merchant_id = auth.uid()
    AND status = 'open'
    AND EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role = 'merchant'
        AND is_active
    )
  );

CREATE POLICY support_tickets_admin_update
  ON public.support_tickets
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

REVOKE ALL ON TABLE public.support_tickets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.support_tickets TO authenticated;
GRANT UPDATE (status, updated_at) ON TABLE public.support_tickets TO authenticated;

REVOKE ALL ON FUNCTION public.guard_support_ticket() FROM PUBLIC, anon, authenticated;
