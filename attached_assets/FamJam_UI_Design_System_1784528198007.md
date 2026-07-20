# FamJam — UI Design System & Specification

**Version:** 1.0
**Purpose:** Apply this visual design system to an existing app. This document defines the complete look and feel: color, typography, spacing, components, and screen layouts. It is framework-agnostic — values are given as CSS custom properties plus plain-language rules so they can be applied in React, plain HTML/CSS, Tailwind, or any component library.

**Design concept:** A warm, mobile-first family-reunion app. The personality is "picnic in the park meets a well-run event": a confident **blue gradient** as the anchor, warm cream "paper" surfaces, and celebratory marigold and berry accents. The single signature element is a **paper bunting banner** (triangular flags) used once at the top of the home screen.

---

## 0. How to use this in Replit

1. Upload this file to your Replit project (or paste it into the Agent/Assistant chat).
2. Suggested prompt to the Replit Agent:

   > "Apply the design system in `FamJam_UI_Design_System.md` to my existing app. Start by adding the color and typography tokens as CSS variables in my global stylesheet, load the two Google Fonts, then restyle my shared components (buttons, cards, inputs, badges, bottom navigation) to match the component specs. Keep my existing app logic and routes unchanged — this is a visual restyle only."

3. Apply in this order for the cleanest result: **tokens → fonts → base/global styles → shared components → per-screen layout.**
4. Do **not** change application logic, data, or routing. This is a visual layer only.

---

## 1. Design tokens

Add these as CSS custom properties on `:root`. Names are semantic so they read clearly in any codebase.

```css
:root {
  /* Brand (blue) */
  --brand:          #1F5D8C;  /* primary blue — text accents, active states, checkboxes */
  --brand-deep:     #123F62;  /* deep blue — shadows, deep surfaces, gradient end */
  --brand-bright:   #2E7DB0;  /* bright blue — gradient start */
  --brand-gradient: linear-gradient(135deg, #2E7DB0 0%, #164A70 100%);

  /* Accents */
  --accent:         #E8A020;  /* marigold — primary buttons, highlights, bunting */
  --accent-soft:    #F6CF7D;  /* soft marigold — on-dark highlight text, bunting */
  --accent-shadow:  #C9860F;  /* marigold button drop line */
  --berry:          #C24D6A;  /* raspberry — secondary accent, "money out", live dot */
  --berry-soft:     #E9B7C2;  /* soft berry — badge background */
  --berry-shadow:   #9E3A54;  /* berry button drop line */

  /* Neutrals & surfaces */
  --bg:      #FBF5E9;  /* app background — warm cream "paper" */
  --surface: #FFFDF6;  /* card / elevated surface */
  --ink:     #1E2A33;  /* primary text — cool near-black */
  --ink-soft:#617079;  /* secondary text, captions */
  --sky:     #DDE8EF;  /* pale blue tint — chips, quiet fills, checkbox rings */
  --line:    #EADFC9;  /* hairline borders on cream surfaces */

  /* Radii */
  --r-pill:  999px;
  --r-input: 12px;
  --r-btn:   14px;
  --r-tile:  16px;
  --r-card:  18px;
  --r-frame: 30px;

  /* Elevation */
  --shadow-card: 0 1px 2px rgba(31,77,63,.05);
  --shadow-pop:  0 8px 24px rgba(0,0,0,.25);
}
```

### Color usage rules

| Token | Use for | Do not use for |
|---|---|---|
| `--brand-gradient` | Hero surfaces: top header, bottom nav, stat tiles, the balance/"available" cards, primary "pine" buttons | Large body-text backgrounds |
| `--brand` | Icons, active nav text, selected borders, checkboxes, progress on charts | Long paragraphs of text |
| `--accent` | The **primary** call-to-action button, pins, key highlights | More than one primary action per screen |
| `--berry` | Secondary emphasis, "money out" amounts, the LIVE indicator | Primary actions |
| `--bg` / `--surface` | Page background / cards | — |
| `--ink` / `--ink-soft` | Text (primary / secondary) | — |

