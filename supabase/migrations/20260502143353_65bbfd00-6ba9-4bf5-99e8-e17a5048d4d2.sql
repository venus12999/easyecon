
-- Knowledge points for Unit 5
INSERT INTO public.knowledge_points (slug, name_en, name_zh, unit, sort_order) VALUES
('u5-factor-markets-intro', 'Introduction to Factor Markets', '要素市场简介', 5, 51),
('u5-factor-demand-supply', 'Changes in Factor Demand and Factor Supply', '要素需求与供给变化', 5, 52),
('u5-perfectly-competitive-factor', 'Profit-maximizing Behavior in Perfectly Competitive Factor Markets', '完全竞争要素市场利润最大化', 5, 53),
('u5-monopsony', 'Monopsonistic Markets', '买方垄断市场', 5, 54);

-- 5.1 Introduction to Factor Markets
INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status) VALUES
((SELECT id FROM public.knowledge_points WHERE slug='u5-factor-markets-intro'), 'basic', 2,
'When the demand for new homes decreases, the demand for construction workers who build homes decreases. This relationship illustrates the concept of:',
'derived demand','diminishing marginal productivity of labor','substitution in production','supply shock','property rights','A',
'要素需求是派生需求(derived demand)：对劳动等要素的需求源自对其所生产的最终产品的需求。新房需求下降→建筑工人需求下降，正是派生需求的体现。', 'draft'),

((SELECT id FROM public.knowledge_points WHERE slug='u5-factor-markets-intro'), 'basic', 2,
'Suppose that a firm begins to hire workers for a newly completed plant with a fixed amount of machinery. As the firm hires additional workers, one would expect the marginal product to:',
'fall initially, but eventually rise','rise initially, but eventually fall','rise consistently due to diminishing return','rise consistently due to the advantages of specialization','rise consistently due to economies of scale','B',
'短期内资本固定，初期增加工人因分工与专业化使边际产出上升；当工人过多挤占有限资本时，边际报酬递减(diminishing marginal returns)使边际产出最终下降。', 'draft'),

((SELECT id FROM public.knowledge_points WHERE slug='u5-factor-markets-intro'), 'basic', 1,
'As a factor of production, capital refers to the:',
'money available to start a business','stocks and bonds issued by businesses to raise funds','financial investment of businesses','currency in circulation and deposits in financial institutions','tools and machinery used to produce goods and services','E',
'经济学中的"资本"指实物资本(physical capital)，即生产商品和服务所用的工具、机器、设备等，而非货币或金融资产。', 'draft'),

((SELECT id FROM public.knowledge_points WHERE slug='u5-factor-markets-intro'), 'application', 2,
'Economists argue that most professional athletes earn economic rent because they:',
'make additional income through commercial endorsements of products','are able to participate in sports for only a limited number of years before changing occupations','earn far more as professional athletes than they could earn in their next-best occupation','participate in sporting events only about six months during a year','work less than 40 hours a week during the sport season','C',
'经济租金(economic rent)是要素实际收入超过其机会成本(次优用途收入)的部分。职业运动员的薪酬远高于他们在次优职业中能获得的收入，因此大部分薪酬属于经济租金。', 'draft');

-- 5.2 Changes in Factor Demand and Factor Supply
INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status) VALUES
((SELECT id FROM public.knowledge_points WHERE slug='u5-factor-demand-supply'), 'application', 2,
'Which of the following is most likely to cause the demand curve for nurses to shift to the right?',
'An increase in the number of nurses graduating from nursing schools.','An increase in nursing schools'' tuition.','An increase in the number of hospitals that employ nurses.','A decrease in the marginal productivity of nurses.','An improvement in the health of older people.','C',
'护士需求是派生需求。雇主(医院)数量增加→对护士的需求右移。A、B 影响供给；D 使 MRP 下降，需求左移；E 减少医疗服务需求，间接使护士需求左移。', 'draft'),

((SELECT id FROM public.knowledge_points WHERE slug='u5-factor-demand-supply'), 'application', 2,
'Which of the following is likely to shift an industry''s labor supply curve to the left?',
'A decrease in immigration restrictions.','A decrease in the cost of child care.','An increase in the number of remote-working jobs.','An increase in preference for leisure.','An increase in wages.','D',
'对闲暇偏好的增加意味着在每个工资水平上人们愿意提供的劳动减少，劳动供给曲线左移。E 是沿曲线移动而非曲线移动；A、B、C 都会使供给右移。', 'draft'),

