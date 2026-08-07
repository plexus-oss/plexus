"use client";

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Check,
  CheckCircle,
  AlertCircle,
  ChevronDown,
  ChevronLeft,
  Lock,
  Table2,
  ExternalLink,
  Info,
  Cpu,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useSources, type SchemaInfo } from "@/hooks/use-sources";
import type { ConnectionType } from "@/lib/db/types";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  ResourcePalette,
  Kbd,
  type PaletteOption,
  type PaletteSection,
} from "@/components/data/resource-palette";
import {
  PostgresLogo,
  MySQLLogo,
  ClickHouseLogo,
  InfluxDBLogo,
  TimescaleDBLogo,
  PrometheusLogo,
} from "@/components/data/connection-logos";
import { Spinner } from "@/components/ui/spinner";
import { IdentityMapping } from "@/components/connections/identity-mapping";

// Setup guide types
interface SetupStep {
  step: string;
  detail: string;
  link?: { label: string; url: string };
}

interface ProviderLink {
  name: string;
  url: string;
}

interface SetupGuide {
  steps: SetupStep[];
  providers: ProviderLink[];
  format: string;
  tips?: string[];
}

// Connection type info for the UI
interface ConnectionTypeInfo {
  type: ConnectionType;
  label: string;
  category: "timeseries" | "table";
  placeholder: string;
  docUrl: string;
  logo: React.ReactNode;
  setupGuide: SetupGuide;
}

