-- knowledge_points
CREATE TABLE public.knowledge_points (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  unit INT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL,
  name_zh TEXT NOT NULL,
  description TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- questions
CREATE TYPE public.question_type AS ENUM ('basic', 'application', 'pitfall');
CREATE TYPE public.question_status AS ENUM ('draft', 'published');

CREATE TABLE public.questions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  knowledge_point_id UUID NOT NULL REFERENCES public.knowledge_points(id) ON DELETE CASCADE,
  type question_type NOT NULL DEFAULT 'basic',
  difficulty INT NOT NULL DEFAULT 2,
  stem TEXT NOT NULL,
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  option_c TEXT NOT NULL,
  option_d TEXT NOT NULL,
  correct_answer CHAR(1) NOT NULL CHECK (correct_answer IN ('A','B','C','D')),
  explanation TEXT NOT NULL,
  pitfall_note TEXT,
  term_tags TEXT[] DEFAULT '{}',
  status question_status NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_questions_kp ON public.questions(knowledge_point_id);
CREATE INDEX idx_questions_status ON public.questions(status);
CREATE INDEX idx_questions_type ON public.questions(type);

-- terms
CREATE TABLE public.terms (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  term_en TEXT NOT NULL UNIQUE,
  term_zh TEXT NOT NULL,
  definition TEXT NOT NULL,
  confusable_with TEXT[] DEFAULT '{}',
  unit INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_terms_unit ON public.terms(unit);

-- admin_settings
CREATE TABLE public.admin_settings (
  id INT PRIMARY KEY DEFAULT 1,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT single_row CHECK (id = 1)
);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_kp_updated BEFORE UPDATE ON public.knowledge_points
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_q_updated BEFORE UPDATE ON public.questions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_t_updated BEFORE UPDATE ON public.terms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_admin_updated BEFORE UPDATE ON public.admin_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.knowledge_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;

-- public read (knowledge_points always readable; questions only published)
CREATE POLICY "kp public read" ON public.knowledge_points
  FOR SELECT USING (true);
CREATE POLICY "questions public read published" ON public.questions
  FOR SELECT USING (status = 'published');
CREATE POLICY "terms public read" ON public.terms
  FOR SELECT USING (true);

-- admin_settings: no public access (only service_role bypasses RLS)
-- No policies = no access for anon/authenticated, which is what we want.

-- Seed Unit 2 knowledge points
INSERT INTO public.knowledge_points (unit, slug, name_en, name_zh, description, sort_order) VALUES
  (2, 'demand', 'Demand', '需求', '需求曲线、需求定律与影响因素', 1),
  (2, 'supply', 'Supply', '供给', '供给曲线、供给定律与影响因素', 2),
  (2, 'market-equilibrium', 'Market Equilibrium', '市场均衡', '均衡价格与均衡数量、剩余与短缺', 3),
  (2, 'price-elasticity', 'Price Elasticity', '价格弹性', '需求弹性、供给弹性及其计算', 4),
  (2, 'consumer-producer-surplus', 'Consumer & Producer Surplus', '消费者与生产者剩余', '剩余的几何含义与福利分析', 5),
  (2, 'government-intervention', 'Government Intervention', '政府干预', '价格上下限、税收与补贴', 6);

-- Seed terms
INSERT INTO public.terms (term_en, term_zh, definition, confusable_with, unit) VALUES
  ('equilibrium', '均衡', '市场上供给量等于需求量的状态。', ARRAY['disequilibrium'], 2),
  ('demand', '需求', '消费者在不同价格下愿意且能够购买的商品数量。', ARRAY['quantity demanded'], 2),
  ('quantity demanded', '需求量', '在某一特定价格下消费者愿意购买的具体数量；价格变化导致沿需求曲线移动。', ARRAY['demand'], 2),
  ('supply', '供给', '生产者在不同价格下愿意且能够提供的商品数量。', ARRAY['quantity supplied'], 2),
  ('quantity supplied', '供给量', '在某一特定价格下生产者愿意提供的具体数量。', ARRAY['supply'], 2),
  ('shift', '曲线移动', '由非价格因素引起的整条曲线的左右移动。', ARRAY['movement along'], 2),
  ('movement along', '沿曲线移动', '价格变化引起的需求量或供给量沿同一曲线的变化，曲线本身不动。', ARRAY['shift'], 2),
  ('price ceiling', '价格上限', '政府设定的法定最高价格，低于均衡价时造成短缺。', ARRAY['price floor'], 2),
  ('price floor', '价格下限', '政府设定的法定最低价格，高于均衡价时造成过剩。', ARRAY['price ceiling'], 2),
  ('elastic', '富有弹性', '价格弹性绝对值大于 1，需求/供给对价格变化反应敏感。', ARRAY['inelastic'], 2),
  ('inelastic', '缺乏弹性', '价格弹性绝对值小于 1，需求/供给对价格变化反应迟钝。', ARRAY['elastic'], 2),
  ('consumer surplus', '消费者剩余', '消费者愿意支付的最高价格与实际支付价格之差。', ARRAY['producer surplus'], 2),
  ('producer surplus', '生产者剩余', '生产者实际收到的价格与最低愿意接受价格之差。', ARRAY['consumer surplus'], 2),
  ('deadweight loss', '无谓损失', '由于市场不在均衡产量时损失的总剩余。', ARRAY[]::text[], 2);

-- Seed sample questions for Unit 2 / Demand
INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, correct_answer, explanation, pitfall_note, term_tags, status)
SELECT id, 'basic', 1,
  'Which of the following will cause a shift of the demand curve for coffee to the right?',
  'A decrease in the price of coffee',
  'An increase in the price of tea, a substitute for coffee',
  'An increase in the price of coffee',
  'A decrease in consumer income (assuming coffee is a normal good)',
  'B',
  '考点：需求曲线移动 vs 沿曲线移动。\n\n正确思路：需求曲线右移由非价格因素引起。茶是咖啡的替代品，茶价上升使消费者转向咖啡，咖啡需求增加，曲线右移。\n\n干扰项分析：\nA、C 是咖啡自身价格变化，只导致沿需求曲线 movement along，不是 shift。\nD 收入下降使正常品需求左移，方向相反。',
  '⚠ 易混：shift（整条曲线移动）vs movement along（沿曲线移动）。商品自身价格变化永远是 movement along。',
  ARRAY['demand','shift','movement along'],
  'published'
FROM public.knowledge_points WHERE slug = 'demand';

INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, correct_answer, explanation, pitfall_note, term_tags, status)
SELECT id, 'pitfall', 2,
  'When the price of gasoline rises from $3 to $4 per gallon, the quantity demanded falls from 100 to 80 gallons. This change is best described as:',
  'A leftward shift of the demand curve',
  'A rightward shift of the demand curve',
  'A movement along the demand curve',
  'A change in demand caused by price',
  'C',
  '考点：区分 change in demand 与 change in quantity demanded。\n\n正确思路：题目中变化的是商品自身价格（gasoline 的价格），由此引起的购买量变化是 quantity demanded 的变化，对应沿需求曲线向上移动。\n\n干扰项分析：\nA、B 描述的是 shift，需由收入、偏好、相关品价格等非价格因素引起。\nD 表述本身错误：自身价格变化不会引起 demand（整条曲线）的变化。',
  '⚠ AP 高频坑：考官常用"change in demand"误导学生选 shift。记住：自身价格 → quantity demanded；其他因素 → demand。',
  ARRAY['movement along','quantity demanded'],
  'published'
