-- =====================================================
-- Migration: Fix Recursive RLS Policies
-- Problem: Policies on profiles/service_requests/request_events
--          use EXISTS subqueries on profiles table, causing infinite recursion
-- Solution: Create SECURITY DEFINER helper functions to check roles
-- =====================================================

-- =====================================================
-- 1. Create helper function to get current user's role
--    Uses SECURITY DEFINER to bypass RLS
-- =====================================================
CREATE OR REPLACE FUNCTION auth_user_role()
RETURNS user_role AS $$
DECLARE
  v_role user_role;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  RETURN v_role;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION auth_user_role() TO authenticated;

-- =====================================================
-- 2. Create helper functions for role checks
-- =====================================================
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean AS $$
BEGIN
  RETURN auth_user_role() = 'ADMIN';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_mop()
RETURNS boolean AS $$
BEGIN
  RETURN auth_user_role() = 'MOP';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_operator()
RETURNS boolean AS $$
BEGIN
  RETURN auth_user_role() = 'OPERATOR';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION is_mop() TO authenticated;
GRANT EXECUTE ON FUNCTION is_operator() TO authenticated;

-- =====================================================
-- 3. Drop old recursive policies on profiles
-- =====================================================
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON profiles;
DROP POLICY IF EXISTS "MOP can view profiles" ON profiles;
DROP POLICY IF EXISTS "Operators can view assigned user profiles" ON profiles;

-- =====================================================
-- 4. Create new non-recursive policies on profiles
-- =====================================================

-- Admins can view all profiles (non-recursive)
CREATE POLICY "Admins can view all profiles"
  ON profiles FOR SELECT
  USING (is_admin());

-- Admins can update all profiles (non-recursive)
CREATE POLICY "Admins can update all profiles"
  ON profiles FOR UPDATE
  USING (is_admin());

-- MOP can view all profiles (non-recursive)
CREATE POLICY "MOP can view profiles"
  ON profiles FOR SELECT
  USING (is_mop());

-- Operators can view profiles of users in their assigned requests
CREATE POLICY "Operators can view assigned user profiles"
  ON profiles FOR SELECT
  USING (
    is_operator()
    AND EXISTS (
      SELECT 1 FROM service_requests sr
      WHERE sr.user_id = profiles.id
        AND sr.operator_id = auth.uid()
    )
  );

-- =====================================================
-- 5. Fix policies on pricing_rules
-- =====================================================
DROP POLICY IF EXISTS "Admins can manage pricing rules" ON pricing_rules;
DROP POLICY IF EXISTS "MOP can view all pricing rules" ON pricing_rules;

CREATE POLICY "Admins can manage pricing rules"
  ON pricing_rules FOR ALL
  USING (is_admin());

CREATE POLICY "MOP can view all pricing rules"
  ON pricing_rules FOR SELECT
  USING (is_mop());

-- =====================================================
-- 6. Fix policies on service_requests
-- =====================================================
DROP POLICY IF EXISTS "Admins can manage all requests" ON service_requests;
DROP POLICY IF EXISTS "MOP can view all requests" ON service_requests;
DROP POLICY IF EXISTS "Operators can view available requests" ON service_requests;

CREATE POLICY "Admins can manage all requests"
  ON service_requests FOR ALL
  USING (is_admin());

CREATE POLICY "MOP can view all requests"
  ON service_requests FOR SELECT
  USING (is_mop());

CREATE POLICY "Operators can view available requests"
  ON service_requests FOR SELECT
  USING (
    status = 'initiated'
    AND is_operator()
  );

-- =====================================================
-- 7. Fix policies on request_events
-- =====================================================
DROP POLICY IF EXISTS "Admins can view all events" ON request_events;
DROP POLICY IF EXISTS "MOP can view all events" ON request_events;

CREATE POLICY "Admins can view all events"
  ON request_events FOR SELECT
  USING (is_admin());

CREATE POLICY "MOP can view all events"
  ON request_events FOR SELECT
  USING (is_mop());

-- =====================================================
-- 8. Fix policies on providers table
-- =====================================================
DROP POLICY IF EXISTS "Admins can manage providers" ON providers;
DROP POLICY IF EXISTS "Everyone can view active providers" ON providers;

CREATE POLICY "Admins can manage providers"
  ON providers FOR ALL
  USING (is_admin());

CREATE POLICY "Everyone can view active providers"
  ON providers FOR SELECT
  USING (is_active = true);

CREATE POLICY "MOP can view all providers"
  ON providers FOR SELECT
  USING (is_mop());

-- =====================================================
-- 9. Add email column to profiles if not exists
--    (needed for admin users page to show email)
-- =====================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'email'
  ) THEN
    ALTER TABLE profiles ADD COLUMN email TEXT;
  END IF;
END $$;

-- Populate email from auth.users for existing profiles
UPDATE profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id AND p.email IS NULL;

-- =====================================================
-- 10. Update admin_update_user_role to support provider_id
-- =====================================================
CREATE OR REPLACE FUNCTION admin_update_user_role(
  p_user_id UUID,
  p_new_role user_role,
  p_provider_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_profile profiles;
BEGIN
  -- Verify caller is admin using helper function
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can update user roles';
  END IF;

  -- Prevent admin from changing own role
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot change your own role';
  END IF;

  -- Validate: if role is OPERATOR, provider_id should be provided
  IF p_new_role = 'OPERATOR' AND p_provider_id IS NULL THEN
    RAISE NOTICE 'Warning: Operator without provider assignment';
  END IF;

  -- If role is not OPERATOR, clear provider_id
  IF p_new_role != 'OPERATOR' THEN
    p_provider_id := NULL;
  END IF;

  -- Update the role and provider_id
  UPDATE profiles
  SET
    role = p_new_role,
    provider_id = p_provider_id,
    updated_at = NOW()
  WHERE id = p_user_id
  RETURNING * INTO v_profile;

  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'new_role', p_new_role,
    'provider_id', p_provider_id,
    'full_name', v_profile.full_name
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute
GRANT EXECUTE ON FUNCTION admin_update_user_role(UUID, user_role, UUID) TO authenticated;

-- =====================================================
-- 11. Create function to sync profile email from auth.users
--     (trigger on auth.users update)
-- =====================================================
CREATE OR REPLACE FUNCTION sync_profile_email()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE profiles
  SET email = NEW.email
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_email_updated'
  ) THEN
    CREATE TRIGGER on_auth_user_email_updated
      AFTER UPDATE OF email ON auth.users
      FOR EACH ROW EXECUTE FUNCTION sync_profile_email();
  END IF;
END $$;

-- =====================================================
-- 12. Update handle_new_user to include email
-- =====================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone, role, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'USER'),
    NEW.email
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
