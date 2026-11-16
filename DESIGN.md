# DESIGN.md: Leon Gold, "Assay Ledger"

The single design system for every Leon Gold part: the site, «حساب من», the CRM panel, the ledger «دفتر لئون», and the social visuals. Read this before building or restyling any screen. The code is the source of truth for exact values. If this file and the code disagree, fix one of them in the same change.

- Tokens: `leon-gold-site/app/globals.css` (`:root`) and `leon-gold/index.html` (top `:root`).
- Guilloché: `leon-gold-site/lib/guilloche.ts` and `public/gl/*.svg`. The ledger draws its own at runtime.

## 1. Visual theme and atmosphere

A Tehran gold house's ledger, not a fashion boutique. The page should feel like a gold certificate or a banknote:
- an emerald **vault** (dark green ground)
- **ivory paper** cards with a pressed gold hairline and engraved corner ornaments
- **guilloché** engraving (rosettes, bands)
- Naskh calligraphic titles
- **gold leaf** on only the few things that matter

The tone is quiet, exact and trustworthy, because money and grams are shown here.

- **Quiet luxury:** decoration comes from the shared vocabulary above. Never add a new ornament style, glow, glassmorphism, neon or a gradient blob.
- **Numbers are sacred:** balances, grams and rials must be legible first and beautiful second.
- **Phone first:** the owner and most customers use an iPhone (Safari), so 390px is the main canvas.

## 2. Colour palette and roles

Two palettes (owner, 2026-11-10). **Dark mode «زمرد شاهی» (Emerald Vault):** `#06110C` ground, `#0B1C14` surface, `#12301F` raised, `#9FB3A6` sage text, `#EBDAB0` champagne, `#C9A24B` gold. **Light mode «عاج و زمرد» (Ivory & Emerald):** `#FAF7F0` ivory ground, `#EFE7D6` parchment, `#8C7A5A` taupe, `#0C3C2D` emerald (bars, headings), `#1B1A17` ink, `#A8823F` dark gold. Chosen because the showcase photos sit on dark emerald velvet (about `#071810`): in dark mode they merge into the page. Every green sits on the emerald ramp and every gold or ivory on the gold-champagne ramp, each at its own lightness; reds (dr) and greys keep theirs. In light mode the dark grounds turn ivory through generated overrides at the end of each site style sheet (`html[data-theme="light"] …`, made by the scratch tool ivory.cjs from the rules above them); the top bar, tab bar, VIP card, photo frames and seals stay emerald on purpose. Gold leaf clipped to text uses a deeper leaf on ivory.

| Token | Value | Role |
|---|---|---|
| `--vault` | `#07130e` | Darkest ground, the bottom of the vault gradients |
| `--emerald` | `#133423` | Primary dark green: bars, ink buttons, headings on paper |
| ledger `--green` / `--green-2` / `--green-d` | `#192119` / `#212e21` / `#0b100d` | Ledger bars and vault gradients (`#212e21 → #0b0f0d`) |
| `--bg` | `#f1e7d2` | Page ground behind paper (light pages) |
| `--paper` | `#fefcf7` (site), `#f5efe3` (ledger) | Cards and sheets |
| `--cream` | `#f1e7d2` | Text on dark ground |
| `--ink` | `#0f271a` | Body text on paper |
| `--muted` | `#5f6a5e` | Secondary text on paper |
| `--line` | `#e2cc97` | Hairlines and dividers on paper |
| `--gold` | `#c9a24c` | Ornaments, hairlines on dark, badges |
| `--gold-d` | `#977538` | Gold pressed or darker |
| `--gold-lt` | `#e2cb94` | Gold text and icons on dark ground |
| `--gold-ink` | `#7d602d` | Gold text on paper (contrast-safe) |
| `--leaf` | `linear-gradient(100deg, #ac8641, #eddfbd 34%, #d5b56d 52%, #f3ebdb 66%, #ac8641)` | Gold leaf: clipped to text (`.leaf`) or the primary button |

Balance colours carry meaning and are used for nothing else:
- **dr** (the party owes Leon): `--dr: #8b2e22`, a warm red-brown.
- **cr** (Leon owes the party): `--cr: #2b3c2b` on paper, `#adc2ad` on dark, a moss green.
- **z** (settled): muted.

