import { neon } from "@neondatabase/serverless";

export const dynamic = "force-static";

export default async function LVDatabaseVerifyPage() {
  const url = process.env.LOW_VOLTAGE_DATABASE_URL;
  if (!url || !/^postgres(?:ql)?:\/\//i.test(url)) {
    throw new Error("LOW_VOLTAGE_DATABASE_URL is missing or invalid");
  }

  const sql = neon(url);
  const result = await sql`select current_database() as database, current_user as role`;
  const row = (result as Array<Record<string, unknown>>)[0] || {};

  if (row.database !== "pursuit_lv") {
    throw new Error(`LOW_VOLTAGE_DATABASE_URL points to unexpected database: ${String(row.database || "unknown")}`);
  }

  return (
    <main style={{ padding: 32, fontFamily: "monospace" }}>
      <h1>LV Database Verified</h1>
      <p>Database: {String(row.database)}</p>
      <p>Role: {String(row.role)}</p>
    </main>
  );
}
