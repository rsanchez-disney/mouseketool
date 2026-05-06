# Mouseketool — Design Guidelines

## Component Library
- **shadcn-vue** — accessible, composable components built on Reka UI + Tailwind CSS
- **Lucide icons** — consistent, clean SVG icon set (no emojis, no icon fonts)
- **Tailwind CSS v4** — utility-first styling with CSS variables for theming
- **VueFlow** — node-based canvas for workflow editor

## Visual Identity
- Enterprise-grade, clean, professional aesthetic
- Neutral base color palette with subtle accent colors for status and categories
- Consistent border radius via `--radius` CSS variable (shadcn default)
- Inter font family for all text (system font stack fallback)

## Theme
- Dark mode is the primary theme (`.dark` class on `<html>`)
- Light mode supported via theme toggle in the navbar
- All shadcn CSS variables defined in `main.css` for both `:root` and `.dark`
- Both themes are first-class — no afterthought dark mode
- Theme animation toggle in Settings > UI

## Component Patterns
- Cards: shadcn `Card` with `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`
- Forms: shadcn `Input`, `Label`, `Select` with proper spacing (`space-y-2`)
- Buttons: shadcn `Button` with appropriate variants (`default`, `outline`, `ghost`, `destructive`)
- Modals: shadcn `Dialog` with `DialogHeader`, `DialogFooter`
- Side panels: shadcn `Sheet` for configuration overlays (vault, env vars, node editing)
- Navigation: shadcn `Sidebar` with collapsible groups and separators
- Status: shadcn `Badge` with semantic color variants
- Scrollable areas: shadcn `ScrollArea`
- Toggles: custom `Toggle.vue` component (not shadcn Switch — it breaks inside Sheet)
- Tooltips: required on every icon button and metadata indicator
- Confirmation: shared `ConfirmDialog` component for destructive actions
- File browser: shared `FolderBrowser` component for directory selection

## Icons
- Always use Lucide icons — never emojis or raw SVGs (exception: the app logo)
- Icon size: `size-3` for metadata, `size-3.5` inside buttons with text, `size-4` for card headers and icon-only buttons
- Pair icons with text labels for clarity
- Loading spinner: `Loader2` with `animate-spin`

## Color Semantics
- Green: success, active, healthy, deployed
- Red: error, failed, destructive
- Amber: warning, in-progress, heavy load
- Blue: info, building, stream handler
- Violet/Purple: AI features, Kiro integration
- Emerald: updates available

## Interaction & Motion
- Page entrance animations: `animate-in fade-in slide-in-from-bottom-2 duration-300`
- Loading states: `Loader2` icon with `animate-spin`
- Collapsible sections: `grid-rows-[1fr]` / `grid-rows-[0fr]` with `transition-all duration-300`
- Hover states on interactive items: `hover:bg-muted/50`
- Toast notifications: fixed bottom-right, auto-dismiss after 3s
- Confetti: `ParticleBurst` component on success events (gated by Settings)
- Flow diagrams: animated dashed lines via CSS `background` animation

## Layout Rules
- Page root container: `space-y-6`
- Cards contain all content — never raw divs at page level
- Vertical spacing between cards: `space-y-6`
- Side panels: `w-[420px] sm:max-w-[420px] overflow-y-auto p-6`
- Console/log output: `bg-zinc-950` with `text-xs font-mono text-zinc-300`

## General Rules
- Consistent spacing via Tailwind scale (`gap-2`, `gap-4`, `space-y-4`)
- Responsive by default
- Accessibility: proper labels, focus rings, semantic HTML, ARIA via Reka UI
- No hardcoded colors — always use CSS variable-based classes (`text-muted-foreground`, `bg-muted`, etc.)
- All buttons must include `cursor-pointer`
- AI features gated behind `kiroAvailable` inject — hide entirely when unavailable
- No `@apply` in scoped styles (Tailwind 4 incompatible) — use plain CSS or `:deep()` selectors
