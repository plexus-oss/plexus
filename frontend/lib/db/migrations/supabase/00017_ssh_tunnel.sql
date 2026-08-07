-- Add SSH tunnel support for private database connections (e.g., RDS in private VPCs)
-- Non-secret SSH config (host, port, username) stored in metadata.ssh_tunnel
-- Private key / password encrypted here, same AES-256-GCM as credentials_encrypted
ALTER TABLE sources ADD COLUMN ssh_credentials_encrypted TEXT;