**Restraint rule:** Spend boldness in one place. The gradient hero and the bunting are the memorable moments; keep everything else quiet — cream cards, hairline borders, generous spacing.

---

## 2. Typography

Two Google Fonts. Load once in the document head:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Mulish:wght@400;600;700;800&display=swap" rel="stylesheet">
```

```css
:root {
  --font-display: 'Fraunces', Georgia, serif;   /* warm, characterful — headings & numbers */
  --font-body:    'Mulish', system-ui, sans-serif; /* clean humanist — UI & body */
}
```

### Type scale

| Role | Font | Size | Weight | Notes |
|---|---|---|---|---|
| Wordmark | Display | 40px | 600 | Letter-spacing −0.5px |
| Screen title | Display | 24px | 600 | One per screen |
| Big number (stat/balance) | Display | 28–46px | 600 | Use for money & counts |
| Card / item title | Display **or** Body | 16–19px | 600 / 800 | Display for feature cards, Body-800 for list rows |
| Body text | Body | 14–15px | 400–700 | Line-height ~1.5 |
| Eyebrow / section label | Body | 12px | 800 | UPPERCASE, letter-spacing 1.5px, colored `--accent` |
| Field label | Body | 12.5px | 800 | UPPERCASE, letter-spacing 0.4px, color `--ink-soft` |
| Caption / helper | Body | 11–13px | 700 | color `--ink-soft` |
| Badge / pill | Body | 11px | 800 | UPPERCASE, letter-spacing 0.2px |

**Pairing rule:** Fraunces appears only on headings, the wordmark, and large numbers — used with restraint. Everything functional (labels, buttons, body, captions) is Mulish.

---

## 3. Spacing & layout

- **Base unit:** 4px. Common steps: 4, 6, 8, 10, 12, 14, 16, 18, 20, 24.
- **Screen padding:** 18–20px horizontal.
- **Card padding:** 16px.
- **Gap between stacked cards:** 10–14px.
- **Grid gaps:** 10–12px.

### App frame (mobile-first)

- Design at a **portrait phone width (~412px)**; everything is mobile-first and scales up.
- Layout is a vertical flex column: **fixed header region → scrollable content → fixed bottom navigation**.
- Content area scrolls; bottom nav stays pinned.
- Optional "device frame" for marketing/preview: max-width 412px, `--r-frame` corners, 6px solid `#0E2E47` border, centered on a `radial-gradient(circle at 20% 0%, #2E7DB0 0%, #123F62 45%)` backdrop. **This frame is presentational only — omit it in the real app so screens fill the viewport.**

---

## 4. Components

### 4.1 Buttons

Shared: `--font-body`, weight 800, border-radius `--r-btn`, no border, `display:inline-flex; align-items:center; gap:8px`. Padding `13px 18px` (default) or `9px 14px` (small). Pressed state nudges down 1px. Disabled = 45% opacity.

| Variant | Background | Text | Drop line (box-shadow) |
|---|---|---|---|
| **Primary** | `--accent` | `--brand-deep` | `0 2px 0 var(--accent-shadow)` |
| **Brand** | `--brand-gradient` | `#fff` | `0 2px 0 var(--brand-deep)` |
| **Ghost** | transparent | `--brand` | `inset 0 0 0 1.5px var(--line)` |
| **Berry** | `--berry` | `#fff` | `0 2px 0 var(--berry-shadow)` |

Rule: **one primary (marigold) button per screen.** Secondary actions use Brand or Ghost.

### 4.2 Card

Background `--surface`; 1px solid `--line`; radius `--r-card`; padding 16px; `--shadow-card`. This is the default container for nearly all content.

### 4.3 Pill / badge

Radius `--r-pill`; padding `4px 10px`; font 11px/800; UPPERCASE.

| Tone | Background | Text | Typical meaning |
|---|---|---|---|
| Brand | `--sky` | `--brand` | Paid, Open, neutral count |
| Gold | `#FBEBC7` | `#9A6A0B` | Pending |
| Berry | `--berry-soft` | `#8E304A` | Cancellation / emphasis |
| Mute | `#EFEAdd` | `--ink-soft` | Waived / closed / inactive |

