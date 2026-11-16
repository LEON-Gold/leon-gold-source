# Leon Gold on Instagram («اینستاگرام» tab)

Content for the owner's Instagram (@___leongold___). The owner posts from the iPhone; nothing here ever posts by itself.
Read `../CLAUDE.md` first (owner, Persian replies, shared look).

## What is here

- `web/plan.js`: the plan, one entry per day: slides, caption, hashtags (5 at most), stories, reel shots. The single source.
- `web/slide.html?d=d01&s=0`: draws one slide (1080×1350 post, 1080×1920 story/reel cover) in the Assay Ledger look.
- `web/out/`: the rendered JPGs, `<day>-<n>.jpg`. Rebuild with `scripts/render.ps1` (PowerShell tool: `& "...\scripts\render.ps1" [-Only d05]`).
- `web/index.html`: the owner's phone page: each day's images (save/share), caption to copy, stories, reel shots; today is outlined.
- `web/price/`: the daily price story, drawn live on the phone from the union feed (`price.json`, the site's feed). No price is typed by hand.
- `web/reels/<name>.html` + `reel.js`: animated reels (1080×1920), everything a function of time (`seek(t)`); `node scripts/reel.mjs ayar safar` renders them to `web/out/reel-<name>.mp4` (Chrome + ffmpeg, no sound). Shown on `index.html` under «ریلزهای آماده» with save and caption buttons. `ayar` = «عیار ۷۵۰ یعنی چه؟» (dark-gold explainer), `safar` = «قبل از خرید این سه تا رو بپرس» (torn-paper collage). Note: Vazirmatn `-4.woff2` is the Arabic subset and `-5.woff2` the Latin one (slide.html has them the other way round).
- `research.md`: what works for Tehran gold pages and why the plan looks the way it does.

## Publish

Copy `web/` to `../leon-gold-app/social/` and push that repo (only the `social/` path). Live at
https://leon-gold.github.io/leon-gold-app/social/ (price story: `social/price/`). Screenshot at 390 wide before pushing.

## Rules

- Words come from `../leon-gold-site/lib/products.ts` and `lib/museum.ts`. Never invent prices, weights, karat, or claims like «اصل», «پرفروش», «تضمینی».
- Price and weight only «در دایرکت بپرسید». Museum pieces are history, never Leon Gold's work; say so on the slide and in the caption. Only CC0 / public-domain images.
- Phone number in captions without spaces (`۰۹۱۲۹۳۷۴۵۵۲`): spaced Persian digit groups reverse in RTL. On slides wrap it in `<bdi dir="ltr">`.
- Persian digits everywhere; the Amiri «٫» looks like «و», so slide.html sets it in Vazirmatn.
- No customer data in this repo. Don't edit the site's code (other tabs).
