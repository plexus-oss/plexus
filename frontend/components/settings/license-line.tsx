"use client";

import useSWR from "swr";
import { Label } from "@/components/ui/label";
import { fetcher } from "@/lib/fetcher";
import type { LicenseStatus } from "@/lib/licensing";

/**
 * The license's ONE line in settings. Free tier stays quiet — no nags, no
 * banners anywhere else in the product; an expired key gets its renewal link
 * here and nowhere else.
 */
export function LicenseLine() {
  const { data } = useSWR<{ license: LicenseStatus }>("/api/license", fetcher);
  const license = data?.license;
  if (!license) return null;

  return (
    <div>
      <Label className="text-xs text-muted-foreground mb-1.5 block">
        License
      </Label>
      <p className="text-sm">
        {license.message}
        {license.renewalUrl && (
          <>
            {" "}
            <a
              href={license.renewalUrl}
              className="underline underline-offset-2 text-muted-foreground hover:text-foreground"
              target="_blank"
              rel="noreferrer"
            >
              Renew
            </a>
          </>
        )}
      </p>
    </div>
  );
}