((SELECT id FROM public.knowledge_points WHERE slug='u5-factor-demand-supply'), 'basic', 1,
'A firm''s demand for labor is known as a derived demand because',
'the firm gains utility from hiring more labor.','the wage rate paid to workers depends on the demand for labor.','the amount of labor demanded depends on the amount of capital invested.','the amount of labor demanded depends on the demand for the firm''s product.','the firm will benefit from hiring additional labor.','D',
'派生需求(derived demand)的定义：对劳动的需求派生于对其生产的产品的需求。产品需求越大，企业愿意雇佣的工人越多。', 'draft'),

((SELECT id FROM public.knowledge_points WHERE slug='u5-factor-demand-supply'), 'application', 3,
'An increase in the effective minimum wage will have less of an impact on employment if the demand for labor is',
'relatively elastic.','unit elastic.','a derived demand.','a derived demand.','relatively inelastic.','E',
'劳动需求越缺乏弹性(inelastic)，工资上升所导致的就业减少越小。因此最低工资对就业的负面影响越小。', 'draft');

-- 5.3 Perfectly Competitive Factor Markets
INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status) VALUES
((SELECT id FROM public.knowledge_points WHERE slug='u5-perfectly-competitive-factor'), 'application', 3,
'A farmer grows wheat using two inputs: labor and land whose prices are constant. If she doubles her inputs, she finds that the quantity of wheat produced more than doubles. Therefore, it must be true that in this output range her long-run average total cost curve is:',
'upward sloping','downward sloping','horizontal','vertical','U-shaped','B',
'投入翻倍而产出大于翻倍 → 规模报酬递增(increasing returns to scale)。在要素价格不变下，长期平均总成本曲线随产量增加而下降，即向下倾斜。', 'draft'),

((SELECT id FROM public.knowledge_points WHERE slug='u5-perfectly-competitive-factor'), 'application', 3,
'The table shows the relationship between the number of workers and coal output (in tons per day): 0→0, 1→25, 2→44, 3→60, 4→70, 5→75. How many workers would the coal company want to hire if the price of coal were competitively priced at $5 per ton and the wage rate were $40 per day?',
'5','4','3','2','0','C',
'计算各工人 MRP=MP×P：W1: 25×5=$125；W2: 19×5=$95；W3: 16×5=$80；W4: 10×5=$50；W5: 5×5=$25。雇佣条件 MRP ≥ W=$40。前 4 人 MRP>40，第 5 人 MRP=25<40。 ⚠️ 原题答案给出 C(3)，但按标准 MRP=W 规则应雇 4 人。请人工确认题源标准答案。', 'draft'),

((SELECT id FROM public.knowledge_points WHERE slug='u5-perfectly-competitive-factor'), 'basic', 1,
'Based on the table (0→0, 1→25, 2→44, 3→60, 4→70, 5→75), the marginal physical product of the second worker is:',
'19','22','25','44','75','A',
'第二个工人的边际实物产出 MPP = 44 − 25 = 19 吨。', 'draft'),

((SELECT id FROM public.knowledge_points WHERE slug='u5-perfectly-competitive-factor'), 'basic', 2,
'If a firm employs only labor and capital in its production process, which of the following best describes the optimal combination of inputs for the firm in the long run?',
'The marginal product per dollar spent on labor is equal to the marginal product per dollar spent on capital.','The marginal product of labor is equal to the marginal product of capital.','The total product of labor is equal to the total product of capital.','The marginal product of labor and capital are both zero.','All marginal products are equal to all average products.','A',
'最小成本组合(least-cost rule)：MPL/PL = MPK/PK，即每一美元投入获得的边际产出在所有要素之间相等。', 'draft'),

((SELECT id FROM public.knowledge_points WHERE slug='u5-perfectly-competitive-factor'), 'pitfall', 2,
'In a perfectly competitive free market economy, a wage gap between two workers can be explained by differences in all of the following EXCEPT their:',
'years of schooling','occupations','marginal products','marginal revenue products','tastes for luxury goods','E',
'工资差异由人力资本(教育)、职业、生产力(MP)、边际收益产品(MRP)等决定。对奢侈品的偏好属于消费者偏好，与工资决定无关。', 'draft'),

