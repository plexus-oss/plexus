"use client";

import { useState } from "react";
import useSWR from "swr";
import { SectionHeader } from "@/components/ui/section-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Database, Image as ImageIcon, AlertTriangle } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { useSources } from "@/hooks/use-sources";
import { toast } from "sonner";

interface SourceBreakdown {
  source_id: string;
  row_count: number;
  frame_count: number;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function DataManagementSettings() {
  const { sources } = useSources({ type: "device" });
  const {
    data: summary,
    isLoading: loading,
    mutate: refreshSummary,
  } = useSWR<{ breakdown: SourceBreakdown[] }>(
    "/api/data/summary",
    async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch data summary");
      return res.json();
    },
    {
      revalidateOnFocus: false,
      onError: () => toast.error("Failed to load data summary"),
    },
  );
  const breakdown = summary?.breakdown ?? [];

  // Telemetry deletion state
  const [selectedTelemetrySources, setSelectedTelemetrySources] = useState<
    string[]
  >([]);
  const [telemetryStartTime, setTelemetryStartTime] = useState("");
  const [telemetryEndTime, setTelemetryEndTime] = useState("");
  const [deletingTelemetry, setDeletingTelemetry] = useState(false);
  const [showTelemetryConfirm, setShowTelemetryConfirm] = useState(false);

  // Frame deletion state
  const [selectedFrameSources, setSelectedFrameSources] = useState<string[]>(
    [],
  );
  const [frameStartTime, setFrameStartTime] = useState("");
  const [frameEndTime, setFrameEndTime] = useState("");
  const [deletingFrames, setDeletingFrames] = useState(false);
  const [showFrameConfirm, setShowFrameConfirm] = useState(false);

  const sourceMap = new Map(
    (sources ?? []).map((s) => [s.slug, s.name || s.slug]),
  );

  const totalRows = breakdown.reduce((sum, b) => sum + b.row_count, 0);
  const totalFrames = breakdown.reduce((sum, b) => sum + b.frame_count, 0);
  const totalTelemetry = totalRows - totalFrames;

  const toggleSource = (
    sourceId: string,
    selected: string[],
    setSelected: (s: string[]) => void,
  ) => {
    setSelected(
      selected.includes(sourceId)
        ? selected.filter((id) => id !== sourceId)
        : [...selected, sourceId],
    );
  };

  const handleDeleteTelemetry = async () => {
    setDeletingTelemetry(true);
    try {
      const body: Record<string, unknown> = {
        sourceIds: selectedTelemetrySources,
      };
      if (telemetryStartTime)
        body.startTime = new Date(telemetryStartTime).toISOString();
      if (telemetryEndTime)
        body.endTime = new Date(telemetryEndTime).toISOString();

      const res = await fetch("/api/data/delete-telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to delete telemetry");
      toast.success("Telemetry deletion started");
      setSelectedTelemetrySources([]);
      setTelemetryStartTime("");
      setTelemetryEndTime("");
      refreshSummary();
    } catch {
      toast.error("Failed to delete telemetry");
    } finally {
      setDeletingTelemetry(false);
    }
  };

