# alibaba1688

Use this skill to search 1688 products, fetch opportunity data, and fetch trend data.

This skill is designed for weak agents. Do not operate the 1688 web page manually. Call the provided CLI, MCP tool, or exported function.

## Golden Rule For Weak Agents

Never click 1688 search pages by yourself.

Always use one of these stable entries:

1. CLI web search:

```bash
node bin/cli.js search-1688-web "<keyword>" --max-products 20 --max-resolve-links 8 --json
```

2. MCP `search_products` with `mode: "web"`:

```json
{
  "coreWord": "<keyword>",
  "blueOceanWord": "<keyword>",
  "modifiers": [],
  "semanticGroups": {},
  "mode": "web",
  "port": 9222,
  "maxProducts": 20,
  "maxResolveLinks": 8
}
```

3. Node API:

```js
const { searchWeb1688 } = require("./skills/alibaba1688");

const result = await searchWeb1688({
  keyword: "<keyword>",
  port: 9222,
  maxProducts: 20,
  maxResolveLinks: 8
});
```

## What This Skill Does

- API search: uses the existing 1688 API. Requires `ALI_1688_AK`.
- Web search: uses the user's existing Chrome CDP session on port `9222`.
- Hybrid search: tries API and web search, then merges results.
- Trend and opportunity tools: use existing API endpoints.

## Use Web Search When

Use web search when the user asks to search 1688 directly, filter products on the 1688 website, find goods from 1688 pages, or when API search returns too few products.

Web search is preferred for weak agents because it hides page details:

- The tool opens the 1688 search URL.
- The tool uses GBK keyword encoding required by 1688 search.
- The tool can apply page filters before extracting products.
- The tool scrolls the page to load lazy product cards before extraction.
- The tool extracts product cards.
- The tool resolves `dj.1688.com` redirect links.
- The tool canonicalizes mobile detail URLs into `https://detail.1688.com/offer/<offerId>.html`.
- The tool closes temporary tabs used for redirect resolution.

## Required Chrome State

Before web search, Chrome must expose CDP:

```text
http://127.0.0.1:9222/json/version
```

If CDP is unavailable, stop and tell the user:

```text
Chrome CDP is not available on port 9222. Please start Chrome with --remote-debugging-port=9222 and keep the logged-in 1688 session open.
```

Do not attempt password login, SMS login, QR login, or slider handling.

## CLI Recipes

Basic search:

```bash
node bin/cli.js search-1688-web "<keyword>" --max-products 20 --max-resolve-links 8 --json
```

Before search, check browser readiness:

```bash
node bin/cli.js search-1688-web-health --json
```

The tool scrolls the page automatically. If the page is slow, increase scroll steps:

```bash
node bin/cli.js search-1688-web "<keyword>" --max-products 20 --scroll-steps 12 --json
```

If the user wants 40-50 products, allow multiple result pages:

```bash
node bin/cli.js search-1688-web "<keyword>" --max-products 50 --max-pages 3 --scroll-steps 12 --json
```

Price filter:

```bash
node bin/cli.js search-1688-web "<keyword>" --min-price 2 --max-price 30 --max-products 20 --json
```

Page sort by sales:

```bash
node bin/cli.js search-1688-web "<keyword>" --sort sales --max-products 20 --json
```

Page order quantity filter:

```bash
node bin/cli.js search-1688-web "<keyword>" --min-order-quantity 2 --max-products 20 --json
```

Page feature filters:

```bash
node bin/cli.js search-1688-web "<keyword>" --page-feature "<visible_filter_label_1>,<visible_filter_label_2>" --json
```

Sales filter:

```bash
node bin/cli.js search-1688-web "<keyword>" --min-sales30d 100 --max-products 20 --json
```

Include and exclude title words:

```bash
node bin/cli.js search-1688-web "<keyword>" --include "<required_word_1>,<required_word_2>" --exclude "<bad_word_1>,<bad_word_2>" --json
```

Use another CDP port:

```bash
node bin/cli.js search-1688-web "<keyword>" --port 9223 --json
```

## MCP Recipes

Web search:

```json
{
  "coreWord": "<keyword>",
  "blueOceanWord": "<keyword>",
  "modifiers": [],
  "semanticGroups": {},
  "mode": "web",
  "port": 9222,
  "maxProducts": 20,
  "maxPages": 1,
  "maxResolveLinks": 8,
  "scrollLoad": true,
  "scrollSteps": 8,
  "minPrice": 2,
  "maxPrice": 50,
  "minSales30d": 100,
  "pageSort": "sales",
  "minOrderQuantity": 2,
  "pageFeatureKeywords": ["<visible_filter_label>"]
}
```

Browser health:

```json
{
  "tool": "web_status",
  "port": 9222
}
```

Hybrid search:

```json
{
  "coreWord": "<core_word>",
  "blueOceanWord": "<blue_ocean_word>",
  "modifiers": [
    { "word": "<required_modifier>", "rigidity": "rigid" }
  ],
  "semanticGroups": {},
  "mode": "hybrid",
  "port": 9222,
  "maxProducts": 20,
  "maxResolveLinks": 8
}
```

API search only:

