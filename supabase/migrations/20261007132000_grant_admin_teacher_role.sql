-- The owner admin account also teaches. is_school_staff already treats admin as staff;
-- this records the teacher role on that account explicitly.
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'teacher'::public.app_role
FROM auth.users u
WHERE lower(u.email) = 'chenziyanyiyi@qq.com'
ON CONFLICT (user_id, role) DO NOTHING;
