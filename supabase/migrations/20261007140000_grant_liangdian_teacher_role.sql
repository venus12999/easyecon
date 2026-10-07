-- Grant the teacher console to this account. is_school_staff reads user_roles.
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'teacher'::public.app_role
FROM auth.users u
WHERE lower(u.email) = 'liangdian666888@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;