```json
{
  "coreWord": "<core_word>",
  "blueOceanWord": "<blue_ocean_word>",
  "modifiers": [],
  "semanticGroups": {},
  "mode": "api"
}
```

## Success Criteria

A search is successful only if all of these are true:

- `ok` is `true`.
- `products` is an array.
- At least one product has a non-empty `offerId`.
- At least one product URL starts with `https://detail.1688.com/offer/`.

Good product fields:

```json
{
  "offerId": "1044475287380",
  "title": "product title",
  "url": "https://detail.1688.com/offer/1044475287380.html",
  "price": 3.8,
  "priceBand": {
    "minPrice": 3.8,
    "maxPrice": 6.5,
    "prices": [3.8, 6.5],
    "display": "3.8-6.5"
  },
  "priceMin": 3.8,
  "priceMax": 6.5,
  "sales30days": 400,
  "shopName": "supplier name",
  "source": "1688-web"
}
```

The full result also returns aggregate price band data in `meta.priceBand`:

```json
{
  "minPrice": 2.8,
  "maxPrice": 18.8,
  "prices": [2.8, 3.8, 6.5, 18.8],
  "display": "2.8-18.8"
}
```

If page filters were applied, `meta.pageFiltersApplied` reports:

```json
{
  "applied": true,
  "actions": ["set:minPrice=2", "set:maxPrice=30", "click:confirm:price"],
  "missed": []
}
```

If `missed` is not empty, continue with returned products but mention which visible page filter labels were not found.

`meta.scrollLoad` reports whether lazy-loaded cards were pulled in:

```json
{
  "enabled": true,
  "steps": 4,
  "counts": [6, 14, 24, 38, 44],
  "finalCount": 44,
  "reason": "target-reached"
}
```

If `finalCount` is still small, retry with a broader keyword or higher `--scroll-steps`.

`meta.diagnostics` explains extraction health:

```json
{
  "selectorsVersion": "1688-search-card-v2",
  "extractedCards": 65,
  "normalizedProducts": 65,
  "dedupedProducts": 65,
  "resolvedProducts": 65,
  "finalProducts": 50,
  "validOfferIds": 50,
  "missingOfferIds": 0,
  "resolvedLinks": 12,
  "unresolvedLinks": 0,
  "skippedResolveLinks": 0,
  "droppedReasons": {
    "overLimit": 15
  },
  "warnings": ["productsDropped"]
}
```

If `warnings` contains `noValidOfferIds`, `loginDetected`, or `captchaDetected`, stop and ask the user to inspect the Chrome page.

## Failure Handling

Use this exact decision tree.

### CDP unavailable

Symptom:

- Error mentions `ECONNREFUSED`, `Chrome target`, `/json/list`, `/json/version`, or port `9222`.

Action:

```text
Stop. Ask the user to start Chrome with --remote-debugging-port=9222 and confirm that 1688 is logged in.
```

### Empty products

Symptom:

- `ok: true`
- `products.length === 0`

Action:

1. Retry once with broader settings:

```bash
node bin/cli.js search-1688-web "<keyword>" --max-products 30 --max-resolve-links 12 --json
```

2. If still empty, report:

```text
1688 web search returned no product cards for this keyword. Try a broader keyword or check the open Chrome page manually.
```

Do not invent products.

### Missing offerId

Symptom:

- Some products have `offerId: ""`.

Action:

- Keep products that have `offerId`.
- Drop products without `offerId` before passing to title generation or distribution.

### Login or captcha

Symptom:

- `meta.hasLoginText === true`
- `meta.hasCaptchaText === true`
- Page shows login, verification, or slider.

Action:

```text
Stop. Ask the user to handle login or verification manually in Chrome, then retry the same command.
```

Do not try to bypass slider or verification.

## Output Rules For Weak Agents

After a search, return a short summary:

```text
Found <N> products from 1688 web search.
Valid offerIds: <M>.
Top products:
1. <offerId> | <title> | <price> | <sales30days> | <url>
2. ...
```

When passing data to the distribution skill, use this format:

```text
https://detail.1688.com/offer/<offerId>.html$$<title>
```

If category is known:

```text
https://detail.1688.com/offer/<offerId>.html$$<title>$$<category>
```

## Do Not

- Do not manually click the 1688 web page.
- Do not type into the search box yourself.
- Do not build a UTF-8 search URL manually. 1688 web search requires GBK keyword encoding.
- Do not click page filters manually. Pass `--sort`, `--min-price`, `--max-price`, `--min-order-quantity`, or `--page-feature` to the tool.
- Do not use `dj.1688.com` URLs as final product URLs.
- Do not use `detail.m.1688.com` URLs as final product URLs.
- Do not submit products to distribution if `offerId` is missing.
- Do not attempt automated login, SMS login, QR login, or slider handling.

## Developer Notes

Important implementation details:

- Web search code lives in `skills/alibaba1688/src/search-web-1688.js`.
- `buildSearchUrl()` GBK-encodes keywords with `iconv-lite`.
- `normalizeOfferUrl()` canonicalizes mobile detail URLs with `offerId` query parameters.
- `searchAll()` supports `options.mode = "api" | "web" | "hybrid"`.
- Default mode is still `api`, so existing title generation is not changed unless a caller opts in.
