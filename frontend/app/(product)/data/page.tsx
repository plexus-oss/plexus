"use client";

import { useState, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Search, Server, Cable, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSources } from "@/hooks/use-sources";
import { useConnectionSchema } from "@/hooks/use-connection-schema";
import { UnifiedDataTab } from "@/components/source/unified-data-tab";
import { PageWrapper } from "@/components/ui/page-wrapper";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function DataPageContent() {
  const searchParams = useSearchParams();
  const sourceFromUrl = searchParams.get("source");
  const { devices, connections, isLoading } = useSources();
  const [search, setSearch] = useState("");
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(
    sourceFromUrl || null,
  );

  // Follow the URL ?source= param when it changes (overrides manual selection).
  const [prevSourceFromUrl, setPrevSourceFromUrl] = useState(sourceFromUrl);
  if (sourceFromUrl !== prevSourceFromUrl) {
    setPrevSourceFromUrl(sourceFromUrl);
    if (sourceFromUrl) setSelectedSourceId(sourceFromUrl);
  }

  // Default to the first device once sources load and nothing is selected.
  const effectiveSourceId =
    selectedSourceId ?? (devices.length > 0 ? devices[0].id : null);

  const selectedSource = useMemo(() => {
    if (!effectiveSourceId) return null;
    return (
      [...devices, ...connections].find((s) => s.id === effectiveSourceId) ??
      null
    );
  }, [effectiveSourceId, devices, connections]);

  const { tables: schemaTables, isLoading: schemaLoading } =
    useConnectionSchema(
      selectedSource?.source_type === "connection" ? selectedSource.id : null,
    );

  const filteredDevices = useMemo(() => {
    if (!search) return devices;
    const q = search.toLowerCase();
    return devices.filter(
      (s) =>
        s.name?.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q),
    );
  }, [devices, search]);

  const filteredConnections = useMemo(() => {
    if (!search) return connections;
    const q = search.toLowerCase();
    return connections.filter(
      (s) =>
        s.name?.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q),
    );
  }, [connections, search]);

  return (
    <PageWrapper title="Data" description="Explore all your data sources">
      <div className="flex h-full">
        <div className="w-60 border-r border-border flex flex-col bg-muted/30">
          <div className="p-3 border-b border-border space-y-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search sources..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-8 text-xs"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-3">
            {filteredDevices.length > 0 && (
              <div>
                <div className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground mb-1 px-2">
                  Devices ({filteredDevices.length})
                </div>
                <div className="space-y-0.5">
                  {filteredDevices.map((source) => {
                    const isOnline = source.status === "online";
                    return (
                      <Button
                        key={source.id}
                        variant="ghost"
                        onClick={() => setSelectedSourceId(source.id)}
                        className={cn(
                          "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left h-auto justify-start",
                          effectiveSourceId === source.id
                            ? "bg-primary/10 text-primary"
                            : "hover:bg-muted text-foreground",
                        )}
                      >
                        <Server className="h-3.5 w-3.5 flex-shrink-0" />
                        <span className="text-sm truncate flex-1">
                          {source.name || source.slug}
                        </span>
                        <div
                          className={cn(
                            "h-2 w-2",
                            isOnline
                              ? "fill-green-500 text-green-500"
                              : "fill-gray-300 text-gray-300 dark:fill-gray-600 dark:text-gray-600",
                          )}
                        />
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}
            {filteredConnections.length > 0 && (
              <div>
                <div className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground mb-1 px-2">
                  Connections ({filteredConnections.length})
                </div>
                <div className="space-y-0.5">
                  {filteredConnections.map((source) => (
                    <Button
                      key={source.id}
                      variant="ghost"
                      onClick={() => setSelectedSourceId(source.id)}
                      className={cn(
                        "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left h-auto justify-start",
                        effectiveSourceId === source.id
                          ? "bg-primary/10 text-primary"
                          : "hover:bg-muted text-foreground",
                      )}
                    >
                      <Cable className="h-3.5 w-3.5 flex-shrink-0" />
                      <span className="text-sm truncate flex-1">
                        {source.name || source.slug}
                      </span>
                      <div
                        className={cn(
                          "h-2 w-2 rounded-full",
                          source.status === "online"
                            ? "fill-green-500 text-green-500"
                            : " text-gray-300 dark:text-gray-600",
                        )}
                      />
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {!isLoading &&
              filteredDevices.length === 0 &&
              filteredConnections.length === 0 && (
                <div className="text-center py-8">
                  <p className="text-xs text-muted-foreground">
                    No sources match your search
                  </p>
                </div>
              )}
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          {selectedSource ? (
            <div className="flex-1 min-w-0 min-h-0">
              <UnifiedDataTab
                key={selectedSource.id}
                source={selectedSource}
                schema={schemaLoading ? undefined : schemaTables}
                onSchemaRefresh={undefined}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <Database className="h-8 w-8 mx-auto text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground">
                  Select a source to explore data
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </PageWrapper>
  );
}

export default function DataPage() {
  return (
    <Suspense
      fallback={
        <PageWrapper title="Data" description="Explore all your data sources">
          <div className="flex items-center justify-center h-64">
            <div className="text-sm text-muted-foreground">Loading...</div>
          </div>
        </PageWrapper>
      }
    >
      <DataPageContent />
    </Suspense>
  );
}
