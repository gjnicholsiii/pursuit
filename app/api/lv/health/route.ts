import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const dynamic = "force-dynamic";

function validDatabaseUrl(value: string | undefined) {
  return Boolean(value && /^postgres(?:ql)?:\/\//i.test(value));
}

export async function GET() {
  const url = process.env.LOW_VOLTAGE_DATABASE_URL;
  if (!validDatabaseUrl(url)) {
    return NextResponse.json({ ok: false, configured: Boolean(url), validUrl: false }, { status: 503 });
  }

  try {
    const sql = neon(url!);
    const rows = await sql`select current_database() as database, current_user as role, now() as checked_at`;
    const row = (rows as Array<Record<string, unknown>>)[0] || {};
    return NextResponse.json({
      ok: true,
      configured: true,
      validUrl: true,
      database: row.database || null,
      role: row.role || null,
      checkedAt: row.checked_at || null,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      configured: true,
      validUrl: true,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
