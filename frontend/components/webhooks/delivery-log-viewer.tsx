"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWebhookLogs } from "@/hooks/use-webhooks";
import {
  CheckCircle,
  XCircle,
  Clock,
  RefreshCw,
  ChevronRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { WebhookDelivery } from "@/lib/db/types";

interface DeliveryLogViewerProps {
  webhookId: string;
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "delivered":
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-red-500" />;
    case "retrying":
      return <RefreshCw className="h-4 w-4 text-yellow-500" />;
    case "pending":
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<
    string,
    "default" | "destructive" | "outline" | "secondary"
  > = {
    delivered: "default",
    failed: "destructive",
    retrying: "secondary",
    pending: "outline",
  };

  return (
    <Badge variant={variants[status] || "outline"} className="capitalize">
      {status}
    </Badge>
  );
}

export function DeliveryLogViewer({ webhookId }: DeliveryLogViewerProps) {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const { deliveries, stats, isLoading, refresh } = useWebhookLogs(webhookId, {
    status: statusFilter || undefined,
    limit: 50,
  });
  const [selectedDelivery, setSelectedDelivery] =
    useState<WebhookDelivery | null>(null);

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Delivery History</CardTitle>
              <CardDescription>
                Recent webhook delivery attempts
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => refresh()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Stats */}
          {stats && (
            <div className="grid grid-cols-4 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold">{stats.total}</p>
                <p className="text-xs text-muted-foreground">Total</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-green-600">
                  {stats.delivered}
                </p>
                <p className="text-xs text-muted-foreground">Delivered</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-red-600">
                  {stats.failed}
                </p>
                <p className="text-xs text-muted-foreground">Failed</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.avgResponseTime}ms</p>
                <p className="text-xs text-muted-foreground">Avg Time</p>
              </div>
            </div>
          )}

          {/* Filter */}
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All statuses</SelectItem>
                <SelectItem value="delivered">Delivered</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="retrying">Retrying</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Log List */}
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Spinner className="h-6 w-6" />
            </div>
          ) : deliveries.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No deliveries found
            </p>
          ) : (
            <div className="space-y-2">
              {deliveries.map((delivery) => (
                <div
                  key={delivery.id}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 cursor-pointer"
                  onClick={() => setSelectedDelivery(delivery)}
                >
                  <div className="flex items-center gap-3">
                    <StatusIcon status={delivery.status} />
                    <div>
                      <p className="text-sm font-medium">
                        {delivery.event_type}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(delivery.created_at), {
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {delivery.response_status && (
                      <Badge variant="outline" className="font-mono">
                        {delivery.response_status}
                      </Badge>
                    )}
                    {delivery.response_time_ms && (
                      <span className="text-xs text-muted-foreground">
                        {delivery.response_time_ms}ms
                      </span>
                    )}
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delivery Detail Dialog */}
      <Dialog
        open={!!selectedDelivery}
        onOpenChange={(open) => !open && setSelectedDelivery(null)}
      >
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <StatusIcon status={selectedDelivery?.status || ""} />
              Delivery Details
            </DialogTitle>
          </DialogHeader>
          {selectedDelivery && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Event Type</p>
                  <p className="font-medium">{selectedDelivery.event_type}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <StatusBadge status={selectedDelivery.status} />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Event ID</p>
                  <code className="text-sm">{selectedDelivery.event_id}</code>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Attempts</p>
                  <p className="font-medium">
                    {selectedDelivery.attempt_count} /{" "}
                    {selectedDelivery.max_attempts}
                  </p>
                </div>
                {selectedDelivery.response_status && (
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Response Status
                    </p>
                    <Badge variant="outline" className="font-mono">
                      {selectedDelivery.response_status}
                    </Badge>
                  </div>
                )}
                {selectedDelivery.response_time_ms && (
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Response Time
                    </p>
                    <p className="font-medium">
                      {selectedDelivery.response_time_ms}ms
                    </p>
                  </div>
                )}
              </div>

              {selectedDelivery.error && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Error</p>
                  <div className="rounded bg-red-500/10 p-2 text-sm text-red-600 dark:text-red-400">
                    {selectedDelivery.error}
                  </div>
                </div>
              )}

              <div>
                <p className="text-sm text-muted-foreground mb-1">Payload</p>
                <pre className="rounded bg-muted p-3 text-xs overflow-auto max-h-48">
                  {JSON.stringify(selectedDelivery.payload, null, 2)}
                </pre>
              </div>

              {selectedDelivery.response_body && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">
                    Response Body
                  </p>
                  <pre className="rounded bg-muted p-3 text-xs overflow-auto max-h-32">
                    {selectedDelivery.response_body}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
