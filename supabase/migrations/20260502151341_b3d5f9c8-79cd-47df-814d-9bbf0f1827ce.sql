-- Feedback table
CREATE TYPE public.feedback_category AS ENUM ('bug', 'suggestion');
CREATE TYPE public.feedback_status AS ENUM ('new', 'in_progress', 'resolved');

CREATE TABLE public.feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category public.feedback_category NOT NULL DEFAULT 'bug',
  message text NOT NULL,
  page_url text,
  contact text,
  status public.feedback_status NOT NULL DEFAULT 'new',
  admin_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- Anyone can submit
CREATE POLICY "anyone can insert feedback"
ON public.feedback FOR INSERT TO anon, authenticated
WITH CHECK (char_length(message) BETWEEN 1 AND 4000);

-- No public read; admin uses service-role
CREATE TRIGGER set_feedback_updated_at
BEFORE UPDATE ON public.feedback
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_feedback_status_created ON public.feedback(status, created_at DESC);

-- Unit 6 knowledge points
INSERT INTO public.knowledge_points (slug, name_zh, name_en, unit, sort_order) VALUES
('u6-efficiency', '效率和非效率的市场产出', 'Socially Efficient and Inefficient Market Outcomes', 6, 61),
('u6-externalities', '外部性', 'Externalities', 6, 62),
('u6-public-goods', '公共物品和私人物品', 'Public and Private Goods', 6, 63),
('u6-gov-intervention', '政府对不同市场结构的干预', 'The Effects of Government Intervention in Different Market Structures', 6, 64),
('u6-inequality', '不平等', 'Inequality', 6, 65);
