import "server-only";
import { createSSHTunnel, type SSHTunnelConfig, type TunnelInfo } from "../../ssh-tunnel";

interface TunnelableConfig {
  host: string;
  port: number;
  ssl?: boolean;
  sslExplicit?: boolean;
}

export async function withTunnel<T extends TunnelableConfig>(
  config: T,
  sshTunnel: SSHTunnelConfig,
): Promise<{ config: T; tunnel: TunnelInfo }> {
  const tunnel = await createSSHTunnel(sshTunnel, config.host, config.port);
  const remoteIsLocal = config.host === "localhost" || config.host === "127.0.0.1";
  const ssl = config.sslExplicit ? config.ssl : !remoteIsLocal;
  return {
    config: { ...config, host: tunnel.localHost, port: tunnel.localPort, ssl },
    tunnel,
  };
}
