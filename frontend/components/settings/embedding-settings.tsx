"use client";

import { useState } from "react";
import { Section } from "@/components/ui/section-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import {
  Copy,
  Check,
  CheckCircle2,
  Clock,
  Trash2,
  Globe,
} from "lucide-react";
import { toast } from "sonner";
import {
  useEmbedOrigins,
  type EmbedOrigin,
  type VerificationRecord,
} from "@/hooks/use-embed-origins";

export function EmbeddingSettings() {
  const { origins, isLoading, add, verify, remove } = useEmbedOrigins();
  const [newOrigin, setNewOrigin] = useState("");
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    const value = newOrigin.trim();
    if (!value) return;
    setAdding(true);
    const ok = await add(value);
    setAdding(false);
    if (ok) setNewOrigin("");
  };

  return (
    <div className="space-y-6">
      <Section
        title="Embedded panels"
        description="The domains allowed to render your Plexus panels. Add the site your app is served from, then verify you own it."
      >
        <div className="flex gap-2">
          <Input
            value={newOrigin}
            onChange={(e) => setNewOrigin(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !adding) handleAdd();
            }}
            placeholder="https://app.yourdomain.com"
            spellCheck={false}
            autoCapitalize="none"
          />
          <Button onClick={handleAdd} loading={adding} disabled={!newOrigin.trim()}>
            Add domain
          </Button>
        </div>

        <div className="mt-4">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : origins.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <div className="p-2 rounded-md bg-muted text-muted-foreground">
                <Globe className="h-4 w-4" />
              </div>
              <p className="text-sm text-muted-foreground">
                No domains yet. Add the site your embedded panels will live on.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {origins.map((o) => (
                <OriginRow
                  key={o.id}
                  origin={o}
                  onVerify={() => verify(o.id)}
                  onRemove={() => remove(o.id)}
                />
              ))}
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}

function OriginRow({
  origin,
  onVerify,
  onRemove,
}: {
  origin: EmbedOrigin;
  onVerify: () => Promise<boolean>;
  onRemove: () => Promise<boolean>;
}) {
  const [verifying, setVerifying] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-sm truncate">{origin.origin}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {origin.verified ? (
            <Badge variant="outline" className="gap-1.5 text-emerald-600 dark:text-emerald-400 border-emerald-600/30">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Verified
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1.5 text-amber-600 dark:text-amber-400 border-amber-600/30">
              <Clock className="h-3.5 w-3.5" />
              Pending
            </Badge>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Remove domain"
            loading={removing}
            onClick={() => setConfirmRemove(true)}
          >
            {!removing && <Trash2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {!origin.verified && origin.record && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Add this DNS record at your domain, then verify. It can take a few
            minutes to propagate.
          </p>
          <RecordBlock record={origin.record} />
          <Button
            size="sm"
            loading={verifying}
            onClick={async () => {
              setVerifying(true);
              await onVerify();
              setVerifying(false);
            }}
          >
            Verify
          </Button>
        </div>
      )}

      <ConfirmActionDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove this domain?"
        description={`Embedded panels served from ${origin.origin} will stop loading. You can add it back later.`}
        confirmText="Remove"
        onConfirm={async () => {
          setConfirmRemove(false);
          setRemoving(true);
          await onRemove();
          setRemoving(false);
        }}
      />
    </Card>
  );
}

function RecordBlock({ record }: { record: VerificationRecord }) {
  const rows: Array<[string, string]> = [
    ["Type", record.type],
    ["Name", record.name],
    ["Value", record.value],
  ];
  return (
    <div className="rounded-md border bg-muted/50 divide-y divide-border">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center gap-3 px-3 py-2">
          <span className="w-14 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          <code className="flex-1 min-w-0 truncate font-mono text-xs">
            {value}
          </code>
          <CopyButton value={value} />
        </div>
      ))}
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy"
      className="shrink-0 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        toast.success("Copied");
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}
