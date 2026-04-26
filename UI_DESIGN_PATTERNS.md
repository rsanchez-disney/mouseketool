# UI Design Patterns

Reference for all UI conventions used across Mouseketool. Every new page and component must follow these
patterns to maintain visual consistency.

---

## Page Layout

- All content pages use `max-w-4xl mx-auto space-y-6` as the root container
- Exception: full-width pages like Launchpad where the canvas needs the space
- Page content is wrapped in `Card` components, never raw divs
- Vertical spacing between cards: `space-y-6`

---

## Cards

### Standard Card
```html
<Card>
  <CardHeader class="pb-3">
    <CardTitle class="flex items-center gap-2 text-base">
      <IconName class="size-4" /> Card Title
    </CardTitle>
  </CardHeader>
  <CardContent class="space-y-4">
    <!-- content -->
  </CardContent>
</Card>
```

### Rules
- `CardHeader` always has `pb-3` to reduce default padding
- `CardTitle` always has `flex items-center gap-2 text-base`
- Title always starts with a Lucide icon at `size-4`
- `CardContent` uses `space-y-4` for internal spacing
- Count badges next to titles use `<Badge variant="secondary">{{ count }}</Badge>`

---

## Side Panels (Sheet)

Used for configuration overlays (vault config, node editing, env vars).

```html
<SheetContent class="w-[420px] sm:max-w-[420px] overflow-y-auto p-6">
  <SheetHeader class="mb-0">
    <SheetTitle class="flex items-center gap-2">
      <IconName class="size-4" /> Panel Title
    </SheetTitle>
    <SheetDescription>Brief explanation of what this panel configures.</SheetDescription>
  </SheetHeader>
  <div class="space-y-2">
    <!-- sections -->
  </div>
</SheetContent>
```

### Rules
- Width: `w-[420px] sm:max-w-[420px]`
- Always `overflow-y-auto p-6`
- Title has icon + text, same pattern as CardTitle
- Always include `SheetDescription` with a one-liner
- Header margin: `mb-0` (tight) to `mb-4` (relaxed) depending on content density
- Section gap: `space-y-2` for dense panels, `space-y-4` for relaxed

### Form Sections Inside Sheets
Group related fields in bordered sections:
```html
<div class="space-y-4 rounded-lg border p-4">
  <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Section Name</p>
  <!-- fields -->
</div>
```

- Section label: `text-xs font-semibold uppercase tracking-wider text-muted-foreground`
- Internal spacing: `space-y-4` between fields within a section
- Section container: `space-y-4 rounded-lg border p-4`
- Gap between sections: `space-y-2` to `space-y-3`

---

## Form Fields

### Labels
```html
<Label class="text-xs">Field Name</Label>
```
- Always `text-xs`
- For fields needing explanation, add an info icon tooltip:
```html
<Label class="text-xs flex items-center gap-1">
  Field Name
  <Tooltip>
    <TooltipTrigger as-child>
      <Info class="size-3 text-muted-foreground cursor-help" />
    </TooltipTrigger>
    <TooltipContent class="max-w-[220px]">Help text here.</TooltipContent>
  </Tooltip>
</Label>
```

### Inputs
```html
<Input v-model="value" class="text-sm" placeholder="Placeholder text" />
```
- Always `text-sm`
- Monospace inputs (paths, commands, env vars): add `font-mono text-xs`
- Fixed-width inputs (short values): add `w-32` or `w-36`

### Select Dropdowns
```html
<Select v-model="value">
  <SelectTrigger class="!w-full overflow-hidden">
    <SelectValue placeholder="Select..." />
  </SelectTrigger>
  <SelectContent>
    <SelectItem v-for="item in items" :key="item.id" :value="item.value">
      {{ item.label }}
    </SelectItem>
  </SelectContent>
</Select>
```
- Inside sheets: always use `!w-full overflow-hidden` on SelectTrigger to prevent overflow
  (the default `w-fit` causes horizontal scrollbars with long text)

### Env Var Editors
```html
<div v-for="(ev, i) in envVars" :key="i" class="flex items-center gap-2">
  <Input v-model="ev.key" placeholder="KEY" class="text-xs font-mono flex-1" />
  <Input v-model="ev.value" placeholder="value" class="text-xs font-mono flex-1" />
  <Button variant="ghost" size="icon" class="size-6 shrink-0 cursor-pointer" @click="remove(i)">
    <Trash2 class="size-3" />
  </Button>
</div>
```
- Key and value inputs: `text-xs font-mono flex-1`
- Delete button: `variant="ghost" size="icon" class="size-6 shrink-0"`
- Add button above the list: `variant="ghost" size="sm" class="h-6 text-xs"`

