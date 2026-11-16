# Daily Check-in design system

The source of truth is [`web/design/tokens.css`](web/design/tokens.css). [`web/design/preview.html`](web/design/preview.html) shows every component with sample data across the four screens (Today, Log, Workouts, Analytics). Open it with:

```bash
open web/design/preview.html
```

The preview links `tokens.css` and loads one Google Font. Everything else is inline, and the only script is the one that switches tabs.

## Principles

1. **One number per card leads.** Each card has a single big number (`.stat__value`). Labels are small uppercase eyebrows above it, and units are smaller and muted beside it. Supporting detail sits under it in `.stat__foot` or `.card__sub`.
2. **Orange means "you" and "act".** The accent marks primary actions, today's progress and highlights. It never means good or bad by itself.
3. **Status has its own colours.** Green (`--color-under`) means under allowance or improving. The orange/red family (`--color-over`) means over allowance or getting worse. Pick the colour by meaning, not by direction: resting HR going ↓ is good, so it is green.
4. **Light and airy.** Use an off-white background, white cards with large radii, soft shadows, and generous spacing. No borders on cards. Hairlines only separate list rows.
5. **Phone first.** Use a single 430px column with 16px gutters. On a laptop the column stays centred; don't stretch the layout.
6. **Accessible by default.** Text meets WCAG AA (4.5:1, or 3:1 for large text and graphics). Every touch target is at least 44px. Respect `prefers-reduced-motion` and `prefers-color-scheme`.
7. **Tokens only.** Screens never use raw hex, px font sizes or ad-hoc shadows. If something is missing, add a token here first.

## Tokens

### Colour

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-bg` | `#F4F4F1` | `#111114` | App background |
| `--color-surface` | `#FFFFFF` | `#1C1C21` | Cards, tiles, tab bar |
| `--color-surface-2` | `#F0F0EC` | `#26262C` | Input fill, ring/meter tracks, secondary buttons, future-day bars |
| `--color-surface-3` | `#E6E6E1` | `#303037` | Pressed/hover of surface-2, skeleton highlight |
| `--color-border` | `#E3E3DE` | `#2C2C33` | List-row dividers, chip outlines |
| `--color-border-strong` | `#C9C9C2` | `#45454E` | Reserved for inputs that need a visible outline |
| `--color-text` | `#17171C` | `#F4F4F5` | Body text, big numbers, dark tiles |
| `--color-text-muted` | `#62626C` | `#A1A1AA` | Labels, meta, units, axis ticks (≥5.2:1) |
| `--color-text-subtle` | `#8A8A94` | `#75757F` | Decoration only. Never use it for text people need to read |
| `--color-text-on-accent` | `#FFFFFF` | `#FFFFFF` | Text on accent-strong surfaces |
| `--color-accent` | `#F2561D` | `#FF6B35` | **Graphics only**: ring fill, today highlights, FAB, meters, focus ring, line charts |
| `--color-accent-strong` | `#C73E0A` | `#C73E0A` | **Backgrounds with white text**: primary buttons, accent tiles (5.1:1) |
| `--color-accent-pressed` | `#B3370A` | `#B3370A` | Hover/pressed state of accent-strong |
| `--color-accent-soft` | `#FDEBE3` | `#3A2017` | Tinted chips, tip callout, avatar, icon chips |
| `--color-accent-ink` | `#A8340A` | `#FFA27D` | **Accent-coloured text**: active tab, ghost buttons, "earned" figures, text on accent-soft |
| `--color-under` | `#2E9E66` | `#3CB371` | Under-allowance bars, rings and meters |
| `--color-under-ink` | `#1F7A4D` | `#6FD49A` | Good-status text, `.delta--good` |
| `--color-under-soft` | `#E3F3EA` | `#17301F` | Good-status chip and delta backgrounds |
| `--color-over` | `#E5482E` | `#FF5A3D` | Over-allowance bars, surplus weeks |
| `--color-over-ink` | `#B8321C` | `#FF8C75` | Bad-status text, `.delta--bad` |
| `--color-over-soft` | `#FCE8E3` | `#3A1A15` | Bad-status chip and delta backgrounds, danger button |
| `--color-info` | `#3A6FD8` | `#6E9BFF` | Sleep, HRV and fat series |
| `--color-info-soft` | `#E6EEFB` | `#1B2540` | Info icon chips, info tip |
| `--color-chart-grid` | `#E6E6E1` | `#2C2C33` | Chart gridlines |
| `--color-chart-neutral` | `#CFCFC8` | `#3A3A42` | Allowance line, raw data points, below-target bars |
| `--color-meal-breakfast` | `#B07D12` | `#E8B860` | Breakfast dot on the Log section heading, and the wash on its block |
| `--color-meal-breakfast-soft` | `#F7E3BE` | `#4A3A14` | Breakfast chip behind the meal emoji |
| `--color-meal-lunch` | `#0F7D72` | `#5FD0C4` | Lunch dot, and the wash on its block |
| `--color-meal-lunch-soft` | `#C9E8E3` | `#113E38` | Lunch chip |
| `--color-meal-dinner` | `#5B53B5` | `#A9A6F2` | Dinner dot, and the wash on its block |
| `--color-meal-dinner-soft` | `#DCDAF4` | `#2C2B5C` | Dinner chip |
| `--color-meal-snack` | `#5F6B78` | `#A8B2BD` | Snack and drink dot, and the wash on its block |
| `--color-meal-snack-soft` | `#DFE4EA` | `#313840` | Snack and drink chip |