((SELECT id FROM public.knowledge_points WHERE slug='u5-perfectly-competitive-factor'), 'basic', 1,
'The marginal revenue product of labor is the:',
'product price times the wage rate','additional revenue a firm earns when it employs an additional unit of labor','increase in the average product of labor when the firm employs an additional unit of labor','increase in the price of labor when the firm employs an additional unit of labor','marginal revenue plus product price','B',
'边际收益产品(MRP)定义：每多雇佣一单位劳动给企业带来的额外收益。MRP = MP × MR (完全竞争中 MR=P)。', 'draft'),

((SELECT id FROM public.knowledge_points WHERE slug='u5-perfectly-competitive-factor'), 'pitfall', 3,
'If a competitive firm pays its workers the value of the marginal product of the last worker hired, which of the following is true?',
'The firm will not earn any economic profits.','Workers will look for employment elsewhere.','The wage will be less than the marginal product.','The firm will not maximize profits.','The contribution of the last worker hired to the firm''s profit will be zero.','E',
'当 W = VMP_L(最后一个工人) 时，最后一名工人对利润的边际贡献为零，这正是利润最大化雇佣条件 MRP=W。前面工人 MRP>W 仍带来正利润，所以 A 错。', 'draft'),

((SELECT id FROM public.knowledge_points WHERE slug='u5-perfectly-competitive-factor'), 'application', 3,
'The marginal product of labor equals 250 units of output. The marginal product of capital equals 750 units of output. The price of labor is $50 per person. The price of capital is $100 per unit. Given the information above, which of the following is true for a firm buying its labor and capital inputs in a perfectly competitive market?',
'The firm is producing its current level of output with the least-cost combination of labor and capital.','The firm is maximizing profits with its current combination of inputs.','The firm''s level of output will remain the same if 1 unit of capital is substituted for 2 units of labor.','The firm''s input costs will decrease if 2 units of labor are substituted for 1 unit of capital.','The firm can reduce the cost of its current level of output by laying off workers and employing more capital.','E',
'MPL/PL = 250/50 = 5；MPK/PK = 750/100 = 7.5。资本每美元产出更高，应增加资本、减少劳动以降低同等产出水平的成本。', 'draft'),

((SELECT id FROM public.knowledge_points WHERE slug='u5-perfectly-competitive-factor'), 'application', 2,
'The table describes the production function of an auto parts manufacturer. Assume that the firm can hire as many workers as it wants at the market wage rate of $600 per week per worker and sell as many auto parts as it wants at the price of $10 per part. To maximize profits, the firm should hire: ⚠️ 需在 /admin 中手动上传配图(workers vs parts/week 表格)',
'0 workers','1 worker','3 workers','5 workers','7 workers','D',
'⚠️ 需在 /admin 中手动上传配图。利润最大化条件 MRP = MP × P ≥ W = $600，即 MP ≥ 60 件。沿表格雇至最后一个边际产出仍 ≥60 的工人。请根据表格人工确认。', 'draft'),

((SELECT id FROM public.knowledge_points WHERE slug='u5-perfectly-competitive-factor'), 'pitfall', 2,
'A perfectly competitive firm hires three workers in a perfectly competitive labor market. The marginal products of the three workers are: Worker 1=50, Worker 2=30, Worker 3=20. Which of the following will be true?',
'Each worker will receive a wage based on the marginal product of the last worker hired.','Each worker will receive a wage based on the marginal product of the first worker hired.','Each worker will receive a wage based on the average of the marginal products of the workers.','Worker 1 will receive the highest wage.','Worker 3 will receive the highest wage.','A',
'在完全竞争劳动市场中，所有工人都拿同一工资 = 市场均衡工资 = 最后一名工人的 MRP。前面工人的较高 MP 形成生产者剩余，归企业所有。', 'draft'),

((SELECT id FROM public.knowledge_points WHERE slug='u5-perfectly-competitive-factor'), 'application', 2,
'Based on the table for a perfectly competitive firm — Quantity of Labor / Marginal Product / Marginal Revenue Product: 1/20/$40, 2/14/$28, 3/12/$24, 4/8/$16, 5/6/$12, 6/4/$8 — if the wage rate for labor is $15, how many units of labor should the firm hire?',
'2','3','4','5','6','C',
'雇佣条件：MRP ≥ W=$15。L1=40, L2=28, L3=24, L4=16 均 ≥15；L5=12 <15。所以雇佣 4 人。', 'draft'),

