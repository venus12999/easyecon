-- Upsert of assignment crops needs SELECT on storage.objects.
GRANT SELECT ON storage.objects TO authenticated;

DROP POLICY IF EXISTS "School staff read exam images" ON storage.objects;
CREATE POLICY "School staff read exam images"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'question-images'
  AND split_part(name, '/', 1) = 'assignments'
  AND (
    public.is_school_staff(auth.uid())
    OR EXISTS (SELECT 1 FROM public.school_classes c WHERE c.teacher_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND r.role = 'admin')
  )
);