  const handleDeleteFrames = async () => {
    setDeletingFrames(true);
    try {
      const body: Record<string, unknown> = {
        sourceIds: selectedFrameSources,
      };
      if (frameStartTime)
        body.startTime = new Date(frameStartTime).toISOString();
      if (frameEndTime) body.endTime = new Date(frameEndTime).toISOString();

      const res = await fetch("/api/data/delete-frames", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to delete frames");
      const data = await res.json();
      toast.success(
        `Frame deletion started (${formatNumber(data.framesRemoved)} files removed)`,
      );
      setSelectedFrameSources([]);
      setFrameStartTime("");
      setFrameEndTime("");
      refreshSummary();
    } catch {
      toast.error("Failed to delete frames");
    } finally {
      setDeletingFrames(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner />
      </div>
    );
  }

  const sourcesWithData = breakdown.filter((b) => b.row_count > 0);

  return (
    <div className="space-y-8">
      {/* Overview */}
      <div className="space-y-4">
        <SectionHeader>Data Overview</SectionHeader>
        <Card className="p-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Total rows</p>
              <p className="text-lg font-medium">{formatNumber(totalRows)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Telemetry points</p>
              <p className="text-lg font-medium">
                {formatNumber(totalTelemetry)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Video frames</p>
              <p className="text-lg font-medium">{formatNumber(totalFrames)}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Telemetry Deletion */}
      <div className="space-y-4">
        <SectionHeader>Delete Telemetry</SectionHeader>
        <Card className="p-4 space-y-4">
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
            <p>
              Deletes metric data from ClickHouse. Deletion is processed
              asynchronously and may take a few minutes to reflect in counts.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Devices</Label>
            <div className="max-h-40 overflow-auto border rounded-md p-2 space-y-1">
              {sourcesWithData.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2 text-center">
                  No devices with data
                </p>
              ) : (
                sourcesWithData.map((b) => {
                  const telemetryCount = b.row_count - b.frame_count;
                  if (telemetryCount <= 0) return null;
                  return (
                    <label
                      key={b.source_id}
                      className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50 cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedTelemetrySources.includes(b.source_id)}
                        onCheckedChange={() =>
                          toggleSource(
                            b.source_id,
                            selectedTelemetrySources,
                            setSelectedTelemetrySources,
                          )
                        }
                      />
                      <Database className="h-3 w-3 text-muted-foreground" />
                      <span className="text-sm">
                        {sourceMap.get(b.source_id) || b.source_id}
                      </span>
                      <span className="text-xs text-muted-foreground ml-auto">
                        {formatNumber(telemetryCount)} points
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">From (optional)</Label>
              <Input
                type="datetime-local"
                value={telemetryStartTime}
                onChange={(e) => setTelemetryStartTime(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To (optional)</Label>
              <Input
                type="datetime-local"
                value={telemetryEndTime}
                onChange={(e) => setTelemetryEndTime(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          </div>

          <Button
            variant="destructive"
            size="sm"
            disabled={selectedTelemetrySources.length === 0}
            loading={deletingTelemetry}
            onClick={() => setShowTelemetryConfirm(true)}
          >
            Delete telemetry
          </Button>
        </Card>
      </div>

      {/* Frame Deletion */}
      <div className="space-y-4">
        <SectionHeader>Delete Video Frames</SectionHeader>
        <Card className="p-4 space-y-4">
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
            <p>
              Deletes video frame files from storage and their index from
              ClickHouse. This action is irreversible.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Devices</Label>
            <div className="max-h-40 overflow-auto border rounded-md p-2 space-y-1">
              {sourcesWithData.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2 text-center">
                  No devices with data
                </p>
              ) : (
                sourcesWithData.map((b) => {
                  if (b.frame_count <= 0) return null;
                  return (
                    <label
                      key={b.source_id}
                      className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50 cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedFrameSources.includes(b.source_id)}
                        onCheckedChange={() =>
                          toggleSource(
                            b.source_id,
                            selectedFrameSources,
                            setSelectedFrameSources,
                          )
                        }
                      />
                      <ImageIcon className="h-3 w-3 text-muted-foreground" />
                      <span className="text-sm">
                        {sourceMap.get(b.source_id) || b.source_id}
                      </span>
                      <span className="text-xs text-muted-foreground ml-auto">
                        {formatNumber(b.frame_count)} frames
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">From (optional)</Label>
              <Input
                type="datetime-local"
                value={frameStartTime}
                onChange={(e) => setFrameStartTime(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To (optional)</Label>
              <Input
                type="datetime-local"
                value={frameEndTime}
                onChange={(e) => setFrameEndTime(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          </div>

          <Button
            variant="destructive"
            size="sm"
            disabled={selectedFrameSources.length === 0}
            loading={deletingFrames}
            onClick={() => setShowFrameConfirm(true)}
          >
            Delete frames
          </Button>
        </Card>
      </div>

      {/* Confirmation Dialogs */}
      <ConfirmActionDialog
        open={showTelemetryConfirm}
        onOpenChange={setShowTelemetryConfirm}
        title="Delete telemetry data"
        description={`This will permanently delete telemetry data for ${selectedTelemetrySources.length} device(s)${telemetryStartTime || telemetryEndTime ? " within the specified time range" : ""}. This cannot be undone.`}
        confirmLabel="Delete telemetry"
        onConfirm={handleDeleteTelemetry}
      />
      <ConfirmActionDialog
        open={showFrameConfirm}
        onOpenChange={setShowFrameConfirm}
        title="Delete video frames"
        description={`This will permanently delete video frames and their storage files for ${selectedFrameSources.length} device(s)${frameStartTime || frameEndTime ? " within the specified time range" : ""}. This cannot be undone.`}
        confirmLabel="Delete frames"
        onConfirm={handleDeleteFrames}
      />
    </div>
  );
}
