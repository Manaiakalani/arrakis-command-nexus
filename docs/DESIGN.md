# Arrakis Command Nexus: Design System

A reference for contributors building UI in the Arrakis Command Nexus dashboard.
Inspired by Google Stitch and Material Design 3 principles, adapted for a Dune-themed
dark-first gaming admin panel.

---

## 1. Design Principles

| Principle | Application |
|-----------|-------------|
| **Clarity over decoration** | Every element must communicate state. No ornamental UI. |
| **Dark-first** | Dark mode is the primary experience; light mode is the alternate. |
| **Density-aware** | Dashboard layouts are information-dense. Use spacing to group, not to fill. |
| **Immediate feedback** | Toast notifications for transient events, inline banners for contextual state. |
| **Accessible** | Minimum 4.5:1 contrast for text, focus-visible rings on all interactive elements. |

---

## 2. Color Tokens

### Semantic Tokens (CSS custom properties)

These use RGB channel format for Tailwind alpha support (`rgb(var(--token) / alpha)`):

| Token | Dark Value | Light Value | Usage |
|-------|-----------|-------------|-------|
| `--th-bg` | slate-950 `2 6 23` | slate-50 `248 250 252` | Page background |
| `--th-bg-s` | slate-900 `15 23 42` | slate-100 `241 245 249` | Secondary background |
| `--th-surface` | slate-800 `30 41 59` | white `255 255 255` | Card/panel surface |
| `--th-surface-s` | slate-900 `15 23 42` | slate-100 `241 245 249` | Recessed surface |
| `--th-border` | slate-700 `51 65 85` | slate-300 `203 213 225` | Primary border |
| `--th-border-m` | slate-800 `30 41 59` | slate-200 `226 232 240` | Muted border |
| `--th-text` | slate-50 `248 250 252` | slate-900 `15 23 42` | Primary text |
| `--th-text-s` | slate-300 `203 213 225` | slate-600 `71 85 105` | Secondary text |
| `--th-text-m` | slate-400 `148 163 184` | slate-500 `100 116 139` | Muted text |

### Brand Colors (Tailwind)

```
dune-night:      #020617     Deep background
dune-background: #0f172a     Panel base
dune-panel:      #1e293b     Elevated surface
dune-border:     #334155     Separator
dune-sand:       #fbbf24     Primary accent (amber-400)
dune-amber:      #f59e0b     Secondary accent (amber-500)
dune-ember:      #d97706     Warm accent
dune-spice:      #fb923c     Highlight accent (orange-400)
dune-success:    #10b981     Positive state
dune-warning:    #d97706     Caution state
dune-danger:     #ef4444     Destructive state
dune-text:       #f8fafc     Primary text
dune-muted:      #94a3b8     Subdued text
```

### Status Colors

| State | Color | Glow | Example |
|-------|-------|------|---------|
| Healthy | `bg-emerald-400` | `shadow-[0_0_12px_rgba(16,185,129,0.85)]` | Server running |
| Degraded | `bg-amber-400` | `shadow-[0_0_12px_rgba(245,158,11,0.85)]` | High memory |
| Offline | `bg-red-500` | `shadow-[0_0_12px_rgba(239,68,68,0.75)]` | Service down |
| Starting | `bg-sky-400` | `shadow-[0_0_12px_rgba(56,189,248,0.75)]` | Container boot |

---

## 3. Typography

- **Font family:** Inter (variable), system-ui fallback
- **Headings:** `text-2xl font-bold text-sand-100` (page title), `text-lg font-semibold` (section)
- **Section labels:** `.section-title` - `text-sm font-semibold uppercase tracking-[0.24em] text-amber-600 dark:text-amber-300/80`
- **Body:** `text-sm text-th-text-s`
- **Muted:** `text-sm text-th-text-m` or `text-sand-400`

---

## 4. Component Patterns

### Glass Panel (`.glass-panel`)
```css
rounded-2xl border border-th-border/70 bg-th-surface/70 backdrop-blur-xl
box-shadow: 0 20px 60px -24px rgba(15, 23, 42, 0.75);  /* dark */
box-shadow: 0 20px 60px -24px rgba(0, 0, 0, 0.08);     /* light */
```

### Metric Card (`.metric-card`)
Extends `.glass-panel` with `p-5`. Used for at-a-glance stats on the overview page.

### Primary Button (`.dune-button`)
```
rounded-xl border border-amber-500/30 bg-amber-500/15
text-sm font-semibold text-amber-700 dark:text-amber-200
hover:border-amber-400/50 hover:bg-amber-500/25
active:scale-[0.97]
focus-visible:ring-2 ring-amber-400/60
```

