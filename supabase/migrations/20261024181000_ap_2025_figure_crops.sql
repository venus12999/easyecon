-- 2025 paper: store the cropped table and graphs. Full exam pages are not question figures.
-- FRQ 1 asks students to draw, so its answered page stays off the question.

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
  AND p.slug = 'ap-micro-2025'
  AND COALESCE(q.image_url, '') ~ '/page-[0-9]+\.';

UPDATE public.questions AS q
SET image_url = '/papers/2025/mcq-03.png'
FROM public.paper_questions AS pq
JOIN public.mock_papers AS p ON p.id = pq.paper_id
WHERE pq.question_id = q.id
  AND p.slug = 'ap-micro-2025'
  AND pq.sort_order = 3
  AND COALESCE(q.image_url, '') ~ '/page-[0-9]+\.';

UPDATE public.paper_frqs AS f
SET image_url = NULL
FROM public.mock_papers AS p
WHERE f.paper_id = p.id
  AND p.slug = 'ap-micro-2025'
  AND f.sort_order = 1
  AND COALESCE(f.image_url, '') ~ '/page-[0-9]+\.';

UPDATE public.paper_frqs AS f
SET title = 'FRQ 2',
    image_url = '/papers/2025/frq-02.png',
    content = $frq$The table shows the marginal utility Yuni receives from tennis rackets and shirts.

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
SET image_url = '/papers/2025/frq-03.png'
FROM public.mock_papers AS p
WHERE f.paper_id = p.id
  AND p.slug = 'ap-micro-2025'
  AND f.sort_order = 3
  AND (
    f.image_url IS NULL
    OR f.image_url ~ '/page-[0-9]+\.'
    OR f.image_url = '/papers/2025/frq-03.png'
  );