FROM public.knowledge_points WHERE slug = 'demand';

INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, correct_answer, explanation, pitfall_note, term_tags, status)
SELECT id, 'basic', 1,
  'A binding price ceiling set below the equilibrium price will most likely result in:',
  'A surplus of the good',
  'A shortage of the good',
  'No change in quantity exchanged',
  'An increase in producer surplus',
  'B',
  '考点：价格上限的市场效应。\n\n正确思路：binding price ceiling 必须低于均衡价才有效。低于均衡价时 Qd > Qs，出现短缺（shortage）。\n\n干扰项分析：\nA 过剩出现在 price floor 高于均衡价时，方向相反。\nC 价格管制改变实际成交量（成交量被供给量限制）。\nD 价格被压低后生产者剩余减少，不是增加。',
  '⚠ 易混：price ceiling（上限，往下压）→ shortage；price floor（下限，往上托）→ surplus。记口诀"顶低短，底高剩"。',
  ARRAY['price ceiling','price floor'],
  'published'
FROM public.knowledge_points WHERE slug = 'government-intervention';

INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, correct_answer, explanation, pitfall_note, term_tags, status)
SELECT id, 'application', 3,
  'If the price of a good rises by 10% and the quantity demanded falls by 5%, the price elasticity of demand is:',
  '0.5, and demand is inelastic',
  '0.5, and demand is elastic',
  '2.0, and demand is inelastic',
  '2.0, and demand is elastic',
  'A',
  '考点：价格弹性公式与判定。\n\n正确思路：|Ed| = |%ΔQd / %ΔP| = |-5% / 10%| = 0.5。绝对值 < 1，需求缺乏弹性（inelastic）。\n\n干扰项分析：\nB 数值对但弹性判断反了。\nC、D 把分子分母倒置，得到 2.0。',
  '⚠ AP 计算题常坑：分子是 %ΔQ，分母是 %ΔP，别倒。判定标准：|E| > 1 elastic，< 1 inelastic，= 1 unit elastic。',
  ARRAY['elastic','inelastic'],
  'published'
FROM public.knowledge_points WHERE slug = 'price-elasticity';

INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, correct_answer, explanation, pitfall_note, term_tags, status)
SELECT id, 'application', 2,
  'In a competitive market, an increase in supply (with demand unchanged) will:',
  'Increase equilibrium price and quantity',
  'Decrease equilibrium price and quantity',
  'Increase equilibrium price and decrease quantity',
  'Decrease equilibrium price and increase quantity',
  'D',
  '考点：供需变化对均衡的影响。\n\n正确思路：供给增加 → 供给曲线右移。需求不变时，新均衡点价格下降、数量上升。\n\n干扰项分析：\nA 是需求增加的结果。\nB 是供给减少的结果。\nC 描述的是供给减少 + 需求不变。',
  '⚠ 记忆法："S 右移：P↓ Q↑"，"S 左移：P↑ Q↓"，"D 右移：P↑ Q↑"，"D 左移：P↓ Q↓"。一变一不变才能确定方向。',
  ARRAY['supply','equilibrium'],
  'published'
FROM public.knowledge_points WHERE slug = 'market-equilibrium';