### Muted Button (`.dune-button-muted`)
Same shape, neutral colors: `border-th-border bg-th-surface-s/70`.

### Input (`.dune-input`)
```
rounded-xl border border-th-border bg-th-surface-s/70
px-4 py-2.5 text-sm
focus:border-amber-400/60 focus:bg-th-surface
focus-visible:ring-2 ring-amber-400/60
```

### Badge
```tsx
<span className="inline-block rounded-md border px-2 py-0.5 text-xs font-medium
  bg-amber-500/20 text-amber-400 border-amber-500/30">
  Label
</span>
```

Variant colors follow the action palette (red for destructive, green for positive, etc.)

---

## 5. Layout

### Sidebar Navigation
- Collapsible rail (`w-16` collapsed, `w-64` expanded)
- Icons from `lucide-react`
- Active link: `bg-amber-500/15 text-amber-500`
- Server health indicator dot in the logo area

### Page Structure
```tsx
<div className="space-y-6">
  {/* Header: icon + title + description + action button */}
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-3">
      <Icon className="h-7 w-7 text-amber-400" />
      <div>
        <h1 className="text-2xl font-bold text-sand-100">Page Title</h1>
        <p className="text-sm text-sand-400">Description</p>
      </div>
    </div>
    <button className="...">Action</button>
  </div>

  {/* Summary cards (optional) */}
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">...</div>

  {/* Main content */}
  <div className="rounded-xl border border-sand-700/50 bg-sand-900/40">...</div>
</div>
```

---

## 6. Feedback Patterns

### Toast Notifications
Global toast system via `<ToastProvider>`. Import with:
```tsx
import { useToast } from '@/components/ToastProvider';
const { toast } = useToast();
toast('Item granted successfully', 'success');
toast('Failed to save configuration', 'error');
```

Variants: `success` | `error` | `info` | `warning`
- Auto-dismiss after 5 seconds
- Renders bottom-right, stacked
- Slide-in animation

### Inline Feedback
For contextual form feedback (e.g., grant result near the grant form):
```tsx
{result && (
  <div className={`mt-2 rounded-lg border px-3 py-2 text-sm ${
    result.tone === 'success'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
      : 'border-red-500/30 bg-red-500/10 text-red-400'
  }`}>
    {result.message}
  </div>
)}
```

### When to Use Each
| Scenario | Pattern |
|----------|---------|
| Network error | Toast (error) |
| Action success (save, grant) | Toast (success) + inline |
| Form validation error | Inline only |
| Background event (player joined) | Toast (info) |
| Loading data | Skeleton or spinner, never a toast |

---

## 7. Motion

| Token | Value | Usage |
|-------|-------|-------|
| `--duration-fast` | 150ms | Button press, hover |
| `--duration-normal` | 200ms | Input focus, panel transitions |
| `--ease-out-expo` | `cubic-bezier(0.16, 1, 0.3, 1)` | Smooth deceleration |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Bouncy feedback |

Animations:
- `animate-float` - Gentle 4s bob for status indicators
- `animate-shimmer` - Loading skeleton sweep
- `animate-pulse-slow` - 2s breathing for ambient state
- `active:scale-[0.97]` - Tactile press on all buttons

Respect `prefers-reduced-motion` by disabling all animations.

---

## 8. Data Tables

```tsx
<table className="w-full text-sm">
  <thead>
    <tr className="border-b border-sand-700/50 text-sand-400">
      <th className="px-4 py-3 text-left font-medium">Column</th>
    </tr>
  </thead>
  <tbody className="divide-y divide-sand-800/50">
    <tr className="hover:bg-sand-800/30 cursor-pointer transition-colors">
      <td className="px-4 py-3 text-sand-300">Value</td>
    </tr>
  </tbody>
</table>
```

- No zebra striping; use `hover:bg-sand-800/30` for row highlight
- Clickable rows use `cursor-pointer`
- Wrap in `rounded-xl border border-sand-700/50 bg-sand-900/40 overflow-hidden`

---

## 9. Responsive Behavior

- Sidebar collapses to icon rail below `lg` breakpoint
- Summary cards: `grid-cols-2 sm:grid-cols-4`
- Tables scroll horizontally on mobile (`overflow-x-auto`)
- Touch target minimum: 44px

---

## 10. Accessibility

- All interactive elements have `focus-visible:ring-2 focus-visible:ring-amber-400/60`
- Toast container uses `aria-live="polite"` and `role="alert"`
- Status dots include `aria-label` text
- Color is never the only indicator of state (always paired with text or icons)
- Form inputs have associated labels
- Error boundaries catch and display render failures gracefully
