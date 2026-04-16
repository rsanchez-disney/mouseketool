# Mouseketool — Frontend

Vue 3 + TypeScript single-page application with Tailwind CSS 4 and shadcn-vue (Reka UI) components.

## Running

```bash
npm install
npm run dev          # Development server with HMR
npm run build        # Production build
npm run type-check   # TypeScript type checking
```

The dev server starts on `http://localhost:5173` and proxies `/api` requests to the backend at `http://localhost:3001`.

## Routes

| Path | Page | Description |
|---|---|---|
| `/builder` | BuilderPage | Build Java projects |
| `/deployments` | DeploymentsPage | Manage and invoke Lambdas |
| `/triggers` | TriggersPage | Create and manage pipelines |
| `/triggers/:id/execute` | ExecutionPage | Run a pipeline |
| `/triggers/:id/history` | HistoryPage | View pipeline run history |
| `/settings` | SettingsPage | Configure LocalStack connection |
| `/help` | HelpPage | In-app documentation |

Registered via `window.addEventListener("keydown")` in `onMounted`, cleaned up in `onUnmounted`.

## Dependencies

- **vue** 3 + **vue-router** 5 — SPA framework and routing
- **reka-ui** — Headless UI primitives (shadcn-vue foundation)
- **tailwindcss** 4 + **tw-animate-css** — Styling and animations
- **lucide-vue-next** — Icon library
- **class-variance-authority** + **clsx** + **tailwind-merge** — Class composition utilities
- **@vueuse/core** — Vue composition utilities

[← Back to README](../README.md)
