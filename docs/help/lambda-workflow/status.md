---
id: lw-status
tab: lambda
title: Deployment Status
icon: CloudCog
---

Mouseketool checks each function against LocalStack on page load. Click **Refresh** to re-check manually.

- **active** - Function exists and is ready.
- **failed** - Function exists but in a failed state.
- **unknown** - Couldn't reach LocalStack within 3 seconds.
- **deleted** - Function removed (container restart). Redeploy needed.

Use the search bar to filter by function name or handler class. The runtime dropdown filters by language runtime.
