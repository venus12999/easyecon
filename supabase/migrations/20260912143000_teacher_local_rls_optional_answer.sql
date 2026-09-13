-- Teacher PDF/class APIs can run with the teacher's JWT (local Vite has no service role).
-- School MCQs may have no answer key.

CREATE OR REPLACE FUNCTION public.validate_question_answer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.correct_answer IS NULL OR btrim(NEW.correct_answer) = '' THEN
    NEW.correct_answer := NULL;
    RETURN NEW;
  END IF;
  IF NEW.correct_answer NOT IN ('A','B','C','D','E') THEN
    RAISE EXCEPTION 'correct_answer must be one of A, B, C, D, E (got %)', NEW.correct_answer;
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE public.questions ALTER COLUMN correct_answer DROP NOT NULL;

GRANT SELECT, INSERT, UPDATE ON public.school_classes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_roster TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.school_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_pdf_imports TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_pdf_pages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_pdf_items TO authenticated;
GRANT INSERT, UPDATE ON public.mock_papers TO authenticated;
GRANT INSERT ON public.paper_questions TO authenticated;
GRANT INSERT ON public.paper_frqs TO authenticated;
GRANT INSERT ON public.questions TO authenticated;

DROP POLICY IF EXISTS school_classes_staff_insert ON public.school_classes;
CREATE POLICY school_classes_staff_insert ON public.school_classes
  FOR INSERT TO authenticated
  WITH CHECK (teacher_user_id = auth.uid() OR public.is_school_staff(auth.uid()));

DROP POLICY IF EXISTS school_classes_staff_update ON public.school_classes;
CREATE POLICY school_classes_staff_update ON public.school_classes
  FOR UPDATE TO authenticated
  USING (teacher_user_id = auth.uid() OR public.is_school_staff(auth.uid()))
  WITH CHECK (teacher_user_id = auth.uid() OR public.is_school_staff(auth.uid()));

DROP POLICY IF EXISTS school_roster_staff_write ON public.school_roster;
CREATE POLICY school_roster_staff_write ON public.school_roster
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.school_classes c
      WHERE c.id = class_id AND (c.teacher_user_id = auth.uid() OR public.is_school_staff(auth.uid()))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.school_classes c
      WHERE c.id = class_id AND (c.teacher_user_id = auth.uid() OR public.is_school_staff(auth.uid()))
    )
  );

DROP POLICY IF EXISTS school_assignments_staff_write ON public.school_assignments;
CREATE POLICY school_assignments_staff_write ON public.school_assignments
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.school_classes c
      WHERE c.id = class_id AND (c.teacher_user_id = auth.uid() OR public.is_school_staff(auth.uid()))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.school_classes c
      WHERE c.id = class_id AND (c.teacher_user_id = auth.uid() OR public.is_school_staff(auth.uid()))
    )
  );

DROP POLICY IF EXISTS school_pdf_imports_staff ON public.school_pdf_imports;
CREATE POLICY school_pdf_imports_staff ON public.school_pdf_imports
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.school_classes c
      WHERE c.id = class_id AND (c.teacher_user_id = auth.uid() OR public.is_school_staff(auth.uid()))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.school_classes c
      WHERE c.id = class_id AND (c.teacher_user_id = auth.uid() OR public.is_school_staff(auth.uid()))
    )
  );

DROP POLICY IF EXISTS school_pdf_pages_staff ON public.school_pdf_pages;
CREATE POLICY school_pdf_pages_staff ON public.school_pdf_pages
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.school_pdf_imports i
      JOIN public.school_classes c ON c.id = i.class_id
      WHERE i.id = import_id AND (c.teacher_user_id = auth.uid() OR public.is_school_staff(auth.uid()))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.school_pdf_imports i
      JOIN public.school_classes c ON c.id = i.class_id
      WHERE i.id = import_id AND (c.teacher_user_id = auth.uid() OR public.is_school_staff(auth.uid()))
    )
  );