**Meal colours are a category, never a verdict.** Breakfast, lunch, dinner and snacks are told apart
by hue; whether a day went well is told by the status colours above. The two must not be confused,
so the meal hues sit in the gaps the status family leaves (gold, teal and violet against accent 20°,
over 10°, under 150° and info 220°). Each hue is worn at three strengths and nowhere else: an
11% wash over the surface for the whole section block, the `-soft` tint for the 44px chip behind the
emoji, and the solid colour for the 10px dot on the heading — never as a bar, ring, meter or fill,
and never at full strength behind text. The emoji and the section name say the same thing, so the
colour is a shortcut, not the only way to know which meal you are looking at.

**Illustrations:** people are AI-generated flat illustrations in navy with teal and coral accents, stored as trimmed transparent WebP in `web/img/` (`man`, `woman`, and round `avatar-man` / `avatar-woman`). Keep new artwork in this set's style and palette.

**Themes:** light is the default. Dark follows `prefers-color-scheme` automatically. To force a theme (for example from a settings toggle), set `data-theme="light"` or `data-theme="dark"` on `<html>`. Removing the attribute goes back to following the system. The preview's Light / Dark / System switch does exactly this.

**The accent contrast rule:** white on `#F2561D` is only 3.4:1. Any orange surface that carries text uses `--color-accent-strong`. Orange text uses `--color-accent-ink`. The bright `--color-accent` is for shapes only.

### Typography

Font: `--font-sans` is **Outfit** (weights 400–800), chosen for its bold, friendly numbers. It falls back to the iPhone system font (SF Pro). Load it in the app with one stylesheet link: `https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap`, or self-host the font files under `web/` to avoid the external request. If it fails to load, the system fallback is fine. `--font-numeric` aliases it. Put `.num` (or `font-variant-numeric: tabular-nums`) on any figure that changes. Outfit may ignore that setting, so give live-updating numbers a fixed width or right-align them so they don't shift as digits change.

| Token | Size | Use |
|---|---|---|
| `--text-xs` | 12px | Eyebrow labels, axis ticks, week-day letters |
| `--text-sm` | 14px | Meta, units, hints, chips, deltas |
| `--text-md` | 16px | Body, buttons, **all inputs** (smaller triggers iOS zoom) |
| `--text-lg` | 18px | Card and section titles, large buttons |
| `--text-xl` | 22px | Screen title in the header |
| `--text-2xl` | 28px | `.stat__value` |
| `--text-3xl` | 36px | Number inside the main ring |
| `--text-4xl` | 48px | `.stat__value--hero`, at most one per screen section |

Weights are `--weight-regular` 400, `-medium` 500, `-semibold` 600, `-bold` 700 and `-black` 800 (big numbers and screen titles). Line heights are `--leading-tight` 1.1 (numbers, titles), `-snug` 1.3 and `-normal` 1.5 (body). Tracking is `--tracking-label` 0.08em on uppercase eyebrows and `--tracking-number` −0.02em on big numbers.

### Spacing

4px base: `--space-1` 4, `-2` 8, `-3` 12, `-4` 16, `-5` 20, `-6` 24, `-8` 32, `-10` 40 and `-12` 48. `--gutter` is 16px (page side padding).

- Card padding: `--space-5`. Tile padding: `--space-4`.
- Gap between cards and tiles: `--space-3`.
- Section title: `--space-6` above, `--space-3` below.

### Radii

`--radius-sm` 10px (bars, small icon chips), `--radius-md` 14px (buttons, inputs, list thumbnails), `--radius-lg` 20px (stat tiles, tips, large buttons), `--radius-xl` 26px (cards), `--radius-pill` (chips, deltas, tab bar, segmented control, avatar).

### Elevation

`--shadow-sm` for the selected segment, `--shadow-md` for cards and tiles (the default), `--shadow-lg` for the floating tab bar, and `--shadow-accent` as a warm glow under the primary button, FAB and accent tiles. `--focus-ring` is a 2px accent ring with a surface-coloured gap. It applies automatically on `:focus-visible`.