### 4.4 Inputs (text, select, textarea)

Full width; padding `12px 14px`; radius `--r-input`; 1.5px solid `--line`; background `#fff`; font 15px `--ink`. **Focus:** border becomes `--brand`; add a visible focus ring `2.5px solid var(--accent)` with 2px offset for keyboard users. Labels sit above (see field label style in §2).

### 4.5 Toggle (switch)

Track 46×28px, radius pill. Off = `#DFD8C6`; On = `--brand`. Knob 22px white circle, 3px inset, slides left↔right with a 0.2s transition.

### 4.6 Progress bar

Track height 12px, radius pill, background `#EDE6D4`. Fill uses `--accent` (or `--brand-bright` in organizer contexts), radius pill, width animates 0.4s.

### 4.7 Bottom navigation

Container background `--brand-gradient`; top corners radius 20px; padding `8px 6px`; subtle top shadow. Each item is a vertical icon + 10.5px/800 label.
- **Active:** icon `--accent-soft`, label `#fff`.
- **Inactive:** icon & label `#9EBDD6` (cool blue-gray).
- 5 items max. Icons ~20px.

### 4.8 Segmented control (role/tab switch)

Pill container background `--brand-deep`, 4px padding. Active segment = `--accent` background with `--brand-deep` text; inactive = transparent with `#9EBDD6` text. Font 12px/800.

### 4.9 Toast

Floats above the bottom nav. Background `--brand-deep`; white text 14px/700; radius 14px; `--shadow-pop`; leading check icon in `--accent-soft`. Auto-dismiss ~2.6s.

### 4.10 Signature: bunting banner

A row of ~8 triangular flags spanning full width, alternating `--accent`, `--berry`, `--brand-bright`, hung on a faint string (thin curved line). Rendered as inline SVG. Use it **once**, at the top of the Home/hub header — not on every screen.

Reference SVG:

```html
<svg viewBox="0 0 320 34" width="100%" height="30" preserveAspectRatio="none">
  <path d="M0 4 Q160 20 320 4" stroke="#123F62" stroke-width="2" fill="none" opacity=".5"/>
  <!-- 8 triangles, width = 320/8 = 40 each; fills cycle: #E8A020, #C24D6A, #2E7DB0 -->
  <path d="M3 6 L37 6 L20 30 Z"    fill="#E8A020"/>
  <path d="M43 6 L77 6 L60 30 Z"   fill="#C24D6A"/>
  <path d="M83 6 L117 6 L100 30 Z" fill="#2E7DB0"/>
  <path d="M123 6 L157 6 L140 30 Z" fill="#E8A020"/>
  <path d="M163 6 L197 6 L180 30 Z" fill="#C24D6A"/>
  <path d="M203 6 L237 6 L220 30 Z" fill="#2E7DB0"/>
  <path d="M243 6 L277 6 L260 30 Z" fill="#E8A020"/>
  <path d="M283 6 L317 6 L300 30 Z" fill="#C24D6A"/>
</svg>
```

### 4.11 Iconography

Use the **Lucide** icon set (line icons, ~20px, currentColor). Icons used across the app: Home, CalendarDays, Vote, HeartHandshake, User, Megaphone, ClipboardList, BarChart3, Shield, Plus, Check, Download, ChevronRight, ChevronLeft, Pin, X, DollarSign, Users, Settings, MapPin, PartyPopper, CircleCheck, Trash2, Send.

---

## 5. Screen layouts

Each screen = a scrollable content column with 18–20px side padding, an eyebrow + display title at top, cards below, and the fixed bottom nav beneath.

### 5.1 Header / hero (Home)
Full-bleed `--brand-gradient` block with rounded bottom corners (26px). Top: bunting SVG. Center-aligned: small uppercase date eyebrow in `--accent-soft`, large Fraunces title in white, then a location line with a MapPin icon in pale blue.