const CONNECTION_TYPES: ConnectionTypeInfo[] = [
  {
    type: "prometheus",
    label: "Prometheus / Thanos",
    category: "timeseries",
    placeholder: "https://thanos.example.com?token=YOUR_TOKEN",
    docUrl: "https://prometheus.io/docs/prometheus/latest/querying/api/",
    logo: <PrometheusLogo />,
    setupGuide: {
      steps: [
        {
          step: "1. Get your query endpoint",
          detail:
            "Use your Prometheus server URL, or your Thanos Query endpoint — both speak the same /api/v1 query API. Plexus reads only; nothing is written or moved.",
        },
        {
          step: "2. Add auth if your endpoint needs it",
          detail:
            "Append a bearer token as ?token=… , or put basic-auth creds in the URL (https://user:pass@host). Leave it off for open endpoints.",
        },
        {
          step: "3. Make sure Plexus can reach it",
          detail:
            "If it sits behind a VPN or private network, allow Plexus's egress (or run the connector inside your network). Connection errors will tell you if it's unreachable.",
        },
      ],
      providers: [
        {
          name: "Prometheus HTTP API",
          url: "https://prometheus.io/docs/prometheus/latest/querying/api/",
        },
        {
          name: "Thanos Query",
          url: "https://thanos.io/tip/components/query.md/",
        },
      ],
      format: "https://thanos.example.com?token=YOUR_TOKEN",
      tips: [
        "One connector covers both Prometheus and Thanos — Thanos Query is API-compatible.",
        "Use a read-only token — Plexus only needs query access.",
        "Plexus runs on your existing data. Nothing is migrated or stored elsewhere.",
      ],
    },
  },
  {
    type: "clickhouse",
    label: "ClickHouse",
    category: "timeseries",
    placeholder: "clickhouse://user:pass@host:8443/db",
    docUrl:
      "https://clickhouse.com/docs/en/integrations/sql-clients/cli#connection_string",
    logo: <ClickHouseLogo />,
    setupGuide: {
      steps: [
        {
          step: "1. Get your cloud console credentials",
          detail:
            "In ClickHouse Cloud, go to your service and find the connection details. You'll need the host, port, and credentials.",
          link: {
            label: "ClickHouse Cloud Console",
            url: "https://clickhouse.cloud/",
          },
        },
        {
          step: "2. Use the native protocol URL",
          detail:
            "Construct the URL using clickhouse:// protocol with port 8443 (HTTPS) for cloud, or 8123/9000 for self-hosted.",
        },
        {
          step: "3. Set the target database",
          detail:
            "Specify the database name in the URL path. The default database is 'default'.",
        },
      ],
      providers: [
        {
          name: "ClickHouse Cloud",
          url: "https://clickhouse.com/docs/en/cloud/manage/connections",
        },
        {
          name: "Aiven",
          url: "https://aiven.io/docs/products/clickhouse/howto/connect-with-clickhouse-cli",
        },
        {
          name: "DoubleCloud",
          url: "https://double.cloud/docs/en/managed-clickhouse/connect",
        },
      ],
      format: "clickhouse://user:password@host:8443/database",
      tips: [
        "ClickHouse Cloud uses port 8443 for secure native connections.",
        "For self-hosted ClickHouse, make sure the HTTP interface is enabled (port 8123 or 8443 with TLS).",
      ],
    },
  },
  {
    type: "influxdb",
    label: "InfluxDB",
    category: "timeseries",
    placeholder: "http://localhost:8086?token=xxx&org=xxx&bucket=xxx",
    docUrl: "https://docs.influxdata.com/influxdb/v2/get-started/setup/",
    logo: <InfluxDBLogo />,
    setupGuide: {
      steps: [
        {
          step: "1. Create an API token",
          detail:
            "In the InfluxDB UI, go to Load Data → API Tokens and create a read-only token scoped to the bucket you want to connect.",
          link: {
            label: "InfluxDB Token Docs",
            url: "https://docs.influxdata.com/influxdb/v2/admin/tokens/create-token/",
          },
        },
        {
          step: "2. Get your organization ID",
          detail:
            "Find your org ID in the InfluxDB UI under Settings → Organization, or from your profile.",
        },
        {
          step: "3. Get your bucket name",
          detail:
            "Go to Load Data → Buckets to find the exact bucket name you want to query.",
        },
        {
          step: "4. Construct the connection URL",
          detail:
            "Combine the host URL with token, org, and bucket as query parameters.",
        },
      ],
      providers: [
        {
          name: "InfluxDB Cloud",
          url: "https://docs.influxdata.com/influxdb/cloud/get-started/",
        },
        {
          name: "Self-hosted",
          url: "https://docs.influxdata.com/influxdb/v2/get-started/setup/",
        },
      ],
      format:
        "https://your-instance.influxdata.com?token=YOUR_TOKEN&org=YOUR_ORG&bucket=YOUR_BUCKET",
      tips: [
        "Use a read-only token for security — Plexus only needs read access.",
        "InfluxDB Cloud URLs look like https://us-east-1-1.aws.cloud2.influxdata.com.",
        "For self-hosted, make sure port 8086 is accessible from Plexus.",
        "Using InfluxDB v3? Add &v=3 to your connection URL to enable SQL-based schema browsing (e.g. ...&bucket=my-db&v=3).",
      ],
    },
  },
  {
    type: "timescaledb",
    label: "TimescaleDB",
    category: "timeseries",
    placeholder: "postgresql://user:pass@host:5432/db",
    docUrl:
      "https://docs.timescale.com/use-timescale/latest/connecting/about-connecting/",
    logo: <TimescaleDBLogo />,
    setupGuide: {
      steps: [
        {
          step: "1. Find your connection string",
          detail:
            "In Timescale Cloud, go to your service dashboard and copy the 'Service URL' from the connection info section.",
          link: {
            label: "Timescale Cloud Dashboard",
            url: "https://console.cloud.timescale.com/",
          },
        },
        {
          step: "2. Copy the PostgreSQL URI",
          detail:
            "TimescaleDB uses the standard PostgreSQL connection protocol. The URI starts with postgresql://.",
        },
        {
          step: "3. Ensure SSL is enabled",
          detail:
            "Timescale Cloud requires SSL. Append ?sslmode=require if not included.",
        },
        {
          step: "4. Allow Plexus IP access",
          detail:
            "In your Timescale Cloud service settings, add Plexus IPs to the allowed list under 'Allowed IP Addresses'.",
        },
      ],
      providers: [
        {
          name: "Timescale Cloud",
          url: "https://docs.timescale.com/use-timescale/latest/connecting/",
        },
        {
          name: "Self-hosted",
          url: "https://docs.timescale.com/self-hosted/latest/install/",
        },
      ],
      format: "postgresql://user:password@host:port/database?sslmode=require",
      tips: [
        "TimescaleDB uses the same connection format as PostgreSQL — any Postgres client works.",
        "Timescale Cloud enforces SSL — make sure sslmode=require is set.",
      ],
    },
  },
  {
    type: "postgres",
    label: "PostgreSQL",
    category: "table",
    placeholder: "postgresql://user:pass@host:5432/db",
    docUrl:
      "https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNSTRING",
    logo: <PostgresLogo />,
    setupGuide: {
      steps: [
        {
          step: "1. Find your connection string",
          detail:
            "Open your database provider's dashboard and navigate to the connection settings or database settings page.",
        },
        {
          step: "2. Copy the URI / connection string",
          detail:
            "Look for the 'URI' or 'Connection string' format — it starts with postgresql://.",
        },
        {
          step: "3. Ensure SSL is enabled",
          detail:
            "Most cloud providers require SSL. Append ?sslmode=require to your connection string if not already included.",
        },
        {
          step: "4. Allow Plexus IP access",
          detail:
            "If your provider has IP allowlisting, add Plexus's IP addresses to the allowed list. Check your provider's network/firewall settings.",
        },
      ],
      providers: [
        {
          name: "Supabase",
          url: "https://supabase.com/docs/guides/database/connecting-to-postgres",
        },
        {
          name: "Neon",
          url: "https://neon.tech/docs/connect/connect-from-any-app",
        },
        {
          name: "Railway",
          url: "https://docs.railway.app/databases/postgresql",
        },
        { name: "Render", url: "https://docs.render.com/databases" },
        {
          name: "AWS RDS",
          url: "https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ConnectToPostgreSQLInstance.html",
        },
        {
          name: "DigitalOcean",
          url: "https://docs.digitalocean.com/products/databases/postgresql/how-to/connect/",
        },
      ],
      format: "postgresql://user:password@host:5432/database?sslmode=require",
      tips: [
        "Use the 'pooler' or 'connection pooling' URL if your provider offers one — it handles connection limits better.",
        "If you see 'no pg_hba.conf entry' errors, check that SSL mode is set and your IP is allowlisted.",
        "Supabase users: use the 'URI' from Project Settings → Database, not the API URL.",
      ],
    },
  },
  {
    type: "mysql",
    label: "MySQL",
    category: "table",
    placeholder: "mysql://user:pass@host:3306/db",
    docUrl: "https://dev.mysql.com/doc/refman/8.0/en/connecting.html",
    logo: <MySQLLogo />,
    setupGuide: {
      steps: [
        {
          step: "1. Find your connection string",
          detail:
            "Open your database provider's dashboard and locate the connection details or credentials section.",
        },
        {
          step: "2. Copy the URI format",
          detail:
            "Construct or copy the mysql:// URI. You'll need the host, port (usually 3306), username, password, and database name.",
        },
        {
          step: "3. Allow external connections",
          detail:
            "Ensure your database accepts external connections. You may need to enable 'public access' or add Plexus IPs to the allowlist.",
        },
      ],
      providers: [
        {
          name: "PlanetScale",
          url: "https://planetscale.com/docs/concepts/connection-strings",
        },
        {
          name: "AWS RDS",
          url: "https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ConnectToInstance.html",
        },
        {
          name: "DigitalOcean",
          url: "https://docs.digitalocean.com/products/databases/mysql/how-to/connect/",
        },
        { name: "Railway", url: "https://docs.railway.app/databases/mysql" },
      ],
      format: "mysql://user:password@host:3306/database",
      tips: [
        "PlanetScale requires SSL — connections will fail without it.",
        "If using AWS RDS, ensure the security group allows inbound traffic on port 3306.",
      ],
    },
  },
];

