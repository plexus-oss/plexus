"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DialogFooter } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { WebhookEventPicker } from "./webhook-event-picker";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Lightbulb,
  CircleCheck,
} from "lucide-react";
import type {
  CreateWebhookInput,
  UpdateWebhookInput,
  WebhookWithoutSecret,
} from "@/hooks/use-webhooks";
import type { WebhookEventType } from "@/lib/db/types";

// Template type for pre-filling form
interface WebhookTemplate {
  id: string;
  name: string;
  description: string;
  urlPlaceholder: string;
  defaultEvents: WebhookEventType[];
  setupHint: string;
}

// Detailed setup guides for each integration
const SETUP_GUIDES: Record<string, {
  title: string;
  steps: { title: string; description: string }[];
  docsUrl?: string;
  tips?: string[];
}> = {
  slack: {
    title: "Setting up Slack Webhooks",
    steps: [
      {
        title: "Create a Slack app",
        description: "Go to api.slack.com/apps and click 'Create New App' (or use an existing app)",
      },
      {
        title: "Enable Incoming Webhooks",
        description: "In your app settings, find 'Incoming Webhooks' and toggle 'Activate' to On",
      },
      {
        title: "Add to workspace",
        description: "Click 'Add New Webhook to Workspace' and select the channel for alerts",
      },
      {
        title: "Authorize",
        description: "Click 'Allow' to authorize the app to post to your selected channel",
      },
      {
        title: "Copy the webhook URL",
        description: "Copy the URL from 'Webhook URLs for Your Workspace' (starts with hooks.slack.com)",
      },
    ],
    docsUrl: "https://api.slack.com/messaging/webhooks",
    tips: [
      "Create a dedicated #plexus-alerts channel for notifications",
      "Keep your webhook URL confidential - it acts as a credential",
      "You can customize the bot name and icon in your Slack app settings",
    ],
  },
  discord: {
    title: "Setting up Discord Webhooks",
    steps: [
      {
        title: "Open Server Settings",
        description: "Click on your server name at the top left and select 'Server Settings'",
      },
      {
        title: "Go to Integrations",
        description: "Click 'Integrations' in the left sidebar, then click 'Webhooks'",
      },
      {
        title: "Create a new webhook",
        description: "Click the 'New Webhook' button",
      },
      {
        title: "Configure the webhook",
        description: "Name it (e.g., 'Plexus Alerts'), select the target channel, and optionally set an avatar",
      },
      {
        title: "Copy webhook URL",
        description: "Click 'Copy Webhook URL' - settings are saved automatically",
      },
    ],
    docsUrl: "https://support.discord.com/hc/en-us/articles/228383668",
    tips: [
      "Webhooks can only be created from desktop or web, not the mobile app",
      "Guard your webhook URL - anyone with it can post to your server",
      "Create a dedicated #alerts channel with restricted permissions",
    ],
  },
  custom: {
    title: "Setting up a Custom Webhook",
    steps: [
      {
        title: "Create an endpoint",
        description: "Set up an HTTP endpoint that accepts POST requests with JSON body",
      },
      {
        title: "Handle the payload",
        description: "Parse the JSON payload containing event type, timestamp, and event data",
      },
      {
        title: "Verify signatures (recommended)",
        description: "Validate the X-Plexus-Signature header using HMAC-SHA256 with your secret",
      },
      {
        title: "Return 2xx status",
        description: "Respond with a 2xx status code to acknowledge receipt",
      },
    ],
    tips: [
      "Plexus retries failed deliveries 3 times with exponential backoff",
      "Use the 'Test' feature to verify your endpoint before going live",
      "Store your webhook secret securely for signature verification",
    ],
  },
};

// Example payloads for each event type
const EXAMPLE_PAYLOADS: Record<string, object> = {
  "alert.triggered": {
    event: "alert.triggered",
    timestamp: "2024-01-15T10:30:00Z",
    alert: {
      id: "alert_xxx",
      name: "High Temperature",
      severity: "critical",
      value: 95.2,
      threshold: 90,
    },
    device: {
      id: "dev_xxx",
      name: "Sensor A",
    },
  },
  "device.offline": {
    event: "device.offline",
    timestamp: "2024-01-15T10:30:00Z",
    device: {
      id: "dev_xxx",
      name: "Sensor A",
      lastSeen: "2024-01-15T10:25:00Z",
    },
  },
  "threshold.critical": {
    event: "threshold.critical",
    timestamp: "2024-01-15T10:30:00Z",
    metric: {
      name: "temperature",
      value: 95.2,
      threshold: 90,
      unit: "°C",
    },
    device: {
      id: "dev_xxx",
      name: "Sensor A",
    },
  },
};

interface WebhookFormProps {
  initialValues?: WebhookWithoutSecret;
  onSubmit: (data: CreateWebhookInput | UpdateWebhookInput) => Promise<void>;
  onCancel: () => void;
  isEditing?: boolean;
  template?: WebhookTemplate | null;
}

