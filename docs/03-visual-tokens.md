# Visual Tokens

## Yoga Center Attendance System

Minimal visual foundation for the application UI.

---

## 1. Colors

### Brand & Neutral

| Token | Hex | Usage |
|---|---|---|
| Primary / Teal | `#0F8B87` | Primary brand color, primary actions, active navigation, focus and key highlights |
| Background | `#F8FAFA` | Main application/page background |
| Surface | `#FFFFFF` | Cards, forms, tables and panels |
| Text Primary | `#1F2933` | Headings and primary content |
| Text Secondary | `#667085` | Supporting text and descriptions |
| Border | `#E4E7EC` | Borders, dividers and input outlines |

### Semantic Status Colors

| Token | Hex | Usage |
|---|---|---|
| Success | `#22C55E` | Success, Present, Active, Completed |
| Warning | `#F59E0B` | Warning, Pending, Upcoming |
| Danger | `#EF4444` | Error, Absent, Inactive, Cancelled |
| Info | `#3B82F6` | Informational states |
| Neutral | `#98A2B3` | Draft, Not Started, Disabled or states that do not need emphasis |

### Color Principles

- Keep approximately **70–80% of the interface neutral**.
- Use approximately **15–20% teal/brand** for primary actions, active navigation, focus and important highlights.
- Keep semantic status colors to a small percentage of the interface.
- **Reuse an existing semantic token before creating a new color.**
- Do not introduce a new status color simply because a new status name is added.
- Add a new semantic color only when an existing token cannot communicate the meaning clearly.

---

## 2. Typography

### Font Family

**Inter**

Use Inter as the single application typeface.

### Type Styles

| Token | Size | Weight | Line Height |
|---|---:|---:|---:|
| Page Title | 24px | 600 (SemiBold) | 32px |
| Section Title | 18px | 600 (SemiBold) | 28px |
| Body | 14px | 400 (Regular) | 22px |
| Small / Caption | 12px | 400 (Regular) | 18px |
| Button | 14px | 500 (Medium) | 20px |

### Typography Principles

- Use size and weight to establish hierarchy.
- Keep typography clean and readable.
- Avoid unnecessary font families or decorative typefaces.

### Component Typography Ownership

Most text takes its size from context (a heading, a paragraph, a table
cell). Some shared components instead **own** their typography, because a
fixed size is part of their visual identity, not something the surrounding
layout should decide.

A shared component owns its typography when a different size would make it
a different component — a status pill that inherited its parent's heading
size would no longer read as a compact status pill.

**Badge is the canonical example: always 12px / 18px (Small / Caption),
regardless of where it is placed.** It must not inherit font size or line
height from a parent wrapper. If a Badge instance ever renders at another
size, the fault is that instance losing its own typography, not a missing
size on the surrounding layout.

**StatTile typography contract.** `StatTile` sets every text size itself; no
parent style may change its hierarchy.

| Part | Style | Role |
|---|---|---|
| Value | Page Title, 24px / 32px, SemiBold, primary text | The KPI figure — clearly the largest text in the tile |
| Label | Small, 12px / 18px, Regular, secondary text | Noticeably smaller than the value; never inherits its size |
| Supporting metric | Small, 12px / 18px, Medium, tone colour | Compact, right-aligned (e.g. share of total) |
| Decorative chart | Fixed 5-bar graphic, tone colour, `aria-hidden` | Decoration only |

The decorative chart is one fixed shape in every tile and encodes no data.
It must never be given real values or trend meaning; trend figures (e.g.
"+2") appear only when real historical data exists.

---

## 3. Spacing

### Base Unit

**4px**

### Spacing Scale

```text
4
8
12
16
20
24
32
40
48
```

Use this scale consistently for padding, margin, gaps and layout spacing.

---

## 4. Radius

| Token | Value | Usage |
|---|---:|---|
| Input | 6px | Input and form controls |
| Button | 8px | Buttons |
| Card | 12px | Cards and main content containers |

Keep corner rounding moderate. The interface should feel modern and polished without becoming overly rounded or playful.

---

## 5. Shadows

Use shadows sparingly.

| Token | Value |
|---|---|
| None | `none` |
| XS | `0 1px 2px rgba(16, 24, 40, 0.05)` |
| SM | `0 1px 3px rgba(16, 24, 40, 0.06)` |
| MD | `0 4px 6px rgba(16, 24, 40, 0.06)` |
| LG | `0 10px 15px rgba(16, 24, 40, 0.08)` |
| XL | `0 20px 25px rgba(16, 24, 40, 0.10)` |

Prefer a subtle border and clean surface over a heavy shadow.

---

## 6. Visual Character

**Calm · Modern · Professional · Focused**

The visual language should feel clean, calm and professional while remaining practical for a modern management application.

Prefer:

- Neutral surfaces
- Teal as the primary accent
- Inter typography
- Consistent 4px-based spacing
- Subtle borders
- Light elevation
- Moderate corner radius
- Clear visual hierarchy

Avoid:

- Excessive colors
- Heavy shadows
- Excessive pill-shaped UI
- Decorative gradients
- Multiple font families
- Random one-off colors

---

## 7. Token Maintenance Rule

Visual tokens are a controlled foundation, not a list of every color used on every screen.

When a new UI state appears:

1. Check whether **Neutral** is appropriate.
2. Check whether an existing semantic token (**Success, Warning, Danger, Info**) fits.
3. Reuse the existing token whenever possible.
4. Add a new semantic token only when a genuinely new visual meaning is required.
5. If a new token is approved, update this document and use the token consistently across the product.

**Do not add raw hex colors directly to individual screens when an existing token applies.**

### Batch Identity accents

A batch has a user-chosen accent color (Teal, Blue, Indigo, Purple, Pink, Orange, Amber, Green, Red, Slate), stored as a stable key. The colors are the `--batch-*` tokens in `app/globals.css` (Teal is the brand color); `lib/batches/identity.js` maps each key to its classes. They are an **accent only** (a dot, a tint, a left edge) and never replace the semantic status colors above. The batch name or code is always shown beside them, so color is never the only identifier.

---

## 8. Token Summary

```text
COLORS

Primary / Teal     #0F8B87
Background          #F8FAFA
Surface             #FFFFFF
Text Primary        #1F2933
Text Secondary      #667085
Border              #E4E7EC

STATUS

Success             #22C55E
Warning             #F59E0B
Danger              #EF4444
Info                #3B82F6
Neutral             #98A2B3

TYPOGRAPHY

Font                Inter
Page Title          24px / 600 / 32px
Section Title       18px / 600 / 28px
Body                14px / 400 / 22px
Small               12px / 400 / 18px
Button              14px / 500 / 20px

SPACING

4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48

RADIUS

Input               6px
Button              8px
Card                12px

SHADOWS

None / XS / SM / MD / LG / XL
```