DROP POLICY IF EXISTS school_pdf_items_staff ON public.school_pdf_items;
CREATE POLICY school_pdf_items_staff ON public.school_pdf_items
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.school_pdf_imports i
      JOIN public.school_classes c ON c.id = i.class_id
      WHERE i.id = import_id AND (c.teacher_user_id = auth.uid() OR public.is_school_staff(auth.uid()))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.school_pdf_imports i
      JOIN public.school_classes c ON c.id = i.class_id
      WHERE i.id = import_id AND (c.teacher_user_id = auth.uid() OR public.is_school_staff(auth.uid()))
    )
  );

DROP POLICY IF EXISTS school_staff_insert_school_questions ON public.questions;
CREATE POLICY school_staff_insert_school_questions ON public.questions
  FOR INSERT TO authenticated
  WITH CHECK (
    exclude_from_pool = true
    AND (
      public.is_school_staff(auth.uid())
      OR EXISTS (SELECT 1 FROM public.school_classes c WHERE c.teacher_user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS school_staff_insert_school_papers ON public.mock_papers;
CREATE POLICY school_staff_insert_school_papers ON public.mock_papers
  FOR INSERT TO authenticated
  WITH CHECK (
    slug LIKE 'school-%'
    AND (
      public.is_school_staff(auth.uid())
      OR EXISTS (SELECT 1 FROM public.school_classes c WHERE c.teacher_user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS school_staff_update_school_papers ON public.mock_papers;
CREATE POLICY school_staff_update_school_papers ON public.mock_papers
  FOR UPDATE TO authenticated
  USING (
    slug LIKE 'school-%'
    AND (
      public.is_school_staff(auth.uid())
      OR EXISTS (SELECT 1 FROM public.school_classes c WHERE c.teacher_user_id = auth.uid())
    )
  )
  WITH CHECK (
    slug LIKE 'school-%'
    AND (
      public.is_school_staff(auth.uid())
      OR EXISTS (SELECT 1 FROM public.school_classes c WHERE c.teacher_user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS school_staff_insert_paper_questions ON public.paper_questions;
CREATE POLICY school_staff_insert_paper_questions ON public.paper_questions
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.mock_papers p WHERE p.id = paper_id AND p.slug LIKE 'school-%')
    AND (
      public.is_school_staff(auth.uid())
      OR EXISTS (SELECT 1 FROM public.school_classes c WHERE c.teacher_user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS school_staff_insert_paper_frqs ON public.paper_frqs;
CREATE POLICY school_staff_insert_paper_frqs ON public.paper_frqs
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.mock_papers p WHERE p.id = paper_id AND p.slug LIKE 'school-%')
    AND (
      public.is_school_staff(auth.uid())
      OR EXISTS (SELECT 1 FROM public.school_classes c WHERE c.teacher_user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "School staff upload exam images" ON storage.objects;
CREATE POLICY "School staff upload exam images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'question-images'
  AND (storage.foldername(name))[1] = 'assignments'
  AND EXISTS (
    SELECT 1 FROM public.school_classes c
    WHERE c.id::text = (storage.foldername(name))[2]
      AND (c.teacher_user_id = auth.uid() OR public.is_school_staff(auth.uid()))
  )
);

DROP POLICY IF EXISTS "School staff update exam images" ON storage.objects;
CREATE POLICY "School staff update exam images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'question-images'
  AND (storage.foldername(name))[1] = 'assignments'
  AND EXISTS (
    SELECT 1 FROM public.school_classes c
    WHERE c.id::text = (storage.foldername(name))[2]
      AND (c.teacher_user_id = auth.uid() OR public.is_school_staff(auth.uid()))
  )
)
WITH CHECK (
  bucket_id = 'question-images'
  AND (storage.foldername(name))[1] = 'assignments'
  AND EXISTS (
    SELECT 1 FROM public.school_classes c
    WHERE c.id::text = (storage.foldername(name))[2]
      AND (c.teacher_user_id = auth.uid() OR public.is_school_staff(auth.uid()))
  )
);
