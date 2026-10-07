-- Choosing 教师 at signup stores account_role on the new auth user.
-- Grant the teacher role in the same insert, before the user can change their metadata.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (user_id) DO NOTHING;

  IF lower(coalesce(NEW.raw_user_meta_data->>'account_role', '')) = 'teacher' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'teacher'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
