---
id: tl-log
tab: tools
title: Log Viewer
icon: MonitorPlay
---

All log viewers (Builder, Deployments, Execution, History, Launchpad) share consistent behavior:

- **Auto-scroll** - New lines scroll into view. Scrolling up disables follow; click arrow to re-enable.
- **Search** - Expanded view dims non-matching lines to 20% opacity, keeping context visible.
- **Copy** - Copies all content to clipboard with toast confirmation.
- **Root cause panel** - Extracts `Caused by` and exception lines at the top.
- **Kiro explain** - Sends error context to Kiro for plain-English explanation.

## Color coding

- Red: Errors & exceptions
- Yellow: Warnings
- Blue: Section headers
