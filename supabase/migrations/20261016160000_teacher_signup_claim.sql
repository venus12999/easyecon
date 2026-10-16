-- Teacher signup must keep the role even if the earlier trigger was not deployed.
-- account_role is read once, at insert time, before the user can edit their own metadata.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  chosen_role text := lower(coalesce(NEW.raw_user_meta_data->>'account_role', ''));
  chosen_name text := NULLIF(btrim(coalesce(NEW.raw_user_meta_data->>'display_name', '')), '');
BEGIN
  INSERT INTO public.profiles (user_id, email, display_name)
  VALUES (NEW.id, NEW.email, chosen_name)
  ON CONFLICT (user_id) DO UPDATE
  SET display_name = COALESCE(public.profiles.display_name, EXCLUDED.display_name),
      email = EXCLUDED.email;

  IF chosen_role = 'teacher' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'teacher'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Repair accounts that already chose 教师 while the old trigger was still live.
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'teacher'::public.app_role
FROM auth.users u
WHERE lower(coalesce(u.raw_user_meta_data->>'account_role', '')) = 'teacher'
ON CONFLICT (user_id, role) DO NOTHING;

UPDATE public.profiles p
SET display_name = NULLIF(btrim(coalesce(u.raw_user_meta_data->>'display_name', '')), '')
FROM auth.users u
WHERE p.user_id = u.id
  AND p.display_name IS NULL
  AND NULLIF(btrim(coalesce(u.raw_user_meta_data->>'display_name', '')), '') IS NOT NULL;

DROP POLICY IF EXISTS profiles_staff_read_roster ON public.profiles;
CREATE POLICY profiles_staff_read_roster ON public.profiles
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.school_roster r
      JOIN public.school_classes c ON c.id = r.class_id
      WHERE r.user_id = profiles.user_id
        AND c.teacher_user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
    )
  );
