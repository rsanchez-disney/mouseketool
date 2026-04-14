# SQS Lambda Tester — Design Guidelines

## Component Library
- **shadcn-vue** — accessible, composable components built on Reka UI + Tailwind CSS
- **Lucide icons** — consistent, clean SVG icon set (no emojis, no icon fonts)
- **Tailwind CSS v4** — utility-first styling with CSS variables for theming

## Visual Identity
- Enterprise-grade, clean, professional aesthetic
- Neutral base color palette with subtle accent colors
- Consistent border radius via `--radius` CSS variable (shadcn default)
- Inter font family for all text

## Theme
- Dark mode via `.dark` class on `<html>` element
- All shadcn CSS variables defined in `main.css` for both `:root` and `.dark`
- Both themes are first-class — no afterthought dark mode

## Component Patterns
- Cards: shadcn `Card` with `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`
- Forms: shadcn `Input`, `Label`, `Select` with proper spacing (`space-y-2`)
- Buttons: shadcn `Button` with appropriate variants (`default`, `outline`, `ghost`, `destructive`)
- Modals: shadcn `Dialog` with `DialogHeader`, `DialogFooter`
- Navigation: shadcn `Sidebar` with collapsible support
- Status: shadcn `Badge` with semantic variants
- Scrollable areas: shadcn `ScrollArea`

## Icons
- Always use Lucide icons — never emojis or raw SVGs
- Icon size: `size-4` for inline, `size-5` for card headers
- Pair icons with text labels for clarity

## Interaction & Motion
- Transitions on route changes (fade, 150ms)
- Loading states: `Loader2` icon with `animate-spin`
- Pulsing cursor in build console during active builds
- Hover states on interactive list items (`hover:bg-muted/50`)

## General Rules
- Consistent spacing via Tailwind scale (`gap-2`, `gap-4`, `space-y-4`)
- Responsive by default
- Accessibility: proper labels, focus rings, semantic HTML, ARIA via Reka UI
- No hardcoded colors — always use CSS variable-based classes (`text-muted-foreground`, `bg-muted`, etc.)