function getAllConnectionTypes(): ConnectionTypeInfo[] {
  return CONNECTION_TYPES;
}

const PEM_KEY_REGEX =
  /-----BEGIN (?:OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----[\s\S]+-----END (?:OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----/;

function isLikelyPemKey(value: string): boolean {
  return PEM_KEY_REGEX.test(value.trim());
}

function getConnectionTypeInfo(
  type: ConnectionType,
): ConnectionTypeInfo | undefined {
  return CONNECTION_TYPES.find((t) => t.type === type);
}

interface AddSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialType?: ConnectionType;
}

type Step = "select-type" | "configure" | "select-tables" | "link-device";

export function AddSourceDialog({
  open,
  onOpenChange,
  initialType,
}: AddSourceDialogProps) {
  const router = useRouter();
  const { createSource, testConnection, getSchema, updateSource } = useSources({
    type: "connection",
  });
  const { devices } = useSources({ type: "device" });
  const [step, setStep] = useState<Step>(
    initialType ? "configure" : "select-type",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedType, setSelectedType] = useState<ConnectionType | null>(
    initialType ?? null,
  );
  const [name, setName] = useState("");
  const [connectionString, setConnectionString] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    error?: string;
  } | null>(null);

  // Table selection state
  const [createdSourceId, setCreatedSourceId] = useState<string | null>(null);
  const [schema, setSchema] = useState<SchemaInfo | null>(null);
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  // SSH tunnel fields
  const [sshEnabled, setSSHEnabled] = useState(false);
  const [sshHost, setSSHHost] = useState("");
  const [sshPort, setSSHPort] = useState("22");
  const [sshUsername, setSSHUsername] = useState("");
  const [sshAuthMethod, setSSHAuthMethod] = useState<
    "private_key" | "password"
  >("private_key");
  const [sshPrivateKey, setSSHPrivateKey] = useState("");
  const [sshPassword, setSSHPassword] = useState("");

  const allTypes = getAllConnectionTypes();

  const selectedTypeInfo = selectedType
    ? getConnectionTypeInfo(selectedType)
    : null;

  const handleSelectType = (type: ConnectionType) => {
    setSelectedType(type);
    setStep("configure");
    setName("");
    setConnectionString("");
    setTestResult(null);
    setGuideOpen(false);
    setSSHEnabled(false);
    setSSHHost("");
    setSSHPort("22");
    setSSHUsername("");
    setSSHAuthMethod("private_key");
    setSSHPrivateKey("");
    setSSHPassword("");
  };

  const handleBack = () => {
    setStep("select-type");
    setSearchQuery("");
    setSelectedType(null);
    setTestResult(null);
  };

  const handleClose = () => {
    onOpenChange(false);
    // Reset state after close animation
    setTimeout(() => {
      setStep("select-type");
      setSearchQuery("");
      setSelectedType(null);
      setName("");
      setConnectionString("");
      setTestResult(null);
      setIsLoading(false);
      setCreatedSourceId(null);
      setSchema(null);
      setSelectedTables(new Set());
      setSchemaLoading(false);
      setSchemaError(null);
      setSSHEnabled(false);
      setSSHHost("");
      setSSHPort("22");
      setSSHUsername("");
      setSSHAuthMethod("private_key");
      setSSHPrivateKey("");
      setSSHPassword("");
    }, 200);
  };

  const canSubmit = !!(name && connectionString);

  const handleAdd = async () => {
    if (!selectedType || !canSubmit) return;

    setIsLoading(true);
    try {
      // Generate a slug from the name
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

      const source = await createSource({
        source_type: "connection",
        slug,
        name,
        connection_type: selectedType,
        connectionString,
        ...(sshEnabled && {
          sshTunnel: {
            enabled: true,
            host: sshHost,
            port: parseInt(sshPort) || 22,
            username: sshUsername,
            authMethod: sshAuthMethod,
          },
          sshCredential:
            sshAuthMethod === "private_key" ? sshPrivateKey : sshPassword,
        }),
      });

      // Auto-test connection after adding
      const testResult = await testConnection(source.id);

      if (testResult.success) {
        // Connection successful - proceed to table selection
        setCreatedSourceId(source.id);
        setStep("select-tables");
        // Fetch schema
        setSchemaLoading(true);
        try {
          const schemaResult = await getSchema(source.id);
          setSchema(schemaResult);
          // Select all tables by default
          const allTableNames = schemaResult.tables.map((t) =>
            t.schema ? `${t.schema}.${t.name}` : t.name,
          );
          setSelectedTables(new Set(allTableNames));
        } catch (err) {
          setSchemaError(
            err instanceof Error ? err.message : "Failed to fetch schema",
          );
        } finally {
          setSchemaLoading(false);
        }
      } else {
        // Connection failed - stay on configure step
        setTestResult({ success: false, error: testResult.error });
      }
    } catch (error) {
      console.error("Failed to add source:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveTableSelection = async () => {
    if (!createdSourceId) return;

    setIsLoading(true);
    try {
      await updateSource(createdSourceId, {
        config: {
          selectedTables: Array.from(selectedTables),
        },
      });
      setStep("link-device");
    } catch (error) {
      console.error("Failed to save table selection:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleTable = (tableName: string) => {
    setSelectedTables((prev) => {
      const next = new Set(prev);
      if (next.has(tableName)) {
        next.delete(tableName);
      } else {
        next.add(tableName);
      }
      return next;
    });
  };

  const toggleAllTables = () => {
    if (!schema) return;
    const allTableNames = schema.tables.map((t) =>
      t.schema ? `${t.schema}.${t.name}` : t.name,
    );
    if (selectedTables.size === allTableNames.length) {
      // Deselect all
      setSelectedTables(new Set());
    } else {
      // Select all
      setSelectedTables(new Set(allTableNames));
    }
  };

  const categoryLabel = (c: ConnectionTypeInfo["category"]) =>
    c === "timeseries" ? "Time-series" : "Relational";

  const paletteOptions: PaletteOption[] = useMemo(
    () =>
      allTypes.map((t) => ({
        id: t.type,
        sectionId: t.category,
        icon: t.logo,
        title: t.label,
        subtitle: `${categoryLabel(t.category)} database`,
        onSelect: () => handleSelectType(t.type),
        keywords: [t.type, t.category],
      })),

    [allTypes],
  );

  const paletteSections: PaletteSection[] = [
    { id: "timeseries", label: "Time-series" },
    { id: "table", label: "Relational" },
  ];

  const renderPalette = () => (
    <ResourcePalette
      query={searchQuery}
      setQuery={setSearchQuery}
      options={paletteOptions}
      sections={paletteSections}
      placeholder="What are you connecting? postgres, clickhouse, influxdb..."
      className="max-h-[90vh]"
      footerLeft={
        <>
          <span className="flex items-center gap-1.5">
            <Kbd>↵</Kbd> select
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>esc</Kbd> close
          </span>
        </>
      }
      footerRight={
        <div className="flex items-center gap-2 font-mono text-[10.5px]">
          <Lock className="h-3 w-3" />
          <span>read-only · AES-256 at rest</span>
        </div>
      }
    />
  );

  const renderConfigForm = () => {
    if (!selectedTypeInfo) return null;

    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            placeholder="Production Database"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name && connectionString && !isLoading) {
                e.preventDefault();
                handleAdd();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                handleClose();
              }
            }}
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            A friendly name to identify this data source
          </p>
        </div>

        {/* Connection string input */}
        <div className="space-y-2">
          <Label htmlFor="connection">Connection String</Label>
          <Input
            id="connection"
            placeholder={selectedTypeInfo.placeholder}
            value={connectionString}
            onChange={(e) => {
              setConnectionString(e.target.value);
              setTestResult(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit && !isLoading) {
                e.preventDefault();
                handleAdd();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                handleClose();
              }
            }}
            className="font-mono text-sm"
          />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="h-3 w-3" />
              <span>Encrypted at rest with AES-256</span>
            </div>
            <a
              href={selectedTypeInfo.docUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <span>How to get connection string</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>

        {/* SSH Tunnel — only for TCP-based databases */}
        {(selectedType === "postgres" ||
          selectedType === "timescaledb" ||
          selectedType === "mysql") && (
          <div className="rounded-lg border">
            <Button
              variant="ghost"
              type="button"
              onClick={() => setSSHEnabled(!sshEnabled)}
              className="flex items-center justify-between w-full p-3 text-sm font-medium hover:bg-accent/50 rounded-lg h-auto"
            >
              <span className="flex items-center gap-2 text-muted-foreground">
                <Lock className="h-4 w-4" />
                SSH Tunnel (bastion host)
              </span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform",
                  sshEnabled && "rotate-180",
                )}
              />
            </Button>
            {sshEnabled && (
              <div className="px-3 pb-3 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Plexus opens an SSH tunnel to the bastion, then connects to
                  the database host from there. If the database is bound to{" "}
                  <code className="font-mono text-[11px]">localhost</code> on
                  the same server you SSH into, use that server&apos;s DNS below
                  and{" "}
                  <code className="font-mono text-[11px]">localhost:5432</code>{" "}
                  in the connection string above.
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2 space-y-1.5">
                    <Label htmlFor="ssh-host" className="text-xs">
                      Bastion Host
                    </Label>
                    <Input
                      id="ssh-host"
                      placeholder="bastion.example.com"
                      value={sshHost}
                      onChange={(e) => setSSHHost(e.target.value)}
                      className="text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ssh-port" className="text-xs">
                      SSH Port
                    </Label>
                    <Input
                      id="ssh-port"
                      placeholder="22"
                      value={sshPort}
                      onChange={(e) => setSSHPort(e.target.value)}
                      className="text-sm"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ssh-username" className="text-xs">
                    SSH Username
                  </Label>
                  <Input
                    id="ssh-username"
                    placeholder="plexus-tunnel"
                    value={sshUsername}
                    onChange={(e) => setSSHUsername(e.target.value)}
                    className="text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Auth Method</Label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant={
                        sshAuthMethod === "private_key" ? "default" : "outline"
                      }
                      size="sm"
                      onClick={() => setSSHAuthMethod("private_key")}
                    >
                      Private Key
                    </Button>
                    <Button
                      type="button"
                      variant={
                        sshAuthMethod === "password" ? "default" : "outline"
                      }
                      size="sm"
                      onClick={() => setSSHAuthMethod("password")}
                    >
                      Password
                    </Button>
                  </div>
                </div>
                {sshAuthMethod === "private_key" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="ssh-key" className="text-xs">
                      Private Key (PEM)
                    </Label>
                    <Textarea
                      id="ssh-key"
                      placeholder={
                        "-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----"
                      }
                      value={sshPrivateKey}
                      onChange={(e) => setSSHPrivateKey(e.target.value)}
                      className="font-mono text-xs h-24 resize-none"
                    />
                    {sshPrivateKey.trim() && !isLikelyPemKey(sshPrivateKey) && (
                      <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                        <AlertCircle className="h-3 w-3" />
                        This doesn&apos;t look like a PEM key — expecting{" "}
                        <code className="font-mono text-[11px]">
                          -----BEGIN … PRIVATE KEY-----
                        </code>{" "}
                        header and footer.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="ssh-pass" className="text-xs">
                      SSH Password
                    </Label>
                    <Input
                      id="ssh-pass"
                      type="password"
                      value={sshPassword}
                      onChange={(e) => setSSHPassword(e.target.value)}
                      className="text-sm"
                    />
                  </div>
                )}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Lock className="h-3 w-3" />
                  <span>
                    SSH credentials are encrypted at rest with AES-256
                  </span>
                </div>
                <div className="rounded-md bg-blue-500/10 p-2.5 space-y-1.5">
                  <p className="text-xs font-medium text-blue-600 dark:text-blue-400">
                    Recommended: restricted SSH user
                  </p>
                  <p className="text-xs text-blue-600/90 dark:text-blue-400/90 leading-relaxed">
                    Create a dedicated user on the bastion whose key is scoped
                    to port-forwarding only — not an admin account. If the key
                    leaks, it can&apos;t open a shell.
                  </p>
                  <code className="block text-[11px] font-mono bg-blue-500/10 px-2 py-1.5 rounded text-blue-700 dark:text-blue-300 break-all">
                    {`command="echo forward-only",no-pty,no-X11-forwarding,no-agent-forwarding,permitopen="localhost:5432" ssh-rsa AAAA...`}
                  </code>
                  <p className="text-xs text-blue-600/80 dark:text-blue-400/80 leading-relaxed">
                    Paste this prefix in front of the public key in{" "}
                    <code className="font-mono text-[11px]">
                      ~/.ssh/authorized_keys
                    </code>{" "}
                    on the bastion.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Setup Guide */}
        <div className="rounded-lg border">
          <Button
            variant="ghost"
            type="button"
            onClick={() => setGuideOpen(!guideOpen)}
            className="flex items-center justify-between w-full p-3 text-sm font-medium hover:bg-accent/50 rounded-lg h-auto"
          >
            <span className="flex items-center gap-2 text-muted-foreground">
              <Info className="h-4 w-4" />
              Setup guide
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform",
                guideOpen && "rotate-180",
              )}
            />
          </Button>
          {guideOpen && selectedTypeInfo.setupGuide && (
            <div className="px-3 pb-3 space-y-4">
              {selectedTypeInfo.setupGuide.providers.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">
                    Popular providers
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedTypeInfo.setupGuide.providers.map((provider) => (
                      <a
                        key={provider.name}
                        href={provider.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-accent hover:bg-accent/80 transition-colors"
                      >
                        {provider.name}
                        <ExternalLink className="h-2.5 w-2.5 opacity-50" />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Steps */}
              <div className="space-y-2">
                {selectedTypeInfo.setupGuide.steps.map((s, i) => (
                  <div key={i} className="space-y-0.5">
                    <p className="text-sm font-medium">{s.step}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {s.detail}
                    </p>
                    {s.link && (
                      <a
                        href={s.link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-0.5"
                      >
                        {s.link.label}
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                  </div>
                ))}
              </div>

              {/* Connection string format */}
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  Connection string format
                </p>
                <code className="block text-xs font-mono bg-muted px-2 py-1.5 rounded break-all">
                  {selectedTypeInfo.setupGuide.format}
                </code>
              </div>

              {/* Tips */}
              {selectedTypeInfo.setupGuide.tips &&
                selectedTypeInfo.setupGuide.tips.length > 0 && (
                  <div className="rounded-md bg-blue-500/10 p-2.5 space-y-1">
                    {selectedTypeInfo.setupGuide.tips.map((tip, i) => (
                      <p
                        key={i}
                        className="text-xs text-blue-600 dark:text-blue-400 leading-relaxed"
                      >
                        {tip}
                      </p>
                    ))}
                  </div>
                )}
            </div>
          )}
        </div>

        {testResult && (
          <div
            className={cn(
              "flex items-center gap-2 p-3 rounded-lg text-sm",
              testResult.success
                ? "bg-green-500/10 text-green-600 dark:text-green-400"
                : "bg-red-500/10 text-red-600 dark:text-red-400",
            )}
          >
            {testResult.success ? (
              <>
                <Check className="h-4 w-4" />
                Connection successful
              </>
            ) : (
              <>
                <AlertCircle className="h-4 w-4" />
                {testResult.error || "Connection failed"}
              </>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            onClick={handleClose}
            title="Cancel (Escape)"
          >
            Cancel
          </Button>
          <Button
            onClick={handleAdd}
            disabled={!canSubmit}
            loading={isLoading}
            title="Add Connection (Enter)"
          >
            Add Connection
          </Button>
        </div>
      </div>
    );
  };

  const renderTableSelector = () => {
    if (!schema) return null;

    const allTableNames = schema.tables.map((t) =>
      t.schema ? `${t.schema}.${t.name}` : t.name,
    );
    const allSelected = selectedTables.size === allTableNames.length;

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 p-3 rounded-lg bg-green-500/10">
          <div className="h-10 w-10 rounded-lg bg-green-500/20 flex items-center justify-center">
            <Check className="h-5 w-5 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <div className="font-medium text-green-600 dark:text-green-400">
              Connected successfully
            </div>
            <div className="text-xs text-muted-foreground">
              {schema.tables.length} tables discovered
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <Label>Select tables to sync</Label>
            <Button
              variant="link"
              size="sm"
              onClick={toggleAllTables}
              className="text-xs text-primary hover:underline h-auto p-0"
            >
              {allSelected ? "Deselect all" : "Select all"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Choose which tables you want to receive data from
          </p>

          {schemaLoading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner className="h-6 w-6 text-muted-foreground" />
            </div>
          ) : schemaError ? (
            <div className="p-3 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 text-sm">
              <AlertCircle className="h-4 w-4 inline mr-2" />
              {schemaError}
            </div>
          ) : schema.tables.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              <Table2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No tables found in database</p>
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto border rounded-lg divide-y">
              {schema.tables.map((table) => {
                const fullName = table.schema
                  ? `${table.schema}.${table.name}`
                  : table.name;
                const isSelected = selectedTables.has(fullName);

                return (
                  <Label
                    key={fullName}
                    className={cn(
                      "flex items-center gap-3 p-3 cursor-pointer hover:bg-accent/50 transition-colors",
                      isSelected && "bg-primary/5",
                    )}
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleTable(fullName)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Table2 className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="font-mono text-sm truncate">
                          {table.name}
                        </span>
                        {table.schema && table.schema !== "public" && (
                          <span className="text-xs text-muted-foreground">
                            ({table.schema})
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {table.columns.length} columns
                      </div>
                    </div>
                  </Label>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={handleClose}>
            Skip
          </Button>
          <Button
            onClick={handleSaveTableSelection}
            disabled={selectedTables.size === 0}
            loading={isLoading}
          >
            Save Selection ({selectedTables.size})
          </Button>
        </div>
      </div>
    );
  };

  const renderLinkDevice = () => (
    <div className="space-y-4 py-4">
      <div className="text-center space-y-2">
        <CheckCircle className="h-8 w-8 text-green-500 mx-auto" />
        <p className="text-sm font-medium">Connection added</p>
        <p className="text-xs text-muted-foreground">
          Does a column in this data name the things you monitor? Map it and
          each value becomes a source — with its own page, status, and alerts.
        </p>
      </div>
      {createdSourceId ? (
        <IdentityMapping
          sourceId={createdSourceId}
          schema={schema}
          onSaved={() => {
            router.push("/devices");
            handleClose();
          }}
        />
      ) : (
        <p className="text-sm text-muted-foreground text-center">
          Connection not ready yet.
        </p>
      )}
      <Button variant="ghost" className="w-full" onClick={handleClose}>
        Skip — just query tables
      </Button>
    </div>
  );

  const focusedTitle = (() => {
    switch (step) {
      case "configure":
        return selectedTypeInfo
          ? `Connect ${selectedTypeInfo.label}`
          : "Configure";
      case "select-tables":
        return "Select tables";
      case "link-device":
        return "Map identities";
      default:
        return "Add connection";
    }
  })();

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-3xl p-0 gap-0 border-border/60">
        {step === "select-type" ? (
          <>
            <DialogHeader className="sr-only">
              <DialogTitle>Add connection</DialogTitle>
            </DialogHeader>
            {renderPalette()}
          </>
        ) : (
          <div className="flex flex-col max-h-[90vh] min-h-0">
            <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border/60 shrink-0">
              <button
                onClick={handleBack}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Back
              </button>
              <div className="h-3 w-px bg-border/60" />
              <DialogHeader className="flex-1 space-y-0 flex-row items-center gap-2">
                {step === "configure" && selectedTypeInfo && (
                  <span className="[&_svg]:h-4 [&_svg]:w-4 flex items-center">
                    {selectedTypeInfo.logo}
                  </span>
                )}
                <DialogTitle className="text-sm font-medium">
                  {focusedTitle}
                </DialogTitle>
              </DialogHeader>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-6 py-5">
              {step === "configure" && renderConfigForm()}
              {step === "select-tables" && renderTableSelector()}
              {step === "link-device" && renderLinkDevice()}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
