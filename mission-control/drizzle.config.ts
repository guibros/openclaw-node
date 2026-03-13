import { defineConfig } from "drizzle-kit";
import path from "path";

const dbPath = process.env.DB_PATH || path.resolve(__dirname, "data", "mission-control.db");

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: dbPath,
  },
});
