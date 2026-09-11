-- School graded-exam: teacher class, roster, assignments, attempts, PDF ingest.

DO $$
BEGIN
  ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'teacher';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO public.knowledge_points (unit, slug, name_en, name_zh, description, sort_order)
VALUES (1, 'school-import', 'School exam import', '学校考试导入题', 'PDF 导入的学校考试题目，不进入日常题库。', 999)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE public.school_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_user_id uuid NOT NULL,
  name text NOT NULL DEFAULT '默认班级',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.school_roster (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.school_classes(id) ON DELETE CASCADE,
  student_id text NOT NULL,
  student_name text NOT NULL,
  name_key text NOT NULL,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, student_id)
);

CREATE INDEX school_roster_class_idx ON public.school_roster(class_id);
CREATE INDEX school_roster_user_idx ON public.school_roster(user_id);

CREATE TABLE public.school_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.school_classes(id) ON DELETE CASCADE,
  paper_id uuid NOT NULL REFERENCES public.mock_papers(id) ON DELETE RESTRICT,
  title text NOT NULL,
  exam_code text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  results_published boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT school_assignments_window CHECK (ends_at > starts_at)
);

CREATE UNIQUE INDEX school_assignments_exam_code_idx ON public.school_assignments(exam_code);
CREATE INDEX school_assignments_class_idx ON public.school_assignments(class_id);

CREATE TABLE public.school_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.school_assignments(id) ON DELETE CASCADE,
  roster_id uuid NOT NULL REFERENCES public.school_roster(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  mcq_total integer,
  mcq_correct integer,
  duration_seconds integer,
  mcq_detail jsonb NOT NULL DEFAULT '[]'::jsonb,
  frq_answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (assignment_id, roster_id)
);

CREATE INDEX school_attempts_assignment_idx ON public.school_attempts(assignment_id);

CREATE TABLE public.school_pdf_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.school_classes(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  filename text NOT NULL,
  page_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'rendered', 'reviewing', 'published')),
  paper_id uuid REFERENCES public.mock_papers(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.school_pdf_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.school_pdf_imports(id) ON DELETE CASCADE,
  page_number integer NOT NULL,
  image_url text NOT NULL,
  extracted_text text,
  UNIQUE (import_id, page_number)
);

CREATE TABLE public.school_pdf_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.school_pdf_imports(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('mcq', 'frq')),
  sort_order integer NOT NULL,
  page_number integer NOT NULL,
  stem text,
  option_a text,
  option_b text,
  option_c text,
  option_d text,
  option_e text,
  correct_answer text,
  content text,
  max_score integer NOT NULL DEFAULT 9,
  reviewed boolean NOT NULL DEFAULT false
);

CREATE OR REPLACE FUNCTION public.is_school_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('admin', 'teacher')
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_school_staff(uuid) TO authenticated, service_role;

ALTER TABLE public.school_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_roster ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_pdf_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_pdf_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_pdf_items ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.school_classes TO authenticated;
GRANT SELECT ON public.school_roster TO authenticated;
GRANT SELECT ON public.school_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.school_attempts TO authenticated;
GRANT ALL ON public.school_classes TO service_role;
GRANT ALL ON public.school_roster TO service_role;
GRANT ALL ON public.school_assignments TO service_role;
GRANT ALL ON public.school_attempts TO service_role;
GRANT ALL ON public.school_pdf_imports TO service_role;
GRANT ALL ON public.school_pdf_pages TO service_role;
GRANT ALL ON public.school_pdf_items TO service_role;

CREATE POLICY school_classes_staff_select ON public.school_classes
  FOR SELECT TO authenticated
  USING (teacher_user_id = auth.uid() OR public.is_school_staff(auth.uid()));

CREATE POLICY school_roster_own_or_staff ON public.school_roster
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.school_classes c
      WHERE c.id = class_id AND (c.teacher_user_id = auth.uid() OR public.is_school_staff(auth.uid()))
    )
  );

CREATE POLICY school_assignments_visible ON public.school_assignments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.school_roster r
      WHERE r.class_id = school_assignments.class_id AND r.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.school_classes c
      WHERE c.id = class_id AND (c.teacher_user_id = auth.uid() OR public.is_school_staff(auth.uid()))
    )
  );

CREATE POLICY school_attempts_student_select ON public.school_attempts
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.school_assignments a
      JOIN public.school_classes c ON c.id = a.class_id
      WHERE a.id = assignment_id AND (c.teacher_user_id = auth.uid() OR public.is_school_staff(auth.uid()))
    )
  );

CREATE POLICY school_attempts_student_insert ON public.school_attempts
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY school_attempts_student_update ON public.school_attempts
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
