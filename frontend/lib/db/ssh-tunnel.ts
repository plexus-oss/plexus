import "server-only";

import { Client } from "ssh2";
import { createServer, type Server } from "net";

export interface SSHTunnelConfig {
  host: string;
  port: number;
  username: string;
  privateKey?: string;
  password?: string;
}

export interface TunnelInfo {
  localHost: string;
  localPort: number;
  close: () => Promise<void>;
}

const SSH_CONNECT_TIMEOUT = 10_000;

export async function createSSHTunnel(
  ssh: SSHTunnelConfig,
  remoteHost: string,
  remotePort: number
): Promise<TunnelInfo> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let server: Server | null = null;
    let resolved = false;

    const cleanup = () => {
      try {
        server?.close();
      } catch {}
      try {
        client.end();
      } catch {}
    };

    client.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        if (err.message.includes("authentication")) {
          reject(
            new Error(
              "SSH authentication failed — verify your private key or password"
            )
          );
        } else {
          reject(
            new Error(
              `SSH connection error: ${err.message}`
            )
          );
        }
      }
    });

    client.on("ready", () => {
      // Create a local TCP server that forwards connections through the SSH channel
      server = createServer((sock) => {
        client.forwardOut(
          "127.0.0.1",
          sock.localPort ?? 0,
          remoteHost,
          remotePort,
          (err, stream) => {
            if (err) {
              sock.destroy();
              return;
            }
            sock.pipe(stream).pipe(sock);
            stream.on("error", () => sock.destroy());
            sock.on("error", () => stream.destroy());
          }
        );
      });

      server.on("error", (err) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new Error(`Tunnel server error: ${err.message}`));
        }
      });

      // Listen on a random port on localhost only
      server.listen(0, "127.0.0.1", () => {
        const addr = server!.address();
        if (!addr || typeof addr === "string") {
          cleanup();
          reject(new Error("Failed to get tunnel local address"));
          return;
        }
        resolved = true;
        resolve({
          localHost: "127.0.0.1",
          localPort: addr.port,
          close: () =>
            new Promise<void>((res) => {
              server?.close(() => {
                client.end();
                res();
              });
              // If server close hangs, force after 2s
              setTimeout(() => {
                try {
                  client.destroy();
                } catch {}
                res();
              }, 2000);
            }),
        });
      });
    });

    // Connect to the bastion
    client.connect({
      host: ssh.host,
      port: ssh.port,
      username: ssh.username,
      privateKey: ssh.privateKey,
      password: ssh.password,
      readyTimeout: SSH_CONNECT_TIMEOUT,
    });

    // Hard timeout if SSH handshake never completes
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(
          new Error(
            `Cannot reach bastion host ${ssh.host}:${ssh.port} — connection timed out after ${SSH_CONNECT_TIMEOUT / 1000}s`
          )
        );
      }
    }, SSH_CONNECT_TIMEOUT + 1000);
  });
}