### Motion

`--duration-fast` 120ms (press scale), `--duration-base` 200ms (hover, tab and segment changes), `--duration-slow` 600ms (ring, meter and bar fills). Easing is `--ease-out` for anything entering or growing and `--ease-in-out` for loops. Durations become 0 under `prefers-reduced-motion`. Don't animate layout or add idle motion.

### Sizing

`--touch-target` 44px, `--app-max-width` 430px, `--tabbar-height` 64px.

## Components

All class names are in `tokens.css`. The preview has a working example of each.

### App shell: `.app`, `.app-header`, `.avatar`, `.section-title`, `.stack`
- `.app` is the centred 430px column. Its bottom padding clears the floating tab bar and the iPhone home indicator.
- `.app-header` holds `.app-header__date` (muted, small) and `.app-header__title`. On Today the title is a greeting ("Good morning, Sam"). Other screens use the screen name. `.avatar` (44px) on the right switches person.
- `.section-title` is an `h2` between cards. An optional `.btn--ghost` or `.hint` sits on the right.

### Tab bar: `.tabbar > .tabbar__inner > .tabbar__item | .tabbar__fab`
- Five slots: Today, Log, **FAB**, Workouts, Analytics. The FAB is the camera (Snap a Meal) and is the only orange-filled control in the bar.
- Mark the current tab with `aria-selected="true"` (tab pattern) or `aria-current="page"` (links). Items are 44px tall, with an icon and a label. Don't use icon-only tabs.

### Card: `.card`, `.card--flat`, `.card--accent`, `.card--dark`, `.card__head`, `.card__title`, `.card__sub`
- `.card` is the default white container. `.card__head` is a flex row with the title or number on the left and a chip or delta on the right.
- `.card--flat` drops the shadow (empty states, secondary content).
- `.card--accent` and `.card--dark` are for at most **one** emphasis card per screen.

### Stat tile: `.tile-grid`, `.stat`, `.stat__head`, `.stat__icon(--accent|--info|--under|--on-accent)`, `.stat__value(--hero)`, `.stat__unit`, `.stat__foot`, `.stat--accent`, `.stat--dark`
- `.tile-grid` is two columns. Use `.span-2` for a wide tile and `.tall` for a two-row tile, and mix sizes so the grid doesn't look like a spreadsheet.
- Order inside a tile: `.stat__head` (eyebrow + 32px icon chip), then `.stat__value` with an inline `.stat__unit`, then a `.delta` or `.stat__foot`.
- One `.stat--accent` tile per grid at most (Today uses it for steps).

### Delta: `.delta`, `.delta--good`, `.delta--bad`
- A pill with an arrow and the change, for example `↑ 5 vs 7-day`. Always write the arrow (↑ ↓ →) so meaning doesn't rely on colour.
- Choose `--good` or `--bad` by meaning. A plain `.delta` is neutral (no change, or no judgement).

### Progress ring: `.ring-wrap`, `.ring`, `.ring__track`, `.ring__fill`, `.ring__label`, `.ring--thin|--over|--under|--info`
```html
<div class="ring-wrap" style="inline-size:148px">
  <svg class="ring" viewBox="0 0 120 120" style="--p: 69" aria-hidden="true">
    <circle class="ring__track" cx="60" cy="60" r="52"/>
    <circle class="ring__fill"  cx="60" cy="60" r="52" pathLength="100"/>
  </svg>
  <div class="ring__label">…</div>
</div>
```
- `--p` is 0–100 and is capped at 100. When eaten exceeds the allowance, add `.ring--over` and show "N kcal over" in the label.
- The main calorie ring shows **kcal left** in the centre. Eaten and allowance sit beside it, with "2,300 base + 350 earned from workouts" under the allowance.

### Meter: `.meter > span`, `.meter--under|--over|--info|--neutral`
A linear bar for macros and goals, with `style="--p: 64"`. The macro colours are fixed: protein uses accent, carbs `--neutral` (text colour) and fat `--info`.

### Week bar chart: `.week`, `.week__plot`, `.wbar`, `.wbar--over|--today|--future`, `.week__line`, `.week__day`, `.legend`
```html
<div class="week" style="--line: 85" role="img" aria-label="…each day in words…">
  <div class="week__plot">
    <div class="wbar" style="--h: 73"></div>                      <!-- under -->
    <div class="wbar wbar--over" style="--h: 90"></div>
    <div class="wbar wbar--today" style="--h: 61"></div>          <!-- in progress -->
    <div class="wbar wbar--future"></div>                         <!-- Fri–Sun -->
    …
    <div class="week__line" data-label="avg allowance 2,555"></div>
  </div>
  <div class="week__day">M</div> … <div class="week__day" aria-current="date">T</div> …
</div>
```
- `--h` and `--line` share one scale: `value / max × 100`, where `max` is about 1.15 × the highest allowance.
- Under bars are green and over bars are red. Today keeps its status colour and adds stripes ("so far"). Future days are empty slots up to the allowance line.
- Always include a `.legend` and a `role="img"` label that reads out each day.

