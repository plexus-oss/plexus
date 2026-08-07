"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { useWebhook, type TestWebhookResult } from "@/hooks/use-webhooks";
import { Play, CheckCircle, XCircle, Clock } from "lucide-react";

interface WebhookTesterProps {
  webhookId: string;
}

export function WebhookTester({ webhookId }: WebhookTesterProps) {
  const { webhook, testWebhook } = useWebhook(webhookId);
  const [isTesting, setIsTesting] = useState(false);
  const [result, setResult] = useState<TestWebhookResult | null>(null);

  const handleTest = async () => {
    setIsTesting(true);
    setResult(null);
    try {
      const testResult = await testWebhook();
      setResult(testResult);
    } catch {
      // Error already handled by hook
    } finally {
      setIsTesting(false);
    }
  };

  if (!webhook) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Test Webhook</CardTitle>
        <CardDescription>
          Send a test event to verify your webhook endpoint
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={handleTest} disabled={isTesting} className="w-full">
          {isTesting ? (
            <>
              <Spinner className="mr-2 h-4 w-4" />
              Sending test...
            </>
          ) : (
            <>
              <Play className="mr-2 h-4 w-4" />
              Send Test Webhook
            </>
          )}
        </Button>

        {result && (
          <div className="space-y-3">
            {/* Success/Failure Banner */}
            <div
              className={`flex items-center gap-3 p-4 rounded-lg ${
                result.success
                  ? "bg-green-500/10 border border-green-500/20"
                  : "bg-red-500/10 border border-red-500/20"
              }`}
            >
              {result.success ? (
                <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0" />
              ) : (
                <XCircle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0" />
              )}
              <div>
                <div
                  className={`font-medium ${
                    result.success
                      ? "text-green-800 dark:text-green-200"
                      : "text-red-800 dark:text-red-200"
                  }`}
                >
                  {result.success
                    ? "Webhook delivered successfully"
                    : "Webhook delivery failed"}
                </div>
                {result.success &&
                  result.responseStatus &&
                  result.responseTimeMs && (
                    <div className="text-sm text-green-600 dark:text-green-400">
                      Response: {result.responseStatus} OK in{" "}
                      {result.responseTimeMs}ms
                    </div>
                  )}
                {!result.success && result.error && (
                  <div className="text-sm text-red-600 dark:text-red-400">
                    {result.error}
                  </div>
                )}
              </div>
            </div>

            {/* Details */}
            <div className="grid gap-2 text-sm">
              {result.responseStatus && !result.success && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status Code</span>
                  <Badge variant="destructive" className="font-mono">
                    {result.responseStatus}
                  </Badge>
                </div>
              )}

              {result.responseTimeMs && !result.success && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Response Time</span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {result.responseTimeMs}ms
                  </span>
                </div>
              )}

              {result.responseBody && (
                <div className="space-y-1">
                  <span className="text-muted-foreground">Response Body</span>
                  <pre className="rounded bg-muted p-2 text-xs overflow-auto max-h-32">
                    {result.responseBody}
                  </pre>
                </div>
              )}
            </div>

            {/* Next steps on success */}
            {result.success && (
              <p className="text-xs text-muted-foreground">
                Your endpoint is configured correctly. It will receive events
                when they occur.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
