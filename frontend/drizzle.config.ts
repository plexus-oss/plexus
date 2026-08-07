import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside Next, so load the app env ourselves.
config({ path: ".env.local" });

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations/drizzle",
  dbCredentials: { url: process.env.DATABASE_URL! },
  // The app DB is the `public` schema only (Supabase's auth/storage/etc. schemas
  // are not part of this app's data and aren't seeded locally).
  schemaFilter: ["public"],
  casing: "snake_case",
  strict: true,
  verbose: true,
});