### 5.2 Home body
- A marigold-tinted CTA card ("Register your household") with a chevron.
- A 2×2 grid of quick-link tiles (Schedule, Vote, Fund, My RSVP), each: icon, bold label, small sub-label.
- Section: "Announcements" — pinned items first (pin icon in `--accent`), each a card with a Fraunces title + body.

### 5.3 Multi-step form (Registration)
- A top progress row: N equal segments; completed = `--accent`, upcoming = `#EAE2D0`.
- Eyebrow "Step X of N" + step title.
- One card per step. Selectable options are cards with a 1.5px border that turns `--brand` + `--sky` fill when selected (check icon).
- Sticky-feeling action row at bottom: Ghost "Back" + Brand/Primary "Continue".
- Review step: line-item list with hairline dividers, a bold total row, and a tinted "how to pay" callout in `--sky`.

### 5.4 List + detail (Schedule)
Group items by day (Fraunces day heading in `--brand`). Each item card: left time column (bold), a vertical `--accent-soft` divider, then title, location (MapPin), description.

### 5.5 Voting
A card: status pill + optional LIVE indicator (berry dot). Fraunces question. Each option is a full-width selectable row; when results are revealed, a translucent fill bar grows behind the row to show the percentage. Selected = `--brand` ring + filled radio with check. Footer shows total votes.

### 5.6 Fund
- A `--brand-gradient` hero card: white "available" number (Fraunces), a progress bar, "raised of goal" caption.
- A marigold-tinted "Chip in" card: dollar input + Primary "Give" button.
- Privacy caption in `--ink-soft`.
- Organizer version adds two stat tiles and a ledger: "Money in" rows (source pill + name + green `+$`) and "Money out" rows (household + berry `−$`).

### 5.7 Dashboard / RSVP list
Cards per registration: household title + status pill; branch + attendee count; attendee rows each with a circular monogram avatar (`--sky` bg, `--brand` initial). Pending registrations show a gold payment callout.

### 5.8 Organizer overview
3 gradient stat tiles (big Fraunces numbers, `--accent-soft` labels) + a 2-column grid of management tiles, each with an icon chip in `--sky`.

### 5.9 Reports
Cards containing charts. Use `--brand`, `--accent`, `--berry`, `--brand-bright` as the categorical palette. Donut for payment status; bar chart for shirt sizes; simple list for dietary needs. Keep chart chrome minimal (no gridlines, hidden Y axis).

---

## 6. Motion & interaction

- Keep motion subtle and purposeful. Transitions ~0.2–0.4s ease on: toggle knob, progress fill, selection state, vote result bars.
- Buttons depress 1px on press.
- Respect `prefers-reduced-motion`: disable non-essential transitions.

---

## 7. Accessibility (quality floor)

- Maintain visible keyboard focus: `2.5px solid var(--accent)` outline, 2px offset, on all interactive elements.
- Body text ≥ 14px; primary text color `--ink` on `--bg`/`--surface` meets contrast.
- Tap targets ≥ 44px tall for nav items, buttons, and list toggles.
- Every icon-only control needs an accessible label (`aria-label`).
- Status is never conveyed by color alone — pills always include a text label.

---

## 8. Quick reference (copy-paste summary)

```
PRIMARY BLUE      #1F5D8C     GRADIENT   linear-gradient(135deg,#2E7DB0,#164A70)
DEEP BLUE         #123F62     MARIGOLD   #E8A020    BERRY   #C24D6A
BACKGROUND        #FBF5E9     SURFACE    #FFFDF6
INK / INK-SOFT    #1E2A33 / #617079      LINE      #EADFC9     SKY  #DDE8EF
DISPLAY FONT      Fraunces (600)         BODY FONT Mulish (400/700/800)
RADII             btn 14 · card 18 · tile 16 · input 12 · pill 999
PRIMARY BUTTON    marigold bg, deep-blue text, "0 2px 0 #C9860F" drop line
SIGNATURE         bunting banner (marigold/berry/blue triangles), used once on Home
```

---

*This document describes the visual system only. It intentionally contains no application logic, data models, or backend behavior — apply it as a styling layer over your existing app.*
