import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.LOW_VOLTAGE_DATABASE_URL;
  if (!url) {
    return NextResponse.json({ ok: false, configured: false }, { status: 503 });
  }

  try {
    const sql = neon(url);
    const rows = await sql`select current_database() as database, current_user as role, now() as checked_at`;
    return NextResponse.json({
      ok: true,
      configured: true,
      database: rows[0]?.database || null,
      role: rows[0]?.role || null,
      checkedAt: rows[0]?.checked_at || null,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      configured: true,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