---

## Buttons

### Primary Actions
```html
<Button size="sm" class="gap-1.5 cursor-pointer">
  <IconName class="size-3.5" /> Label
</Button>
```

### Secondary/Toolbar Actions
```html
<Button variant="outline" size="sm" class="gap-1.5 cursor-pointer">
  <IconName class="size-3.5" /> Label
</Button>
```

### Icon-Only Buttons
```html
<Button variant="ghost" size="icon" class="size-8 cursor-pointer">
  <IconName class="size-4" />
</Button>
```

### Destructive Icon Buttons
```html
<Button variant="ghost" size="icon" class="size-8 text-muted-foreground hover:text-red-500 cursor-pointer">
  <Trash2 class="size-4" />
</Button>
```

### Rules
- Always include `cursor-pointer`
- Always include `gap-1.5` when button has icon + text
- Icon size inside buttons: `size-3.5` (with text) or `size-4` (icon-only)
- Loading state: replace icon with `<Loader2 class="size-3.5 animate-spin" />`
- Disabled state: use `:disabled` prop, never hide the button

---

## Tooltips

Every icon button and metadata icon on cards must have a tooltip.

### On Buttons
```html
<Tooltip>
  <TooltipTrigger as-child>
    <Button ...>...</Button>
  </TooltipTrigger>
  <TooltipContent>Action description</TooltipContent>
</Tooltip>
```

### On Metadata Icons (Card Footers)
```html
<Tooltip>
  <TooltipTrigger as-child>
    <span class="flex items-center gap-1 text-xs text-muted-foreground">
      <IconName class="size-3 shrink-0" />{{ value }}
    </span>
  </TooltipTrigger>
  <TooltipContent>What this value represents</TooltipContent>
</Tooltip>
```

### On Info Icons (Labels)
```html
<Tooltip>
  <TooltipTrigger as-child>
    <Info class="size-3 text-muted-foreground cursor-help" />
  </TooltipTrigger>
  <TooltipContent class="max-w-[220px]">Explanation text.</TooltipContent>
</Tooltip>
```

### Rules
- Every icon-only button needs a tooltip
- Every metadata indicator on cards needs a tooltip
- Tooltip for timestamps should show full date: `Registered on {{ new Date(date).toLocaleString('en-GB') }}`
- Long tooltip text: add `class="max-w-[220px]"` on TooltipContent
- `TooltipProvider` with `:delay-duration="300"` is set at the app root (App.vue)

---

## Badges

### Status Badges (Semantic Colors)
```
Success:  bg-green-500/20 text-green-500 border-green-500/40
Error:    bg-red-500/20 text-red-500 border-red-500/40
Warning:  bg-amber-500/20 text-amber-500 border-amber-500/40
Info:     bg-blue-400/20 text-blue-400 border-blue-400/40
Purple:   bg-purple-500/20 text-purple-500 border-purple-500/40
```
All status badges: `text-[10px]`

### Count Badges
```html
<Badge variant="secondary">{{ count }}</Badge>
<Badge variant="secondary" class="ml-1 text-[10px]">{{ count }}</Badge>
```

### Metadata Badges
```html
<Badge variant="outline" class="text-[10px]">label</Badge>
```

### Small Inline Badges (on nodes, compact cards)
```html
<Badge variant="outline" class="text-[9px] px-1 py-0">label</Badge>
```

---

## List Items (Card Rows)

Used for cached builds, registered projects, pipeline cards, deployment cards.

```html
<div class="flex items-center justify-between rounded-lg border p-3">
  <div class="space-y-0.5 min-w-0 flex-1">
    <p class="text-sm font-medium">{{ name }}</p>
    <p class="text-xs text-muted-foreground truncate">{{ subtitle }}</p>
    <div class="flex items-center gap-3 mt-1.5">
      <!-- metadata with tooltips -->
    </div>
  </div>
  <div class="flex items-center gap-1 shrink-0 ml-3">
    <!-- action buttons with tooltips -->
  </div>
</div>
```

