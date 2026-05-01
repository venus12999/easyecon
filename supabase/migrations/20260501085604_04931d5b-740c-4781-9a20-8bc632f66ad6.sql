
INSERT INTO public.knowledge_points (slug, name_en, name_zh, unit, sort_order, description) VALUES
('u3-production-function', 'The Production Function', '生产函数', 3, 301, 'Short-run vs long-run, marginal product, diminishing returns'),
('u3-short-run-costs', 'Short-run Production Costs', '短期生产成本', 3, 302, 'TFC/TVC/TC, AFC/AVC/ATC, MC 关系'),
('u3-long-run-costs', 'Long-run Production Costs', '长期生产成本', 3, 303, 'Economies / diseconomies of scale, LRATC'),
('u3-types-of-profit', 'Types of Profit', '利润类型（会计/经济）', 3, 304, 'Explicit / implicit costs, accounting vs economic profit'),
('u3-profit-maximization', 'Profit Maximization', '利润最大化', 3, 305, 'MR=MC 规则与 TR-TC 视角'),
('u3-shutdown-entry-exit', 'Short-run Shutdown & Long-run Entry/Exit', '短期停产与长期进出市场', 3, 306, 'Shutdown rule, supply curve, long-run adjustment'),
('u3-perfect-competition', 'Perfect Competition', '完全竞争', 3, 307, 'PC firm / industry, long-run equilibrium, allocative efficiency')
ON CONFLICT (slug) DO NOTHING;
