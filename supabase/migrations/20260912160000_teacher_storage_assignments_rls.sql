-- Teacher PDF page/crop uploads from a user JWT (local Vite has no service role).
-- Admin JWT can promote a school paper onto an official mock slug.

GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT INSERT, UPDATE ON storage.objects TO authenticated;
GRANT UPDATE, DELETE ON public.mock_papers TO authenticated;
GRANT UPDATE, DELETE ON public.paper_questions TO authenticated;
GRANT UPDATE, DELETE ON public.paper_frqs TO authenticated;
GRANT UPDATE, DELETE ON public.questions TO authenticated;

DROP POLICY IF EXISTS "School staff upload exam images" ON storage.objects;
CREATE POLICY "School staff upload exam images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'question-images'
  AND split_part(name, '/', 1) = 'assignments'
  AND (
    public.is_school_staff(auth.uid())
    OR EXISTS (SELECT 1 FROM public.school_classes c WHERE c.teacher_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.role = 'admin')
  )
);

DROP POLICY IF EXISTS "School staff update exam images" ON storage.objects;
CREATE POLICY "School staff update exam images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'question-images'
  AND split_part(name, '/', 1) = 'assignments'
  AND (
    public.is_school_staff(auth.uid())
    OR EXISTS (SELECT 1 FROM public.school_classes c WHERE c.teacher_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.role = 'admin')
  )
)
WITH CHECK (
  bucket_id = 'question-images'
  AND split_part(name, '/', 1) = 'assignments'
  AND (
    public.is_school_staff(auth.uid())
    OR EXISTS (SELECT 1 FROM public.school_classes c WHERE c.teacher_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.role = 'admin')
  )
);

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'admin'::public.app_role
FROM auth.users u
WHERE lower(u.email) = 'chenziyanyiyi@qq.com'
ON CONFLICT (user_id, role) DO NOTHING;

DROP POLICY IF EXISTS admin_update_mock_papers ON public.mock_papers;
CREATE POLICY admin_update_mock_papers ON public.mock_papers
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.role = 'admin'));

DROP POLICY IF EXISTS admin_delete_paper_questions ON public.paper_questions;
CREATE POLICY admin_delete_paper_questions ON public.paper_questions
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.role = 'admin'));

DROP POLICY IF EXISTS admin_delete_paper_frqs ON public.paper_frqs;
CREATE POLICY admin_delete_paper_frqs ON public.paper_frqs
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.role = 'admin'));

DROP POLICY IF EXISTS admin_update_paper_frqs ON public.paper_frqs;
CREATE POLICY admin_update_paper_frqs ON public.paper_frqs
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.role = 'admin'));

DROP POLICY IF EXISTS admin_update_questions ON public.questions;
CREATE POLICY admin_update_questions ON public.questions
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.role = 'admin'));

DROP POLICY IF EXISTS admin_delete_questions ON public.questions;
CREATE POLICY admin_delete_questions ON public.questions
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.role = 'admin'));