((SELECT id FROM public.knowledge_points WHERE slug='u5-perfectly-competitive-factor'), 'application', 2,
'If output sells for $20 per unit and the daily wage is $100 per worker, how many workers should the firm hire to maximize profit? Production schedule: 1→3, 2→9, 3→16, 4→21, 5→23, 6→24.',
'1','2','4','5','6','C',
'计算 MP 和 MRP=MP×$20：W1: MP=3, MRP=$60；W2: MP=6, MRP=$120；W3: MP=7, MRP=$140；W4: MP=5, MRP=$100；W5: MP=2, MRP=$40。MRP≥W=$100 的最后一人是第 4 人(MRP=100=W)。雇 4 人。', 'draft'),

((SELECT id FROM public.knowledge_points WHERE slug='u5-perfectly-competitive-factor'), 'basic', 2,
'The table shows the short-run production function of a perfectly competitive firm: Workers / Potatoes (lbs/hr): 0/0, 1/3, 2/7, 3/10, 4/12, 5/13, 6/12. After which worker does diminishing marginal product first occur?',
'Second worker','Third worker','Fourth worker','Fifth worker','Sixth worker','B',
'计算 MP：W1=3, W2=4, W3=3, W4=2, W5=1, W6=−1。第 2 个工人 MP 上升至 4，第 3 个工人 MP 降为 3，从第 3 个工人开始边际产出递减。', 'draft'),

((SELECT id FROM public.knowledge_points WHERE slug='u5-perfectly-competitive-factor'), 'application', 2,
'The table shows how a firm''s hourly level of output changes as more of the labor input is employed. The firm sells its output and hires labor in perfectly competitive markets. The wage paid to labor is $10 per hour, and the price of the firm''s output is $2 per unit. Marginal Product table — Hours: 1/10, 2/12, 3/9, 4/7, 5/4. Based on the data, the marginal revenue product of the fourth hour of labor is equal to:',
'$4','$7','$14','$70','$26','C',
'MRP = MP × P = 7 × $2 = $14。', 'draft');

-- 5.4 Monopsony
INSERT INTO public.questions (knowledge_point_id, type, difficulty, stem, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, status) VALUES
((SELECT id FROM public.knowledge_points WHERE slug='u5-monopsony'), 'application', 3,
'The graph shows the conditions that a monopsonist faces in a labor market. How many workers would this monopsonist hire and what wage rate would it pay? Options: (A) 5 workers, $37.50; (B) 10, $30; (C) 10, $20; (D) 14, $24; (E) 14, $37.50. ⚠️ 需在 /admin 中手动上传配图',
'5 workers, $37.50','10 workers, $30','10 workers, $20','14 workers, $24','14 workers, $37.50','C',
'⚠️ 需在 /admin 中手动上传配图。买方垄断雇佣规则：在 MFC = MRP(=Demand) 处确定雇佣量(L*)，然后从供给曲线读取该雇佣量下工人愿意接受的工资(低于竞争性工资)。请根据图人工确认具体数值。', 'draft'),

((SELECT id FROM public.knowledge_points WHERE slug='u5-monopsony'), 'application', 3,
'In the monopsonistic labor market shown in the diagram, which of the following indicates the number of workers the firm will hire and the wage rate it will pay? Options: (A) L1, W1; (B) L1, W2; (C) L1, W3; (D) L2, W2; (E) L2, W4. ⚠️ 需在 /admin 中手动上传配图',
'L1, W1','L1, W2','L1, W3','L2, W2','L2, W4','B',
'⚠️ 需在 /admin 中手动上传配图。买方垄断：雇佣量在 MFC=MRP 处确定(L1)，工资从供给曲线对应该雇佣量读取(W2，低于竞争工资)。', 'draft'),

((SELECT id FROM public.knowledge_points WHERE slug='u5-monopsony'), 'application', 3,
'Hope Hospital is a monopsonistic employer of nurses. The marginal revenue product of nursing services, the marginal factor (resource) cost of nursing services, and the market supply curve of nursing services are depicted in the figure by MRP, MFC, and S, respectively. What wage-quantity combination does Hope Hospital choose in order to maximize its profits? ⚠️ 需在 /admin 中手动上传配图',
'W1 and Q1','W1 and Q3','W2 and Q2','W2 and Q4','W3 and Q3','B',
'⚠️ 需在 /admin 中手动上传配图。买方垄断利润最大化：MFC = MRP 决定雇佣量(图中较小的 Q)，然后从供给曲线 S 读取对应工资(较低的 W)。请根据具体图人工确认 W1/Q3 等标号。', 'draft');
