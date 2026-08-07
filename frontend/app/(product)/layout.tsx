import { OrgGuard } from "@/components/org-guard";
import { ProductShell } from "@/components/product-shell";

/**
 * Layout for the product app. OrgGuard ensures the user has an active org
 * (provisioning a fallback if needed); ProductShell renders the navbar/main
 * split.
 */
export default function ProductLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <OrgGuard>
      <ProductShell>{children}</ProductShell>
    </OrgGuard>
  );
}
