-- Phase 7 — Merchant Settings Hub.
--
-- Adds brand fields and a JSONB preferences bag to public.profiles so the
-- merchant Settings Hub can store shipping and AWB (label) choices without a
-- column per toggle.
--
--   logo_url, website_url   optional https links
--   business_category       a lowercase slug (the app owns the label list)
--   preferences             { awb_format, auto_print, whatsapp_notifications,
--                             default_deposit }
--
-- Additive and re-runnable: every column uses IF NOT EXISTS and every
-- constraint / trigger is dropped-then-created or guarded, so applying this
-- twice changes nothing. No existing column, policy, or grant is altered.
-- Writes keep going through the existing profiles_update_own RLS policy and
-- table-level UPDATE grant; the trigger at the end only narrows who may use
-- the new merchant columns.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS website_url text,
  ADD COLUMN IF NOT EXISTS business_category text,
  ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.profiles.logo_url IS
  'Merchant logo, https URL. Printed on the AWB when set.';
COMMENT ON COLUMN public.profiles.website_url IS
  'Merchant website, https URL.';
COMMENT ON COLUMN public.profiles.business_category IS
  'Merchant business category slug (electronics, fashion, books, ...). The app maps slugs to Arabic labels.';
COMMENT ON COLUMN public.profiles.preferences IS
  'Merchant UI and shipping preferences: awb_format (a6 | a4), auto_print (bool), whatsapp_notifications (bool), default_deposit (number >= 0).';

-- ---------------------------------------------------------------------------
-- Validation
-- ---------------------------------------------------------------------------

-- Known keys must have the right type; unknown keys are tolerated so a newer
-- app version can write a key an older database check does not know about yet.
-- CASE keeps each cast behind its own type test.
CREATE OR REPLACE FUNCTION public.merchant_preferences_valid(p jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    jsonb_typeof(p) = 'object'
    AND octet_length(p::text) <= 4096
    AND CASE
      WHEN p -> 'awb_format' IS NULL THEN true
      ELSE jsonb_typeof(p -> 'awb_format') = 'string'
        AND (p ->> 'awb_format') IN ('a6', 'a4')
    END
    AND CASE
      WHEN p -> 'auto_print' IS NULL THEN true
      ELSE jsonb_typeof(p -> 'auto_print') = 'boolean'
    END
    AND CASE
      WHEN p -> 'whatsapp_notifications' IS NULL THEN true
      ELSE jsonb_typeof(p -> 'whatsapp_notifications') = 'boolean'
    END
    AND CASE
      WHEN p -> 'default_deposit' IS NULL THEN true
      WHEN jsonb_typeof(p -> 'default_deposit') <> 'number' THEN false
      ELSE (p ->> 'default_deposit')::numeric BETWEEN 0 AND 999999999.99
    END
$$;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_logo_url_shape,
  DROP CONSTRAINT IF EXISTS profiles_website_url_shape,
  DROP CONSTRAINT IF EXISTS profiles_business_category_shape,
  DROP CONSTRAINT IF EXISTS profiles_preferences_valid;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_logo_url_shape CHECK (
    logo_url IS NULL
    OR (char_length(logo_url) <= 2048 AND logo_url ~* '^https://[^\s/?#]+[^\s]*$')
  ),
  ADD CONSTRAINT profiles_website_url_shape CHECK (
    website_url IS NULL
    OR (char_length(website_url) <= 2048 AND website_url ~* '^https?://[^\s/?#]+[^\s]*$')
  ),
  ADD CONSTRAINT profiles_business_category_shape CHECK (
    business_category IS NULL
    OR business_category ~ '^[a-z][a-z0-9_]{0,39}$'
  ),
  ADD CONSTRAINT profiles_preferences_valid CHECK (
    public.merchant_preferences_valid(preferences)
  );

-- ---------------------------------------------------------------------------
-- Role guard. Table-level UPDATE is granted to every signed-in role (own row
-- only, by RLS), so a customer or driver could otherwise fill merchant
-- settings. Only a merchant, or an admin, may change the Phase 7 columns.
-- auth.uid() is null for the service role and the SQL editor; those are
-- trusted back-office paths and pass.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_merchant_profile_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NEW.role <> 'merchant'
     AND NOT public.is_admin()
     AND (
       NEW.logo_url IS DISTINCT FROM OLD.logo_url
       OR NEW.website_url IS DISTINCT FROM OLD.website_url
       OR NEW.business_category IS DISTINCT FROM OLD.business_category
       OR NEW.preferences IS DISTINCT FROM OLD.preferences
     ) THEN
    RAISE EXCEPTION 'only a merchant can change merchant settings';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_merchant_fields ON public.profiles;
CREATE TRIGGER profiles_guard_merchant_fields
  BEFORE UPDATE OF logo_url, website_url, business_category, preferences
  ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_merchant_profile_fields();