Contrast rules:
- On dark ground: text is `--cream` or `#cfc4a3` and never darker; links are `--gold-lt`.
- On paper: text is `--ink` or `--muted`; links and gold words are `--gold-ink`.
- Never put `--ink`-coloured headings directly on the vault.

## 3. Typography

| Face | Token | Use |
|---|---|---|
| **LG Naskh** (Amiri Bold, limited to Arabic letters) | `--display` | Titles, section heads, wordmark, names on cards |
| **Vazirmatn** | `--text` | Everything else: body, labels, buttons, all numbers |
| **Cinzel** | `--latin` | Rare Latin small caps such as `LEON GOLD · MEMBER` |

- **Digits are always Persian** (۰–۹) in UI text. Convert them with `faDigits`.
- Never set numbers in Amiri, El Messiri or Noto Naskh: their digits are Arabic-style. LG Naskh's `unicode-range` already sends digits to Vazirmatn.
- Number alignment: put amounts in `.num` with tabular figures. Wrap mixed-direction values (usernames, IBANs, phone numbers) in `dir="ltr"` or `<bdi>`.
- Scale on the phone:
  - Body: 15–16px with line-height 1.8–1.95.
  - Small print: 13–14px.
  - Section heads (`.hs-h`): 20–24px Naskh.
  - Hero titles: `clamp()`.
- Use `text-wrap: pretty` on paragraphs. Never letter-space Persian.
- Separators in meta lines are `·`. Use Persian punctuation (، ؛ «») and the ZWNJ in words like «می‌شود».

## 4. Components

- **Paper card (`.paper`):**
  - Ivory gradient (`#fffefa → #fbf6ea`), radius 18px.
  - Shadow `--lift`, plus an inner 4px ivory frame and a 5px gold hairline (`rgba(197,154,80,.22)`).
  - Important cards get the four engraved corners (`.corner c1..c4`, `--corner` SVG).
- **Buttons (`.btn`):**
  - Pill shape (radius 999px), min-height 52px (44px for small ones), Vazirmatn 600.
  - `.btn-gold`: gold leaf fill, `#0a1f15` text. One per screen, for the main action.
  - `.btn-ink`: emerald fill, `--gold-lt` text. Secondary.
  - `.btn-line`: transparent with a gold hairline, for dark ground.
  - Hover lifts by 2px. `:active` scales to .97.
- **Links (`.hs-link`):** text buttons underlined in faint gold (`text-underline-offset: 4px`).
- **Bars:** sticky top bar (60px) and fixed bottom tab bar. Both use the guilloché `--gl-band` over the green vault gradient, with a gold hairline edge. Respect `env(safe-area-inset-*)`.
- **Drawer menu (`.hs-menu`):**
  - Slides in from the inline-start side, which is the right in RTL. Width `min(86vw, 360px)`, vault gradient.
  - Groups are headed by small gold labels. Rows are 48px tall, with a 22px line icon (stroke 1.6, gold-lt).
  - The current item gets a faint gold fill and hairline.
- **Fields (`.hs-field`):**
  - Label above, input 16px or larger (iOS must not zoom), ivory input on paper.
  - Use `dir="ltr"` for usernames, passwords and numbers. Show errors in `.hs-err` with `role="alert"`.
- **Chips and segments:** pills with a gold hairline; the selected one is filled faintly gold.
- **Icons:** one line-icon set, 24px viewBox, `stroke="currentColor"`, stroke 1.6, round caps and joins. No emoji as icons, and no icon fonts.
- **Membership card (`.hs-card`):** vault plate, 1.6 aspect ratio, guilloché rose, the name in gold leaf.
- **Invoice sheets and PDFs:** plain printable paper. The decorative layer never touches them (`.sheet`, `.export` in the ledger).

## 5. Layout

- RTL throughout (`dir="rtl"`). Use logical properties (`inset-inline-start`, `padding-inline`, `margin-inline-start`) and never left/right.
- Page gutter: 16px on phones, `--m: clamp(16px, 4vw, 56px)` on the site. No horizontal page scroll at any width.
- Vertical rhythm: 16px between cards in a list and 24–32px between sections.
- Test at 375, 390, 430 and 1440 widths.
- The site gives every `section` a large page padding. A `section` used as a component (sheets, menu groups) must reset it.
- Content max width on wide screens is about 720px for «حساب من» and panels. The site uses its own grid.

## 6. Depth and elevation