### Rules
- Container: `rounded-lg border p-3`
- Name: `text-sm font-medium`
- Subtitle/path: `text-xs text-muted-foreground truncate`
- Metadata row: `flex items-center gap-3 mt-1.5`
- Metadata items: `flex items-center gap-1 text-xs text-muted-foreground` with `shrink-0` on icons
- Action buttons: `shrink-0 ml-3` container, ghost icon buttons inside
- Every metadata item and action button gets a tooltip

---

## Colors

### Text
- Primary text: default (no class)
- Secondary text: `text-muted-foreground`
- Monospace values: `font-mono text-xs text-muted-foreground`

### Backgrounds
- Page: default background
- Cards: default (Card component handles it)
- Muted sections: `bg-muted/30` or `bg-muted/50`
- Console/log output: `bg-zinc-950` with `text-zinc-300`

### Borders
- Standard: default border (via `border` class)
- Active/selected: `border-primary ring-1 ring-primary/20`
- Warning: `border-amber-500/40`

---

## Icons

- All icons from `lucide-vue-next`
- Card titles: `size-4`
- Inside buttons with text: `size-3.5`
- Icon-only buttons: `size-4`
- Metadata indicators: `size-3`
- Info/help icons: `size-3 text-muted-foreground cursor-help`
- Loading spinner: `<Loader2 class="size-3.5 animate-spin" />`

---

## Toast Notifications

Inline fixed-position toasts, not a toast library.

```html
<div v-if="toastMsg" :key="toastMsg"
  class="fixed bottom-6 right-6 z-[100] flex items-center gap-2 text-sm text-white rounded-lg px-4 py-3 shadow-lg animate-in fade-in"
  :class="type === 'warning' ? 'bg-amber-600' : 'bg-green-600'">
  <AlertTriangle v-if="type === 'warning'" class="size-4" />
  <Check v-else class="size-4" />
  {{ toastMsg }}
</div>
```

- Position: `fixed bottom-6 right-6 z-[100]`
- Auto-dismiss: `setTimeout(() => msg = "", 3000)`
- Warning: `bg-amber-600` with `AlertTriangle` icon
- Success: `bg-green-600` with `Check` icon

---

## Expanded Console (Log Viewer)

Used for build output, invocation logs.

```html
<Teleport to="body">
  <div class="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-8">
    <div class="w-full max-w-5xl h-[80vh] rounded-lg border bg-zinc-950 flex flex-col">
      <div class="flex items-center justify-between px-4 py-2 border-b border-zinc-800">
        <!-- toolbar: line count, search, copy, minimize -->
      </div>
      <ScrollArea class="flex-1 p-4">
        <p class="text-xs font-mono text-zinc-300 leading-5 whitespace-pre-wrap">{{ line }}</p>
      </ScrollArea>
    </div>
  </div>
</Teleport>
```

- Background: `bg-zinc-950`
- Text: `text-xs font-mono text-zinc-300 leading-5 whitespace-pre-wrap`
- Toolbar text: `text-zinc-400`
- Close on Escape key and click-outside

---

## Confirmation Dialogs

Use the shared `ConfirmDialog` component for destructive actions.

```html
<ConfirmDialog
  v-if="target"
  title="Delete Item"
  :description="`Are you sure you want to delete ${target.name}?`"
  @confirm="handleConfirm"
  @cancel="target = null"
/>
```

---

## Toggle Component

Use the shared `Toggle.vue` component for all boolean switches. Never use the shadcn Switch
component (it breaks inside Sheet).

```html
<Toggle v-model="value" />
```

---

## Navbar

### Group Structure
```
--- Serverless --- (SidebarGroupLabel)
  Lambda Builder
  Deployments
  Triggers
<div class="mx-3 border-t" />  (separator)
--- Batch --- (SidebarGroupLabel)
  Batch Projects
  Launchpad
<div class="mx-3 border-t" />  (separator)
(no label)
  Settings
```

- Group separators: `<div class="mx-3 border-t" />` (not SidebarSeparator, which causes overflow)
- Help button stays in the header bar (right corner), not in the sidebar
- Active state: `:is-active="route.path === item.path || route.path.startsWith(item.path + '/')"`

---

## Kiro AI Gating

All AI features must be conditionally rendered based on `kiroAvailable` (provided from App.vue).

```typescript
const kiroAvailable = inject<Ref<boolean>>("kiroAvailable", ref(false));
```

- When available: show AI buttons, purple navbar badge
- When unavailable: hide AI buttons entirely, show gray navbar badge with install tooltip
