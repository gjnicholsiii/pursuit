import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Lightweight production connectivity check for the configured Neon database.
export async function GET() {
  try {
    const sql = getSql();
    const rows = await sql`select current_database() as database, now() as checked_at`;
    return NextResponse.json({ ok: true, database: rows[0]?.database, checkedAt: rows[0]?.checked_at });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database connection failed";
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}