- Paper floats on the ground with `--lift` and is never heavier.
- Bars carry a 1px gold hairline and a soft dark falloff.
- Overlays (sheets, drawer) use a dim scrim (`rgba(4,14,10,.55)`) with a light blur, and lock the page scroll (`html.hs-locked`).
- No hard black shadows and no coloured glows except the gold button's warm shadow.

## 7. Motion

Added 2026-11-10: **page to page**, the tapped card or button grows as gold-tinted glass into the page that opens (`lib/morph.js`, clip-path, 480 ms strong ease-in-out; the ledger copies it in with `offline/me-ledger.cjs`); between the site's own pages the browser view transition keeps the bar (`lg-bar`) and turns the tapped card into the title (`lg-title`). **Loading** is the gold leaf drawing itself in a turning guilloché ring (`lib/loader.js`, `components/Loader.tsx`, the ledger's splash), never a page name. **Market** charts draw in once, the live dot breathes, a moved price rolls in and its tile glows green or red (`lib/marketEngine.js` + `.css`, shared by the ledger and «حساب من»). All of it stops under reduce motion.

- Ease is `--ease: cubic-bezier(.22, 1, .36, 1)`, the easing used everywhere.
- Durations: 150–250ms for UI and up to 300ms for drawers and sheets. The hero and scroll stories may run longer.
- Animate only `transform` and `opacity`.
- Gold-leaf sweep (`.leaf-sweep`): once, on a title, never looping.
- Respect `prefers-reduced-motion`: drawers and sheets appear without sliding, and the hero holds still.
- An animation must play **once** per visit to a section. Never re-trigger it on re-render (the hero was rebuilt for this; see HANDOFF).

## 8. Do and don't

**Do**
- Use the shared vocabulary (paper, hairline, corners, guilloché, Naskh, leaf) and reuse existing classes before writing new ones.
- Keep one gold-leaf hero per screen: a title, a name or the main button.
- Write copy in the owner's plain Persian. Every number should say what it means («بدهی شما به لئون», «طلب شما از لئون»).
- Keep grams and rials apart. Never convert a balance at today's price.
- Make tap targets 44px or larger. Give icon buttons an `aria-label`, and give dialogs `role="dialog"`, `aria-modal`, Escape to close and focus return.

**Don't**
- Use brand names of other shops or designers, or business claims the owner did not give.
- Use new fonts, new colour accents (no purple or blue), stock gradients, emoji icons or a Latin-first layout.
- Use Arabic-form digits, or Amiri for numbers.
- Put dark text on the vault, or low-contrast grey text on dark ground.
- Add decoration to invoice sheets or PDFs.

## 9. Prompt guide for agents

> Build this in Leon Gold's Assay Ledger style (DESIGN.md): RTL Persian, phone first at 390px. Use the vault green ground or the `--bg` ground with ivory `.paper` cards (gold hairline, corners on key cards). Use LG Naskh for titles and Vazirmatn for text and all numbers, with Persian digits. Put gold leaf on one thing only, use `.btn-gold` for the main action and `.btn-ink` for secondary ones, and use line icons with stroke 1.6. Use logical properties, 44px or larger targets, reduced-motion support and `--ease`. Reuse the classes in `app/hesab/hesab.css` and `app/site.css` before adding new ones.

## 10. Leon Kids («لئون کیدز», owner 2026-11-14)

The showcase's «بچگانه» group is a sub-brand with its own look, by the owner's word; it is the only place that leaves the emerald-and-gold vocabulary. Everything inside `.kids` takes it (`leon-gold-site/components/hesab/kids.css`): on the site it is its own page (`kids/`, `components/KidsDoor.tsx`), in «حساب من» the same look is put on in place.

- Ground blush paper `#fbf3ec`, cards `#fffdfb`, text cocoa `#4a2f2a`, rose gold `#99523f` (text) / `#c98b78` (ornament), hairlines `#f0d6cb`.
- Pastels for medallions and soft watercolour clouds: pink `#fbdde3`, sky `#d9eef5`, mint `#dbf1e4`, lilac `#e7e0f5`, butter `#fbeecb`. A few small rose-gold stars, still.
- The logo is the owner's (`public/kidsart/logo.webp`, `mark.webp`: the rose-gold foil cut out of his paper mock-up). Fonts stay LG Naskh and Vazirmatn; digits Persian.
- The same in the light and the dark theme. No corners, no guilloché, no gold leaf here. Product photos stay as they are.
- Never use other makers' characters or names in the page's own art or copy.
