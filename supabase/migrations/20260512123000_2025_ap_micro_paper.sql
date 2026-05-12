-- Mock paper schema and 2025 AP Micro real exam data


CREATE TABLE IF NOT EXISTS public.mock_papers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  title text NOT NULL,
  year int,
  total_seconds int NOT NULL DEFAULT 4200,
  description text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mock_papers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "papers public read" ON public.mock_papers;
CREATE POLICY "papers public read" ON public.mock_papers FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS public.paper_questions (
  paper_id uuid NOT NULL REFERENCES public.mock_papers(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  sort_order int NOT NULL,
  PRIMARY KEY (paper_id, question_id)
);
ALTER TABLE public.paper_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "paper_questions public read" ON public.paper_questions;
CREATE POLICY "paper_questions public read" ON public.paper_questions FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS public.paper_frqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id uuid NOT NULL REFERENCES public.mock_papers(id) ON DELETE CASCADE,
  sort_order int NOT NULL,
  title text,
  content text NOT NULL,
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.paper_frqs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "paper_frqs public read" ON public.paper_frqs;
CREATE POLICY "paper_frqs public read" ON public.paper_frqs FOR SELECT USING (true);


INSERT INTO public.mock_papers (slug, title, year, total_seconds, description, sort_order)
VALUES ('ap-micro-2025', '2025 AP 微观经济真题卷', 2025, 4200,
  '官方 2025 年 AP 微观经济考试，60 道选择题（70 分钟）+ 3 道简答题。', 1)
ON CONFLICT (slug) DO NOTHING;


DO $$
DECLARE
  paper_uuid uuid;
  q_uuid uuid;
  kp_uuid uuid;
BEGIN
  SELECT id INTO paper_uuid FROM public.mock_papers WHERE slug = 'ap-micro-2025';
  -- Clean prior import for idempotency
  DELETE FROM public.paper_frqs WHERE paper_id = paper_uuid;
  DELETE FROM public.paper_questions WHERE paper_id = paper_uuid;
  DELETE FROM public.questions WHERE id IN (
    SELECT question_id FROM public.paper_questions WHERE paper_id = paper_uuid
  );


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'demand';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'If Aurora maximizes her total utility by spending her entire budget on purchasing apples and oranges, which of the following best explains her decision making?', 'The amount spent on apples is equal to the amount spent on oranges.', 'The total utility received from consuming apples is equal to the total utility received from consuming oranges.', 'The marginal utility received from consuming the last apple is equal to the marginal utility received from consuming the last orange.', 'The marginal utility of the last dollar spent on apples is equal to the marginal utility of the last dollar spent on oranges.', 'The marginal utility received from consuming the last apple and that received from consuming the last orange are both maximized.', 'D', '2025 AP 微观经济真题第 1 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 1);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'supply';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'Shrimp and chicken are substitute inputs in the production of frozen meals. Both shrimp and chicken are sold in perfectly competitive markets. If the government imposes a per-unit tax on shrimp, how will the demand for chicken and the equilibrium price of frozen meals be affected in the short run?', 'Demand for chicken: Increase; Equilibrium price of frozen meals: Increase', 'Demand for chicken: Increase; Equilibrium price of frozen meals: Decrease', 'Demand for chicken: Increase; Equilibrium price of frozen meals: No change', 'Demand for chicken: Decrease; Equilibrium price of frozen meals: Decrease', 'Demand for chicken: No change; Equilibrium price of frozen meals: Increase', 'A', '2025 AP 微观经济真题第 2 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 2);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u4-price-discrimination';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'The firm operates in an imperfectly competitive market and produces the profit-maximizing quantity of output. If the firm could engage in perfect price discrimination, what would be the resulting consumer surplus and the change in deadweight loss? (Refer to the graph on the page.)', 'Consumer surplus would equal 0, and deadweight loss would decrease by 90.', 'Consumer surplus would equal 0, and deadweight loss would increase by 90.', 'Consumer surplus would equal 500, and deadweight loss would increase by 180.', 'Consumer surplus would equal 300, and deadweight loss could increase by 180.', 'Consumer surplus would equal 0, and deadweight loss would decrease by 180.', 'E', '2025 AP 微观经济真题第 3 题（官方题目，详解参考官方答案）。', 'published', 'https://umyzlbrjnklkpxmbdhvf.supabase.co/storage/v1/object/public/question-images/papers/2025/page-01.png', '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 3);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'supply';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'Which of the following would cause an increase in the supply of tacos in the short run?', 'The price of tacos decreases.', 'The demand for tacos increases.', 'The price of beef, an input in the production of tacos, decreases.', 'The price of guacamole, a complement in consumption for tacos, decreases.', 'The price of burritos, a substitute in consumption for tacos, decreases.', 'C', '2025 AP 微观经济真题第 4 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 4);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u4-oligopoly-game-theory';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'There are two barbecue restaurants in a town, Nick''s Barbecue and Frank''s Barbecue. The payoff matrix shows the payoff for each combination of strategies, and both players have complete information. The first entry in each cell represents Nick''s Barbecue''s payoff, and the second entry represents Frank''s Barbecue''s payoff. Each player independently and simultaneously chooses its strategy. Which of the following is true about the restaurants'' dominant strategies? (Refer to the payoff matrix on the page.)', 'Nick''s Barbecue''s dominant strategy is Advertise, and Frank''s Barbecue''s dominant strategy is Advertise.', 'Nick''s Barbecue''s dominant strategy is Advertise, and Frank''s Barbecue''s dominant strategy is Not Advertise.', 'Nick''s Barbecue''s dominant strategy is Not Advertise, and Frank''s Barbecue''s dominant strategy is Advertise.', 'Nick''s Barbecue''s dominant strategy is Not Advertise, and Frank''s Barbecue''s dominant strategy is Not Advertise.', 'Nick''s Barbecue''s dominant strategy is Advertise, and Frank''s Barbecue does not have a dominant strategy.', 'A', '2025 AP 微观经济真题第 5 题（官方题目，详解参考官方答案）。', 'published', 'https://umyzlbrjnklkpxmbdhvf.supabase.co/storage/v1/object/public/question-images/papers/2025/page-02.png', '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 5);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u4-monopolistic-competition';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'Brass With Class is a profit-maximizing firm that produces trumpets in a monopolistically competitive market. Brass With Class currently produces 100 trumpets and sells each trumpet at a price of $50. If the average total cost when producing 100 trumpets is $45, what is Brass With Class''s total economic profit in the short run, and what adjustment will happen in the trumpet market in the long run?', 'Economic profit: -$500; Long-run adjustment: existing firms will exit the market.', 'Economic profit: -$5; Long-run adjustment: existing firms will exit the market.', 'Economic profit: $0; Long-run adjustment: the market will be in long-run equilibrium.', 'Economic profit: $5; Long-run adjustment: new firms will enter the market.', 'Economic profit: $500; Long-run adjustment: new firms will enter the market.', 'E', '2025 AP 微观经济真题第 6 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 6);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u4-monopoly';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'Initially, Markus Corporation is the only firm that produces aluminum. The government breaks up Markus'' monopoly, creating two firms in its place. The long-run ATC for each firm is higher than if Markus operated alone in the industry. This would suggest that before the breakup, Markus Corporation was operating under conditions of:', 'Monopolistic competition', 'Nash equilibrium', 'Decreasing returns to scale', 'Economies of scale', 'Diseconomies of scale', 'D', '2025 AP 微观经济真题第 7 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 7);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u6-externalities';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'The graph shows equilibrium for a good. What is the socially optimal quantity, and what is the marginal external benefit at that quantity? (Refer to the graph on the page.)', 'Q1, and the marginal external benefit is P1 - P2', 'Q1, and the marginal external benefit is P2 - P3', 'Q2, and the marginal external benefit is P3 - P1', 'Q2, and the marginal external benefit is P2', 'Q2, and the marginal external benefit is P2 - P1', 'E', '2025 AP 微观经济真题第 8 题（官方题目，详解参考官方答案）。', 'published', 'https://umyzlbrjnklkpxmbdhvf.supabase.co/storage/v1/object/public/question-images/papers/2025/page-02.png', '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 8);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u3-shutdown-entry-exit';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'Firm Z is a typical firm in a perfectly competitive market that produces a quantity of output where marginal revenue equals marginal cost in a constant cost industry. If the sum of Firm Z''s average fixed cost and average variable cost is below its marginal revenue at the profit-maximizing quantity, which of the following will occur in the long run?', 'The firm will increase output.', 'The firm will shut down.', 'The firm will increase price.', 'The firm will exit the market.', 'New firms will enter the market.', 'E', '2025 AP 微观经济真题第 9 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 9);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u5-perfectly-competitive-factor';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'A profit-maximizing firm hiring workers from a perfectly competitive labor market will continue to hire workers until the wage rate is equal to:', 'Average variable cost', 'Average revenue', 'Marginal revenue', 'Marginal cost × marginal product of labor', 'Marginal revenue × marginal product of labor', 'E', '2025 AP 微观经济真题第 10 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 10);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'demand';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'The table shows the marginal utility that Olivia derives from consuming two goods, chocolate bars and slices of pizza. Olivia has a limited weekly income of $10 and spends it all on chocolate bars and slices of pizza. Assume that the price of a chocolate bar is $1 and the price of each slice of pizza is $2. What combination of chocolate bars and pizza slices will maximize Olivia''s total utility given her weekly income? (Refer to the marginal utility table on the page.)', '0 chocolate bars and 5 slices of pizza', '1 chocolate bar and 2 slices of pizza', '2 chocolate bars and 4 slices of pizza', '4 chocolate bars and 3 slices of pizza', '6 chocolate bars and 2 slices of pizza', 'C', '2025 AP 微观经济真题第 11 题（官方题目，详解参考官方答案）。', 'published', 'https://umyzlbrjnklkpxmbdhvf.supabase.co/storage/v1/object/public/question-images/papers/2025/page-03.png', '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 11);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'consumer-producer-surplus';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'Kareem is willing to pay $25 for a remote control produced by Remotek in a perfectly competitive market. Which of the following is true if the market price is $10?', 'Kareem''s consumer surplus is $10.', 'Kareem''s consumer surplus is $15.', 'Kareem''s consumer surplus is $25.', 'Remotek''s producer surplus is $25.', 'Remotek''s producer surplus is $35.', 'B', '2025 AP 微观经济真题第 12 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 12);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u3-profit-maximization';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'The table shows the total cost schedule for a soybean farm. The farm grows and sells soybeans at a price of $15 per bushel in a competitive market. What is the farm''s total economic profit at the profit-maximizing quantity of output? (Refer to the cost table on the page.)', '$10', '$21', '$23', '$25', '$28', 'C', '2025 AP 微观经济真题第 13 题（官方题目，详解参考官方答案）。', 'published', 'https://umyzlbrjnklkpxmbdhvf.supabase.co/storage/v1/object/public/question-images/papers/2025/page-03.png', '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 13);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u5-factor-demand-supply';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'Which of the following changes will increase the equilibrium market wage for plumbers?', 'A decrease in the market price of plumbing services', 'A decrease in the amount of vacation time taken by plumbers', 'A decrease in the productivity of plumbers', 'An increase in the fees for plumber licenses required to practice plumbing', 'An increase in the quality of working conditions for plumbers', 'D', '2025 AP 微观经济真题第 14 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 14);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u6-public-goods';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'Tornado-warning sirens are usually paid for by local governments rather than private individuals because:', 'each individual does not find the sirens to be of value.', 'sirens are rival and excludable in consumption.', 'private individuals lack the incentive to cover the cost of providing the sirens.', 'sirens will be overproduced in the market equilibrium.', 'it is cheaper to produce sirens for local governments than to produce them for private individuals.', 'C', '2025 AP 微观经济真题第 15 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 15);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u5-perfectly-competitive-factor';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'A firm hires labor and rents machines as variable inputs from perfectly competitive factor markets to produce Good X. The firm also requires land, as a fixed input, for its operation. The firm''s short-run profit-maximizing quantity of output would not be affected by a change in which of the following?', 'The price of land', 'The price of Good X', 'The marginal product of labor', 'The marginal product of machines', 'The wage rate', 'A', '2025 AP 微观经济真题第 16 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 16);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u3-production-function';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'Which of the following is the best example of a fixed input for a firm producing leather boots in the short run?', 'Industrial sewing machines', 'Leather used to make the boots', 'Thread used to stitch the leather together', 'Unskilled labor working in the factory', 'Electricity used to power the factory', 'A', '2025 AP 微观经济真题第 17 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 17);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u4-oligopoly-game-theory';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'If the only two firms in an industry collude to charge a higher price and produce a lower quantity than what is socially optimal, what will happen to consumer surplus and total economic surplus in the market in the short run?', 'Consumer surplus will decrease, and total economic surplus will stay the same.', 'Consumer surplus will decrease, and total economic surplus will increase.', 'Consumer surplus will increase, and total economic surplus will decrease.', 'Consumer surplus and total economic surplus will both increase.', 'Consumer surplus and total economic surplus will both decrease.', 'E', '2025 AP 微观经济真题第 18 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 18);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u5-monopsony';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'The small town of Marketville had four firms producing coal. The four firms then merged into one firm which is now the sole employer of coal miners in Marketville. What effect will this change have on the market for coal miners in Marketville?', 'Equilibrium wages and the level of employment will both increase.', 'Equilibrium wages will increase, and the level of employment will decrease.', 'Equilibrium wages and the level of employment will both decrease.', 'Equilibrium wages will decrease, and the level of employment will increase.', 'Equilibrium wages will decrease, and the level of employment will remain the same.', 'C', '2025 AP 微观经济真题第 19 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 19);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u1-scarcity';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'Which of the following describes why scarcity exists in an economy?', 'There are more resources available than are being used.', 'Society''s resources are underutilized.', 'Society''s wants exceed its available resources.', 'Prices of available resources are lower than consumers'' willingness to pay.', 'Prices of available resources are higher than consumers'' willingness to pay.', 'C', '2025 AP 微观经济真题第 20 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 20);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'government-intervention';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'Which of the following describes a difference between the imposition of a tariff on imports and the imposition of a quota on imports?', 'A tariff will affect domestic consumption, whereas a quota will not.', 'A tariff will affect domestic production, whereas a quota will not.', 'A tariff will increase domestic consumer surplus, whereas a quota will not.', 'A tariff will generate revenue for the government, whereas a quota will not.', 'A tariff will eliminate deadweight loss, whereas a quota will not.', 'D', '2025 AP 微观经济真题第 21 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 21);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'price-elasticity';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'The table shows the market supply schedule for a good. When the price changes from $14 to $16, the supply in this range is: (Refer to the supply schedule on the page.)', 'elastic', 'inelastic', 'unit elastic', 'perfectly elastic', 'perfectly inelastic', 'A', '2025 AP 微观经济真题第 22 题（官方题目，详解参考官方答案）。', 'published', 'https://umyzlbrjnklkpxmbdhvf.supabase.co/storage/v1/object/public/question-images/papers/2025/page-05.png', '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 22);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u4-monopoly';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'Which of the following will definitely result in a decrease in a monopoly''s profit-maximizing quantity of output?', 'A decrease in variable costs and the ability to perfectly price discriminate', 'A decrease in variable costs and a decrease in demand for the monopoly''s output', 'An increase in variable costs and a decrease in demand for the monopoly''s output', 'An increase in fixed costs and an increase in demand for the monopoly''s output', 'An increase in fixed costs and the ability to perfectly price discriminate', 'C', '2025 AP 微观经济真题第 23 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 23);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u3-long-run-costs';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'If a firm is experiencing increasing returns to scale, then doubling inputs will necessarily:', 'less than double total revenue', 'less than double economic profit', 'more than double average total cost', 'more than double marginal cost', 'more than double the quantity of output', 'E', '2025 AP 微观经济真题第 24 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 24);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'supply';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'Which of the following is true about the market supply curve for a good?', 'It is derived from the summation of the marginal revenue product of labor hired by individual firms.', 'It is derived from the summation of the marginal product of labor hired by individual firms.', 'It is derived from the summation of the individual firm''s quantity supplied at each price.', 'It lies above the market demand curve at quantities less than the market equilibrium quantity.', 'It lies below the market demand curve at quantities greater than the market equilibrium quantity.', 'C', '2025 AP 微观经济真题第 25 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 25);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u6-gov-intervention';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'Two monopolies with identical cost structures are compared. One is an unregulated profit-maximizing monopoly, and the other is regulated to produce the quantity at which it breaks even with zero economic profit. Which of the following accurately describes the difference between the two monopolies?', 'Unregulated monopoly: Charges a price equal to average total cost; Regulated monopoly: Charges a price equal to marginal cost', 'Unregulated monopoly: Creates deadweight loss in the market; Regulated monopoly: Eliminates deadweight loss from the market', 'Unregulated monopoly: Experiences economies of scale; Regulated monopoly: Experiences diseconomies of scale', 'Unregulated monopoly: Collects all consumer surplus from the consumers; Regulated monopoly: Transfers all consumer surplus to the government', 'Unregulated monopoly: Produces where marginal revenue equals marginal cost; Regulated monopoly: Produces where price equals average total cost', 'E', '2025 AP 微观经济真题第 26 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 26);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'government-intervention';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'If rice is freely traded in the world and the world price of rice is $3, then Deltaland will: (Refer to the domestic supply and demand graph on the page.)', 'Export 4 million pounds of rice', 'Export 8 million pounds of rice', 'Import 4 million pounds of rice', 'Import 8 million pounds of rice', 'Import 12 million pounds of rice', 'D', '2025 AP 微观经济真题第 27 题（官方题目，详解参考官方答案）。', 'published', 'https://umyzlbrjnklkpxmbdhvf.supabase.co/storage/v1/object/public/question-images/papers/2025/page-06.png', '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 27);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u3-perfect-competition';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'Which of the following is always true for a perfectly competitive market?', 'Firms have no market power.', 'Firms produce differentiated products.', 'Firms earn positive economic profit.', 'There are high barriers to entry.', 'There are relatively few competitors.', 'A', '2025 AP 微观经济真题第 28 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 28);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'price-elasticity';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'Assume extremely cold weather destroys some of a nation''s strawberry crop, which results in an increase in total revenue for strawberry producers. Which of the following must be true?', 'The market supply of strawberries is elastic.', 'The market supply of strawberries is inelastic.', 'The market demand for strawberries is elastic.', 'The market demand for strawberries is unit elastic.', 'The market demand for strawberries is inelastic.', 'E', '2025 AP 微观经济真题第 29 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 29);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u4-oligopoly-game-theory';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'Ally''s Candles and Bob''s Candles are the only two sellers of candles in town. Both candle companies are considering changing their current pricing strategies. Each company is deciding between increasing prices or decreasing prices to increase their profits. Suppose Ally''s Candles realizes that increasing price will increase its profits regardless of what Bob''s Candles does. Which of the following concepts best describes this situation?', 'Nash equilibrium', 'Price discrimination', 'Dominant strategy', 'Prisoner''s Dilemma', 'Collusion', 'C', '2025 AP 微观经济真题第 30 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 30);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u3-short-run-costs';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'The table shows the total cost schedule for FineSeat Company. FineSeat Company produces chairs. How many chairs will FineSeat Company produce to minimize average variable cost? (Refer to the cost table on the page.)', '1 chair', '2 chairs', '3 chairs', '4 chairs', '5 chairs', 'B', '2025 AP 微观经济真题第 31 题（官方题目，详解参考官方答案）。', 'published', 'https://umyzlbrjnklkpxmbdhvf.supabase.co/storage/v1/object/public/question-images/papers/2025/page-06.png', '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 31);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u3-types-of-profit';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'Nikita was working at a law firm earning an annual salary of $80,000 but she decided to start her own law practice. She used a building she owns and had been renting to a tenant for $15,000 a year. Her law practice earned an accounting profit of $90,000 in its first year. Based on the preceding information, Nikita''s economic profit equaled:', '-$80,000', '-$15,000', '-$5,000', '$10,000', '$75,000', 'C', '2025 AP 微观经济真题第 32 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 32);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'government-intervention';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'The graph shows a per-unit subsidy being granted to producers of Good X. The letters on the graph represent enclosed areas. What is the total cost of the per-unit subsidy to the government? (Refer to the graph on the page.)', 'Areas B, C and J', 'Areas B, C and D', 'Areas A, E and G', 'Areas A, B, C, F, G, H and J', 'Areas A, B, C, D, E, J and K', 'D', '2025 AP 微观经济真题第 33 题（官方题目，详解参考官方答案）。', 'published', 'https://umyzlbrjnklkpxmbdhvf.supabase.co/storage/v1/object/public/question-images/papers/2025/page-07.png', '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 33);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'government-intervention';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'The change in consumer surplus as a result of the per-unit subsidy granted to producers of Good X is equal to: (Refer to the graph on the page.)', 'Zero', 'Area A', 'Area J', 'Areas J and K', 'Areas B, C and J', 'E', '2025 AP 微观经济真题第 34 题（官方题目，详解参考官方答案）。', 'published', 'https://umyzlbrjnklkpxmbdhvf.supabase.co/storage/v1/object/public/question-images/papers/2025/page-07.png', '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 34);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u1-comparative-advantage';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'Ming and Andreas are the only two employees at a pizza shop where they can either take orders or clean tables. Ming has a comparative advantage over Andreas in taking orders. It must therefore be true that:', 'Ming has a higher opportunity cost for taking orders.', 'Ming has an absolute advantage in taking orders.', 'There is no advantage in specialization for Andreas.', 'Andreas has an absolute advantage in cleaning tables.', 'Andreas has a lower opportunity cost for cleaning tables.', 'E', '2025 AP 微观经济真题第 35 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 35);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u3-profit-maximization';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'The graph shows the cost and revenue curves for the firm LuxEcon. LuxEcon operates in a perfectly competitive market and produces the profit-maximizing quantity of output. Which of the following correctly identifies LuxEcon''s profit-maximizing quantity and economic profit? (Refer to the graph on the page.)', 'LuxEcon''s profit-maximizing quantity is 16, and LuxEcon earns positive economic profit of $256.', 'LuxEcon''s profit-maximizing quantity is 16, and LuxEcon earns negative economic profit of $256.', 'LuxEcon''s profit-maximizing quantity is 20, and LuxEcon earns positive economic profit of $240.', 'LuxEcon''s profit-maximizing quantity is 20, and LuxEcon earns negative economic profit of $240.', 'LuxEcon''s profit-maximizing quantity is 20, and LuxEcon earns negative economic profit of $480.', 'D', '2025 AP 微观经济真题第 36 题（官方题目，详解参考官方答案）。', 'published', 'https://umyzlbrjnklkpxmbdhvf.supabase.co/storage/v1/object/public/question-images/papers/2025/page-07.png', '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 36);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u5-factor-demand-supply';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'Donatello operates a firm that sells frozen treats in a perfectly competitive market. Which of the following would explain why Donatello is hiring more workers this year than last year?', 'Other firms have opened more stores selling frozen treats.', 'The government imposed a per-unit tax on consumers of frozen treats.', 'The government removed a quota on imported frozen treats.', 'There was an increase in demand for frozen treats.', 'There was a decrease in the price of frozen treats.', 'D', '2025 AP 微观经济真题第 37 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 37);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u5-factor-demand-supply';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'Avocado production requires land to grow avocado trees and workers to pick the avocados. Which of the following is most likely to occur if a binding minimum wage (a price floor on wages) is set in the labor market of avocado-farming workers?', 'Supply of avocados will decrease.', 'Demand for avocados will decrease.', 'There will be a surplus of avocados.', 'Avocado producers will hire more workers.', 'The price of land used to grow avocados will increase.', 'A', '2025 AP 微观经济真题第 38 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 38);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'market-equilibrium';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'An air-conditioning unit is a normal good. Which of the following would cause an increase in the equilibrium price and equilibrium quantity of air-conditioning units in the short run?', 'Consumers expect a greater increase in the future price of air-conditioning units.', 'Producers expect a greater increase in the future price of air-conditioning units.', 'The price of air filters, an input in producing air-conditioning units, increases.', 'The price of fans, a substitute in consumption, decreases.', 'Consumers'' incomes decrease.', 'A', '2025 AP 微观经济真题第 39 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 39);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u4-price-discrimination';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'A firm is selling its product in two separate markets. If the firm practices price discrimination, it is most likely to charge a higher price in the market that:', 'has lower marginal cost', 'has no barriers to entry', 'contains a binding price ceiling', 'has fewer substitutes available', 'allows resale of the product', 'D', '2025 AP 微观经济真题第 40 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 40);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u3-perfect-competition';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'Which of the following differentiates a profit-maximizing firm in a perfectly competitive market from a profit-maximizing firm in an imperfectly competitive market?', 'A PC firm is a price maker; an imperfectly competitive firm is a price taker.', 'A PC firm minimizes average total cost in the short run; an imperfectly competitive firm maximizes total revenue in the short run.', 'A PC firm aims to maximize profit; an imperfectly competitive firm aims to maximize revenue.', 'A PC firm produces identical products; an imperfectly competitive firm produces differentiated products.', 'A PC firm can earn economic profit in the long run; an imperfectly competitive firm cannot earn economic profit in the long run.', 'D', '2025 AP 微观经济真题第 41 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 41);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'price-elasticity';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'A 5% increase in the price of Good A results in a 10% decrease in the quantity demanded of Good B. What is the cross-price elasticity between Good A and Good B, and what does this indicate about the relationship between these two goods?', '-1; Complements', '-2; Complements', '0.5; Complements', '-2; Substitutes', '0.5; Substitutes', 'B', '2025 AP 微观经济真题第 42 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 42);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u1-resource-allocation';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'Which of the following best explains the difference in resource allocation between a pure command economy and a pure market economy?', 'A pure command economy allocates resources based on individual choices, whereas a pure market economy allocates resources using central planning.', 'A pure command economy allocates resources to maximize profits, whereas a pure market economy allocates resources to maximize revenues.', 'A pure command economy allocates resources using central planning, whereas a pure market economy relies on market forces to allocate resources.', 'A pure command economy allocates resources to eliminate income inequalities, whereas a pure market economy allocates resources to eliminate negative externalities.', 'A pure command economy allocates resources to achieve allocative efficiency, whereas a pure market economy allocates resources to achieve productive efficiency.', 'C', '2025 AP 微观经济真题第 43 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 43);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u1-ppc';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'The graph shows a production possibilities curve for a country. Assuming no change in the country''s quantity and productivity of resources, the country can produce more capital goods without giving up any consumer goods if the country is currently producing at which point? (Refer to the PPC graph on the page.)', 'Point A', 'Point B', 'Point C', 'Point D', 'Point E', 'D', '2025 AP 微观经济真题第 44 题（官方题目，详解参考官方答案）。', 'published', 'https://umyzlbrjnklkpxmbdhvf.supabase.co/storage/v1/object/public/question-images/papers/2025/page-08.png', '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 44);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u5-monopsony';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'The table shows output and cost data for Whit''s Whistles, a firm that produces whistles. Whit''s Whistles is a profit-maximizing firm that hires workers from a monopsonistic labor market, the market for whistles is perfectly competitive, and the equilibrium price of whistles is $10. How many workers will Whit''s Whistles hire to maximize profits? (Refer to the data table on the page.)', '1', '2', '3', '4', '5', 'D', '2025 AP 微观经济真题第 45 题（官方题目，详解参考官方答案）。', 'published', 'https://umyzlbrjnklkpxmbdhvf.supabase.co/storage/v1/object/public/question-images/papers/2025/page-09.png', '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 45);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'price-elasticity';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'If the income elasticity of demand for Good X is negative, how will an increase in consumers'' income affect the market for Good X?', 'The demand curve will shift to the left, the equilibrium price will increase, and the equilibrium quantity will decrease.', 'The demand curve will shift to the left, and both the equilibrium price and quantity will decrease.', 'The demand curve will shift to the right, and both the equilibrium price and quantity will increase.', 'The supply curve will shift to the right, the equilibrium price will decrease, and the equilibrium quantity will increase.', 'The supply curve will shift to the left, the equilibrium price will increase, and the equilibrium quantity will decrease.', 'B', '2025 AP 微观经济真题第 46 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 46);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u4-monopolistic-competition';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'Suppose that Lindser Landscaping is the sole provider of landscaping services in a small city. A new firm, Horticultural Experts, enters the market. Which of the following is most likely to occur?', 'Lindser Landscaping''s demand will become more inelastic.', 'Lindser Landscaping''s total revenues will decrease.', 'Lindser Landscaping''s economic profit will increase.', 'The deadweight loss in the landscaping services market will increase.', 'The market price of landscaping services will increase.', 'B', '2025 AP 微观经济真题第 47 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 47);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u3-production-function';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'The graph below shows the marginal product and average product curves for a firm. Which of the following is true about the production function as labor usage increases from L1 to L2 when all other inputs are held constant? (Refer to the graph on the page.)', 'There are increasing marginal returns.', 'There are diminishing marginal returns.', 'There are decreasing returns to scale.', 'Total product is maximized when the firm hires L1 units of labor.', 'Total product is maximized when the firm hires L2 units of labor.', 'B', '2025 AP 微观经济真题第 48 题（官方题目，详解参考官方答案）。', 'published', 'https://umyzlbrjnklkpxmbdhvf.supabase.co/storage/v1/object/public/question-images/papers/2025/page-09.png', '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 48);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u4-monopolistic-competition';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'A firm in a monopolistically competitive market is producing the profit-maximizing quantity at 60 units of output at a price of $12 per unit. What is the firm''s economic profit if the firm''s average variable cost is $8, its marginal cost is $7, and its average fixed cost is $2 at 60 units of output?', '-$300', '$120', '$180', '$240', '$300', 'B', '2025 AP 微观经济真题第 49 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 49);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u5-factor-demand-supply';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'Which of the following would cause a decrease in both the market wage and the equilibrium quantity of labor?', 'A decrease in the supply of labor', 'A decrease in the price of labor', 'A decrease in the price of capital, a substitute for labor', 'An increase in the minimum wage', 'An increase in the productivity of labor', 'C', '2025 AP 微观经济真题第 50 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 50);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u6-public-goods';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'Good X, a popular item with consumers, is non-rival and non-excludable in consumption. What is the most likely outcome in the market for Good X if there is no government intervention?', 'Firms will provide the socially optimal quantity of Good X because consumers will have a demand for it.', 'Firms will provide the socially optimal quantity of Good X because they will be profitable in the short run.', 'Firms will provide the socially optimal quantity of Good X despite the fact that marginal social cost is greater than the marginal private cost at the equilibrium market quantity.', 'Firms will not provide the socially optimal quantity of Good X because people are able to consume it without having to pay for it.', 'Firms will not provide the socially optimal quantity of Good X because the marginal social cost is greater than the marginal private cost at the equilibrium market quantity.', 'D', '2025 AP 微观经济真题第 51 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 51);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u6-externalities';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'Which of the following is an example of a negative externality in production?', 'An electronics store decreases the price of TVs during the holidays.', 'A car insurance company charges a higher price for teenage drivers.', 'A local paper mill emits an odor imposing costs on nearby residents.', 'A pine tree in a public park provides pleasant shade for residents.', 'A photographer accepts a price for work below marginal cost.', 'C', '2025 AP 微观经济真题第 52 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 52);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u3-perfect-competition';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'The graph shows the cost and revenue curves for the firm Emma''s Hoops. Emma''s Hoops produces toy hoops that are identical to all other toy hoops produced by the many firms in a market with no barriers to entry. The market price of toy hoops is P2, and Emma''s Hoops is producing the quantity Q2 of toy hoops. Which of the following is true? (Refer to the graph on the page.)', 'The firm''s average fixed cost is equal to P2 - P1.', 'The firm is currently earning negative economic profits.', 'The firm is facing a perfectly inelastic demand curve.', 'The firm should decrease production to Q1 to maximize economic profits.', 'The firm should increase its price to P3 to maximize economic profits.', 'A', '2025 AP 微观经济真题第 53 题（官方题目，详解参考官方答案）。', 'published', 'https://umyzlbrjnklkpxmbdhvf.supabase.co/storage/v1/object/public/question-images/papers/2025/page-10.png', '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 53);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'government-intervention';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'If the government imposes a binding price ceiling in the gasoline market, which of the following will occur in the short run?', 'The demand for gasoline will increase.', 'The demand for gasoline will decrease.', 'The quantity demanded of gasoline will increase.', 'All individuals in the gasoline market will be better off.', 'All individuals in the gasoline market will be worse off.', 'C', '2025 AP 微观经济真题第 54 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 54);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u1-comparative-advantage';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'The table shows the number of labor hours it takes Alpha and Beta to produce a smartphone or a cake with the same resources. If tasks are assigned according to comparative advantage, which of the following is true? (Refer to the labor-hours table on the page.)', 'Alpha will produce both goods.', 'Beta will produce both goods.', 'Alpha will produce cellphones and Beta will produce cakes.', 'Alpha will produce cakes and Beta will produce cellphones.', 'Alpha has an absolute advantage in producing all goods.', 'D', '2025 AP 微观经济真题第 55 题（官方题目，详解参考官方答案）。', 'published', 'https://umyzlbrjnklkpxmbdhvf.supabase.co/storage/v1/object/public/question-images/papers/2025/page-10.png', '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 55);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'demand';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'The market for bottled mineral water is perfectly competitive. After the discovery of several new sources of mineral water, the price of bottled mineral water decreases. The substitution effect of the price decrease implies an increase in which of the following?', 'The supply of bottled mineral water', 'The quantity demanded of bottled mineral water', 'The demand for bottled mineral water', 'The demand for bottled purified water, a substitute in consumption', 'The total revenue of firms selling bottled mineral water', 'B', '2025 AP 微观经济真题第 56 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 56);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u3-profit-maximization';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'Royal Bolts is a profit-maximizing firm in a perfectly competitive market earning positive economic profit. Which of the following will cause an increase in both the firm''s profit and the number of units it produces in the short run?', 'The imposition of a per-unit tax on producers', 'An increase in the price of a substitute in consumption', 'An increase in consumers'' incomes if the product is an inferior good', 'A decrease in the rent for the factory, a fixed input', 'A decrease in the expected future price of the product by consumers', 'B', '2025 AP 微观经济真题第 57 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 57);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u6-inequality';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'Discrimination in the workplace is one source of which of the following?', 'Income and wealth inequality', 'Productive efficiency', 'Regressive income tax systems', 'Formation of monopolies', 'Scarcity of resources', 'A', '2025 AP 微观经济真题第 58 题（官方题目，详解参考官方答案）。', 'published', NULL, '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 58);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u6-efficiency';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'The table shows the market price, quantity of a good exchanged, and the resulting deadweight loss in five different market structures. Which market displays outcomes that are consistent with the results under perfect competition? (Refer to the table on the page.)', 'Market 1', 'Market 2', 'Market 3', 'Market 4', 'Market 5', 'D', '2025 AP 微观经济真题第 59 题（官方题目，详解参考官方答案）。', 'published', 'https://umyzlbrjnklkpxmbdhvf.supabase.co/storage/v1/object/public/question-images/papers/2025/page-11.png', '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 59);


  SELECT id INTO kp_uuid FROM public.knowledge_points WHERE slug = 'u3-short-run-costs';
  INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status, image_url, term_tags)
  VALUES (kp_uuid, 'basic', 2, 'The table shows the total cost schedule for a firm. The average variable cost of producing 25 units of output is: (Refer to the cost table on the page.)', '$4.00', '$5.00', '$7.50', '$9.00', '$10.00', 'B', '2025 AP 微观经济真题第 60 题（官方题目，详解参考官方答案）。', 'published', 'https://umyzlbrjnklkpxmbdhvf.supabase.co/storage/v1/object/public/question-images/papers/2025/page-11.png', '{}')
  RETURNING id INTO q_uuid;
  INSERT INTO public.paper_questions (paper_id, question_id, sort_order) VALUES (paper_uuid, q_uuid, 60);


  INSERT INTO public.paper_frqs (paper_id, sort_order, title, content, image_url) VALUES
    (paper_uuid, 1, 'FRQ 1 · 完全竞争与互补品', '**1.** Tronic 是一家典型的、追求利润最大化的企业，在一个成本不变（constant-cost）的完全竞争市场中生产并销售电源线，且市场处于长期均衡。市场均衡价格为 $4。

**(a)** 画出电源线市场和 Tronic 的并排图，并标出：
- i. 市场均衡价格和数量，分别标记为 $4 和 Q_M
- ii. Tronic 的利润最大化价格和数量，分别标记为 P_F 和 Q_F
- iii. Tronic 与长期均衡一致的平均总成本曲线，标记为 ATC

**(b)** 与电源线互补的 Good X 的价格上升。在 (a) 的图上展示这一变化在短期对以下各项的影响：
- i. 电源线市场新的均衡价格和数量，分别标记为 P2 和 Q2
- ii. Tronic 新的利润最大化价格和数量，分别标记为 P* 和 Q*
- iii. 完全涂色表示 Tronic 经济利润的区域

**(c)** 鉴于 Good X 价格上升，市场从 (b) 中的短期均衡调整到长期均衡时，电源线的市场均衡价格和数量将如何变化？请解释。

**(d)** Tronic 使用资本和劳动的成本最小化组合进行生产。劳动的边际产量是 75 条电源线，工资率为 $25，资本的租赁率为 $40。计算资本的边际产量。**写出计算过程。**

**(e)** 消费者可以选择使用电源线或智能数据线。智能数据线价格下降 10%，导致智能数据线的需求量上升 12%，而电源线的需求量下降 8%。计算电源线对智能数据线价格的交叉价格弹性。**写出计算过程。**', 'https://umyzlbrjnklkpxmbdhvf.supabase.co/storage/v1/object/public/question-images/papers/2025/page-13.png'),
    (paper_uuid, 2, 'FRQ 2 · 效用最大化与外部性', '**2.** 表格显示了 Yuni 消费网球拍和 T 恤的边际效用（详见图片）。Yuni 是追求效用最大化的消费者。

**(a)** 如果 Yuni 可以免费选择 1 支网球拍 或 2 件 T 恤，她会选择哪个？请用数字解释。

**(b)** 假设网球拍价格是 $100，T 恤价格是 $50，Yuni 的收入是 $500，且她将所有收入用于购买网球拍和 T 恤。
- i. 如果 Yuni 购买 2 支网球拍，她最多还能购买多少件 T 恤？
- ii. 使 Yuni 总效用最大化的网球拍和 T 恤组合是什么？请用边际分析和数字解释。

**(c)** 网球拍市场处于均衡状态，并产生消费的正外部性。
- i. 在市场均衡时，网球拍的边际社会收益**大于、小于还是等于**网球拍的边际社会成本？
- ii. 政府向网球拍生产者提供单位补贴，该补贴是否会增加消费者购买的网球拍数量？请解释。', 'https://umyzlbrjnklkpxmbdhvf.supabase.co/storage/v1/object/public/question-images/papers/2025/page-14.png'),
    (paper_uuid, 3, 'FRQ 3 · 垄断竞争', '**3.** 图中展示了 Haye 的成本和收益曲线（详见图片）。Haye 是众多生产保湿剂的企业之一，市场中每家企业的产品略有差异，且没有进入或退出壁垒。

**(a)** 指出 Haye 所处的市场结构。

**(b)** 指出 Haye 的利润最大化数量和价格。

**(c)** 计算 (b) 中利润最大化数量和价格下的消费者剩余。**写出计算过程。**

**(d)** (b) 中确定的利润最大化数量是否实现了配置效率（allocatively efficient）？请用数字解释。

**(e)** 图中的市场结构在长期内是否会出现进入或退出？请解释。', 'https://umyzlbrjnklkpxmbdhvf.supabase.co/storage/v1/object/public/question-images/papers/2025/page-15.png');
END $$;