### Line chart and sparkline: `.chart`, `.chart--spark`, `.chart__line(--muted|--info|--text|--target)`, `.chart__area(--info)`, `.chart__dot`, `.chart__grid`, `.chart__tick`, `.chart__bar--under|--over|--info|--muted|--ghost`, `.chart-axis`

`--ghost` is an outlined bar, for a quantity that was never recorded rather than one that fell short — a solid `--muted` block already reads as "below target" on the sleep chart. Legend keys match their mark: `.legend__key--line` for a dashed reference, `.legend__key--ghost` for an outlined one.
- Use inline SVG with a fixed `viewBox` (330 wide for cards, 120×40 for sparklines). Give sparklines `preserveAspectRatio="none"`.
- **Intake vs allowance (30 days):** thin rounded bars (`under` or `over` per day) with a dashed step line for the daily allowance.
- **Weight:** raw weigh-ins as small neutral dots, the **7-day average** as the accent line with a soft area fill, and a `.chart__dot` on the latest point. The headline number is the trend, not the noisy daily value.
- **Weekly balance:** diverging bars around a zero line. A deficit goes down in green and a surplus goes up in red. The current partial week is shown at reduced opacity.
- **Sleep:** bars in `--info` at or above target and `--muted` below, with a dashed target line.
- Put tick labels in `.chart-axis` under the SVG (first, middle, last), not inside the SVG, so they stay at 12px.
- Every chart gets `role="img"` and an `aria-label` stating the takeaway.

### Chips and segmented control: `.chips`, `.chip`, `.chip--accent|--under|--over`, `[aria-pressed="true"]`, `.segmented`
- Chips are 36px tall, with a hit area extended to 44px. Use them for status ("On track") or filters. A selected filter chip turns dark.
- `.segmented` is a pill group of `button[aria-pressed]` for 2–4 mutually exclusive ranges (7 / 30 / 90 days).

### Buttons: `.btn` + `.btn--primary|--secondary|--ghost|--danger`, `.btn--block`, `.btn--lg`, `.btn--icon`
- **One primary button per card.** Snap a Meal is `.btn--primary.btn--lg.btn--block`.
- Secondary is for alternatives (Upload photo, Discard), ghost for inline links (Details), and danger for delete.
- Icon buttons (`.btn--icon`, 44px round) need an `aria-label`.

### Inputs: `.field`, `.label`, `.hint`, `.input`, `.textarea`, `.select`, `.input-row`
- Inputs are filled (surface-2) with no border at rest. On focus they get an accent-strong border and a white fill. Set `aria-invalid="true"` for an over-coloured border.
- Use 16px text always, `inputmode="decimal"` for numbers, and `.input-row` for the three macro fields.

### List rows: `.list`, `.list-row`, `.list-row__lead`, `.list-row__body`, `.list-row__title`, `.list-row__meta`, `.list-row__trail`
- Rows are at least 60px. The lead is a 44px thumbnail (meal photo, emoji or icon). The title truncates to one line, the meta is muted, and the trail holds a bold number with a `.hint` unit.
- Earned workout calories in the trail use `--color-accent-ink` with a "+" sign.

### Tip callout: `.tip`, `.tip--info`, `.tip__icon`
One per screen at most, at the end. Give it a bold one-line headline and one sentence of specific, actionable advice. Use `.tip--info` for recovery and sleep insights.

### Empty and loading: `.empty`, `.empty__art`, `.empty__title`, `.empty__text`, `.skeleton`, `.spinner`
- Empty states say what's missing, why it matters in one line, and offer one action button.
- Use `.skeleton` blocks that match the shape of the content being loaded (for example a list row while a photo is being estimated), with `aria-busy="true"` on the container. Use `.spinner` inline in buttons or rows.

### Utilities
`.eyebrow` (uppercase label), `.num` (tabular figures), `.muted`, `.visually-hidden`.

## Writing

- Use sentence case everywhere. Labels are in uppercase only through `.eyebrow`.
- Format numbers with thousands separators (`2,650`). Units are lowercase and spaced in text (`1,840 kcal`) but attached in `.stat__unit`.
- Use a real minus sign for negative balances (`−1,240`), not a hyphen.
- Be friendly and specific: "Room for a solid dinner", not "Calorie budget status".

## Applying this to the app

1. Link `design/tokens.css` from `web/index.html` and remove the old inline theme.
2. Rebuild each screen from these components. The preview HTML is the reference markup.
3. Generate chart SVGs from real data in the view modules, following the chart rules above. The preview's charts are static samples.