export function WebhookForm({
  initialValues,
  onSubmit,
  onCancel,
  isEditing = false,
  template,
}: WebhookFormProps) {
  const [name, setName] = useState(
    initialValues?.name || (template ? `${template.name} Webhook` : "")
  );
  const [description, setDescription] = useState(
    initialValues?.description || ""
  );
  const [url, setUrl] = useState(initialValues?.url || "");
  const [events, setEvents] = useState<WebhookEventType[]>(
    (initialValues?.events as WebhookEventType[]) || template?.defaultEvents || []
  );

  // Get example payload for selected events
  const examplePayload = events.length > 0
    ? EXAMPLE_PAYLOADS[events[0]] || EXAMPLE_PAYLOADS["alert.triggered"]
    : null;
  const [customHeaders, setCustomHeaders] = useState(
    initialValues?.custom_headers
      ? JSON.stringify(initialValues.custom_headers, null, 2)
      : ""
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [urlError, setUrlError] = useState("");
  const [showSetupGuide, setShowSetupGuide] = useState(!!template);

  // Get setup guide for current template
  const setupGuide = template?.id ? SETUP_GUIDES[template.id] : null;

  const validateUrl = (value: string): boolean => {
    if (!value) {
      setUrlError("URL is required");
      return false;
    }
    try {
      const parsed = new URL(value);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        setUrlError("URL must use HTTP or HTTPS");
        return false;
      }
      setUrlError("");
      return true;
    } catch {
      setUrlError("Invalid URL format");
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateUrl(url)) return;
    if (events.length === 0) return;

    setIsSubmitting(true);
    try {
      let parsedHeaders: Record<string, string> | undefined;
      if (customHeaders.trim()) {
        try {
          parsedHeaders = JSON.parse(customHeaders);
        } catch {
          // Invalid JSON - ignore
        }
      }

      const data: CreateWebhookInput | UpdateWebhookInput = {
        name,
        description: description || undefined,
        url,
        events,
        customHeaders: parsedHeaders,
      };

      await onSubmit(data);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Name *</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Slack Alerts"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description..."
          rows={2}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="url">Endpoint URL *</Label>
        <Input
          id="url"
          type="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (urlError) validateUrl(e.target.value);
          }}
          onBlur={(e) => validateUrl(e.target.value)}
          placeholder={template?.urlPlaceholder || "https://example.com/webhooks/plexus"}
          required
          className={urlError ? "border-red-500" : ""}
        />
        {urlError && (
          <p className="text-sm text-red-500">{urlError}</p>
        )}
        {template?.setupHint && !setupGuide && (
          <p className="text-xs text-muted-foreground">
            {template.setupHint}
          </p>
        )}
      </div>

      {/* Setup Guide */}
      {setupGuide && (
        <Collapsible open={showSetupGuide} onOpenChange={setShowSetupGuide}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 w-full p-3 rounded-lg border bg-muted/50 hover:bg-muted transition-colors text-left"
            >
              {showSetupGuide ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="font-medium text-sm">{setupGuide.title}</span>
              {setupGuide.docsUrl && (
                <a
                  href={setupGuide.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  Docs <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 p-4 rounded-lg border bg-card space-y-4">
              {/* Steps */}
              <ol className="space-y-3">
                {setupGuide.steps.map((step, index) => (
                  <li key={index} className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-medium flex items-center justify-center">
                      {index + 1}
                    </span>
                    <div className="pt-0.5">
                      <div className="font-medium text-sm">{step.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {step.description}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>

              {/* Tips */}
              {setupGuide.tips && setupGuide.tips.length > 0 && (
                <div className="pt-3 border-t">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
                    <Lightbulb className="h-3 w-3" />
                    Tips
                  </div>
                  <ul className="space-y-1">
                    {setupGuide.tips.map((tip, index) => (
                      <li
                        key={index}
                        className="text-xs text-muted-foreground flex items-start gap-2"
                      >
                        <CircleCheck className="h-3 w-3 mt-0.5 flex-shrink-0 text-green-500" />
                        {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      <div className="space-y-2">
        <Label>Events *</Label>
        <div className="border rounded-lg p-4 max-h-64 overflow-y-auto">
          <WebhookEventPicker value={events} onChange={setEvents} />
        </div>
        {events.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Select at least one event type
          </p>
        )}
      </div>

      {/* Payload Preview */}
      {examplePayload && (
        <div className="space-y-2">
          <Label>Example Payload</Label>
          <div className="bg-muted rounded-lg p-3 font-mono text-xs overflow-auto max-h-48">
            <pre>{JSON.stringify(examplePayload, null, 2)}</pre>
          </div>
          <p className="text-xs text-muted-foreground">
            This is an example of what your endpoint will receive
          </p>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="headers">Custom Headers (JSON)</Label>
        <Textarea
          id="headers"
          value={customHeaders}
          onChange={(e) => setCustomHeaders(e.target.value)}
          placeholder='{"Authorization": "Bearer token"}'
          rows={3}
          className="font-mono text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Additional headers to include with webhook requests
        </p>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!name.trim() || !url || events.length === 0 || isSubmitting}
        >
          {isSubmitting ? (
            <>
              <Spinner className="mr-2 h-4 w-4" />
              {isEditing ? "Saving..." : "Creating..."}
            </>
          ) : isEditing ? (
            "Save Changes"
          ) : (
            "Create Webhook"
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}
