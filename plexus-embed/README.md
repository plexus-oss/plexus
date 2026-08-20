# plexus-embed

Embed a live, read-only [Plexus](https://plexus.company) panel inside your own
product — your customers see their own device data, in your UI, with no Plexus
login.

```bash
npm install plexus-embed
```

```tsx
import { PlexusPanel } from "plexus-embed";

<PlexusPanel token="emb_…" />;
```

The `token` is a durable, revocable publish token you create once in Plexus
(Dashboard → panel → **Embed this panel**). It encodes the org, dashboard, and
panel, so it's the only required prop. The panel loads only on the domains you've
verified in Plexus.

No React? Use the hosted iframe instead — same token:

```html
<iframe
  src="https://app.plexus.company/embed/emb_…"
  width="100%" height="320" style="border:0"></iframe>
```

## Props

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `token` | `string` | — | Required. Your durable embed token (`emb_…`). |
| `apiBase` | `string` | `https://app.plexus.company` | Override only for staging. |
| `timeRange` | `string` | panel's configured range | Relative (`"24h"`) or ISO range. |
| `colors` | `string[]` | panel default | Series colors. |
| `height` | `number \| string` | `320` | Panel height. |
| `refreshMs` | `number` | live | Poll interval; clamped to ≥5s. |
| `className` | `string` | — | Applied to the wrapper. |

## License

Apache-2.0
