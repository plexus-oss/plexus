/**
 * Pre-paint script that reads the saved theme from localStorage and sets
 * `data-theme` on <html> before React hydrates. Mirror of
 * marketing/components/theme-script.tsx — same key, same attribute, so a
 * visitor who picks "fun" on the marketing site lands in fun mode here too.
 *
 * Render as a child of <head> in app/layout.tsx (server component).
 *
 * Tier-1 gating: entitlement is enforced where the <ThemeToggle> renders,
 * not here. This script is safe to ship for everyone — if there's no saved
 * preference, it defaults to "serious" inside the product (mirroring the
 * default visual language) but reads any prior preference if set.
 */
const SCRIPT = `
(function () {
  try {
    var t = localStorage.getItem('plexus-theme');
    if (t !== 'serious' && t !== 'fun') t = 'serious';
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'serious');
  }
})();
`.trim();

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
