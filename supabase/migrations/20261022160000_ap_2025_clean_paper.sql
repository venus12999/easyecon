-- 2025 paper: section clocks, the printed option E, and figures without handwritten answers.
-- Clean figure files live at /papers/2025/ and are also applied in the app if this has not been run yet.

UPDATE public.mock_papers
SET total_seconds = 4200,
    frq_seconds = 3600,
    break_seconds = 600
WHERE slug = 'ap-micro-2025';

UPDATE public.questions AS q
SET option_e = 'Consumer surplus would equal 630, and deadweight loss could decrease by 180.'
FROM public.paper_questions AS pq
JOIN public.mock_papers AS p ON p.id = pq.paper_id
WHERE pq.question_id = q.id
  AND p.slug = 'ap-micro-2025'
  AND q.stem ILIKE '%perfect price discrimination%';

UPDATE public.questions AS q
SET image_url = v.image_url
FROM public.paper_questions AS pq
JOIN public.mock_papers AS p ON p.id = pq.paper_id
JOIN (VALUES
  ('%perfect price discrimination%', '/papers/2025/mcq-03.png'),
  ('%Nick''s Barbecue%', '/papers/2025/mcq-05.png'),
  ('%socially optimal quantity%', '/papers/2025/mcq-08.png'),
  ('%Olivia%', '/papers/2025/mcq-11.png'),
  ('%soybean%', '/papers/2025/mcq-13.png'),
  ('%market supply schedule%', '/papers/2025/mcq-22.png'),
  ('%Deltaland%', '/papers/2025/mcq-27.png'),
  ('%FineSeat%', '/papers/2025/mcq-31.png'),
  ('%per-unit subsidy%', '/papers/2025/mcq-33.png'),
  ('%LuxEcon%', '/papers/2025/mcq-36.png'),
  ('%production possibilities curve%', '/papers/2025/mcq-44.png'),
  ('%Whit''s Whistles%', '/papers/2025/mcq-45.png'),
  ('%marginal product and average product%', '/papers/2025/mcq-48.png'),
  ('%Emma''s Hoops%', '/papers/2025/mcq-53.png'),
  ('%Alpha and Beta%', '/papers/2025/mcq-55.png'),
  ('%five different market structures%', '/papers/2025/mcq-59.png'),
  ('%average variable cost of producing 25%', '/papers/2025/mcq-60.png')
) AS v(stem_like, image_url) ON q.stem ILIKE v.stem_like
WHERE pq.question_id = q.id
  AND p.slug = 'ap-micro-2025';

UPDATE public.paper_frqs AS f
SET title = 'FRQ 1',
    image_url = NULL,
    content = $frq$Tronic is a typical profit-maximizing firm that produces and sells power cords in a constant-cost, perfectly competitive market that is in long-run equilibrium. The market equilibrium price of power cords is $4.

(a) Draw correctly labeled side-by-side graphs for the power cord market and for Tronic, and show each of the following.
i. The market equilibrium price and quantity, labeled $4 and Q_M respectively.
ii. Tronic's profit-maximizing price and quantity, labeled P_F and Q_F respectively.
iii. Tronic's average total cost curve consistent with long-run equilibrium, labeled ATC.

(b) The price of Good X, a complement in consumption to power cords, has increased. On your graphs in part (a), show the impact of this change in the short run on each of the following.
i. The new market equilibrium price and quantity of power cords, labeled P_2 and Q_2 respectively.
ii. Tronic's new profit-maximizing price and quantity, labeled P* and Q* respectively.
iii. The area representing Tronic's economic profit, shaded completely.

(c) Given the increase in the price of Good X, what will happen to the market equilibrium price and quantity of power cords as the market adjusts from the short-run equilibrium in part (b) to the long-run equilibrium? Explain.

(d) Tronic uses the cost-minimizing combination of capital and labor in its production process. The marginal product of labor is 75 power cords, the wage rate is $25, and the rental rate for capital is $40. Calculate the marginal product of capital. Show your work.

(e) Consumers can choose whether to use power cords or smart cables. A 10 percent decrease in the price of smart cables caused the quantity demanded of smart cables to increase by 12 percent and the quantity demanded of power cords to decrease by 8 percent. Calculate the cross-price elasticity of demand for power cords with respect to the price of smart cables. Show your work.$frq$
FROM public.mock_papers AS p
WHERE f.paper_id = p.id
  AND p.slug = 'ap-micro-2025'
  AND f.sort_order = 1;

UPDATE public.paper_frqs AS f
SET title = 'FRQ 2',
    image_url = NULL,
    content = $frq$The table shows the marginal utility Yuni receives from tennis rackets and shirts.

<table>
<tr><th>Quantity of Tennis Rackets</th><th>Marginal Utility of Tennis Rackets (utils)</th><th>Quantity of Shirts</th><th>Marginal Utility of Shirts (utils)</th></tr>
<tr><td>1</td><td>600</td><td>1</td><td>400</td></tr>
<tr><td>2</td><td>400</td><td>2</td><td>300</td></tr>
<tr><td>3</td><td>200</td><td>3</td><td>200</td></tr>
<tr><td>4</td><td>100</td><td>4</td><td>100</td></tr>
<tr><td>5</td><td>50</td><td>5</td><td>50</td></tr>
<tr><td>6</td><td>0</td><td>6</td><td>25</td></tr>
</table>

Yuni is a utility-maximizing consumer.

(a) If Yuni is allowed to choose either one tennis racket or two shirts for free, which of the two options will Yuni choose? Explain using numbers.

(b) Suppose instead the price of a tennis racket is $100, the price of a shirt is $50, and Yuni's income is $500. Yuni spends all her income on tennis rackets and shirts.
i. If Yuni purchased two tennis rackets, what is the maximum quantity of shirts Yuni can purchase?
ii. What is the combination of tennis rackets and shirts that maximizes Yuni's total utility? Explain using marginal analysis and numbers.

(c) The market for tennis rackets is in equilibrium and generates a positive externality in consumption.
i. At the market equilibrium, is the marginal social benefit of tennis rackets greater than, less than, or equal to the marginal social cost of tennis rackets?
ii. The government grants a per-unit subsidy to producers of tennis rackets. Will the subsidy increase the quantity of tennis rackets purchased by consumers? Explain.$frq$
FROM public.mock_papers AS p
WHERE f.paper_id = p.id
  AND p.slug = 'ap-micro-2025'
  AND f.sort_order = 2;

UPDATE public.paper_frqs AS f
SET title = 'FRQ 3',
    image_url = '/papers/2025/frq-03.png',
    content = $frq$The graph shows the cost and revenue curves for Haye. Haye is one of many firms that produce moisturizers in a market in which each firm slightly differentiates its product, and there are no barriers to entry or exit.

(a) Identify the market structure in which Haye is operating.

(b) Identify Haye's profit-maximizing quantity and price.

(c) Calculate the consumer surplus at the profit-maximizing quantity and price identified in part (b). Show your work.

(d) Is the profit-maximizing quantity identified in part (b) allocatively efficient? Explain using numbers.

(e) What will happen to Haye's economic profit in the long run? Explain.$frq$
FROM public.mock_papers AS p
WHERE f.paper_id = p.id
  AND p.slug = 'ap-micro-2025'
  AND f.sort_order = 3;
