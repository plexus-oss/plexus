"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { CheckCircle2, ShieldAlert, ArrowRight, Info } from "lucide-react";
import { CodeBlock } from "@/components/connect/code-block";
import { useEmbedOrigins } from "@/hooks/use-embed-origins";
import { useEmbedPublish } from "@/hooks/use-embed-publish";

/**
 * "Embed this panel" — the entry point from the panel editor.
 *
 * Gates on domain verification: without a verified embed origin we route the
 * user to Settings → Embedding first (the "route them there" behavior). With
 * one verified, we show the real, working setup: their backend already can mint
 * a token (POST /api/embed/token — live), so we show that call for this exact
 * panel. The drop-in <PlexusPanel> component ships with the next chunk.
 */
export function EmbedPanelDialog({
  panelId,
  open,
  onOpenChange,
}: {
  panelId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const dashboardId = params?.id ?? "";
  // Fetch only while the dialog is open — never in the panel render path.
  const { origins, isLoading, hasVerified } = useEmbedOrigins();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Embed this panel</DialogTitle>
          <DialogDescription>
            Render this panel live inside your own product — your customers see
            it without a Plexus login.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : !hasVerified ? (
          <NeedsDomain
            onGo={() => {
              onOpenChange(false);
              router.push("/settings?tab=embedding");
            }}
          />
        ) : (
          <ReadyToEmbed
            dashboardId={dashboardId}
            panelId={panelId}
            verifiedOrigin={origins.find((o) => o.verified)?.origin ?? ""}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function NeedsDomain({ onGo }: { onGo: () => void }) {
  return (
    <div className="space-y-4 py-2">
      <div className="flex gap-3 rounded-md border bg-muted/40 p-3">
        <ShieldAlert className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
        <p className="text-sm text-muted-foreground">
          First, verify the domain your app runs on. This is what allows the
          panel to load in your product — and only yours.
        </p>
      </div>
      <Button onClick={onGo} className="w-full">
        Set up a domain
        <ArrowRight className="h-4 w-4 ml-2" />
      </Button>
    </div>
  );
}

function ReadyToEmbed({
  dashboardId,
  panelId,
  verifiedOrigin,
}: {
  dashboardId: string;
  panelId: string;
  verifiedOrigin: string;
}) {
  const { publish, isLoading, create, revoke } = useEmbedPublish(
    dashboardId,
    panelId,
  );
  const [publishing, setPublishing] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  // Not published yet — one click creates the durable embed. No backend, no key.
  if (!publish) {
    return (
      <div className="space-y-4 py-2">
        <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4" />
          {verifiedOrigin} is verified
        </div>
        <div className="flex gap-3 rounded-md border bg-muted/40 p-3">
          <Info className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
          <p className="min-w-0 text-sm text-muted-foreground">
            Publish this panel to get a stable embed you paste straight into your
            site — a React component or an iframe. No token minting, no code on
            your servers. Revoke it any time.
          </p>
        </div>
        <Button
          className="w-full"
          loading={publishing}
          onClick={async () => {
            setPublishing(true);
            await create();
            setPublishing(false);
          }}
        >
          Publish embed
        </Button>
      </div>
    );
  }

  const reactSnippet = [
    `import { PlexusPanel } from "plexus-embed";`,
    "",
    `<PlexusPanel token="${publish.token}" />`,
  ].join("\n");
  const iframeSnippet = [
    "<iframe",
    `  src="https://app.plexus.company/embed/${publish.token}"`,
    '  width="100%" height="320" style="border:0">',
    "</iframe>",
  ].join("\n");

  return (
    <div className="space-y-4 py-2">
      <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-4 w-4" />
        Published — paste one of these. {verifiedOrigin} is verified.
      </div>

      <Step n={1} title="React app — install, then drop in the component">
        <div className="space-y-2">
          <CodeBlock code="npm install plexus-embed" language="bash" />
          <CodeBlock code={reactSnippet} language="tsx" />
        </div>
      </Step>

      <Step n={2} title="No React? Paste an iframe — works on any site">
        <CodeBlock code={iframeSnippet} language="html" />
      </Step>

      <div className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
        <Info className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
        <p className="min-w-0 text-xs text-muted-foreground">
          This embed mirrors this panel live — edits to its metrics or chart type
          appear instantly. Deleting the panel stops it; to keep it stable across
          dashboard changes, embed from a dashboard you reserve for embeds.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 border-t pt-3">
        <span className="min-w-0 text-xs text-muted-foreground">
          Read-only, and only loads on your verified domains.
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={() => setConfirmRevoke(true)}
        >
          Revoke embed
        </Button>
      </div>

      <ConfirmActionDialog
        open={confirmRevoke}
        onOpenChange={setConfirmRevoke}
        title="Revoke this embed?"
        description="The token stops working immediately — any site using it stops loading this panel."
        confirmLabel="Revoke"
        onConfirm={async () => {
          setConfirmRevoke(false);
          await revoke(publish.id);
        }}
      />
    </div>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-medium text-primary">
          {n}
        </span>
        <span className="text-sm font-medium">{title}</span>
      </div>
      <div className="pl-7">{children}</div>
    </div>
  );
}

