import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BULK_URL = "https://s3.amazonaws.com/falextracts/Contract%20Opportunities/datagov/ContractOpportunitiesFullCSV.csv";

export async function GET() {
  try {
    const response = await fetch(BULK_URL, {
      cache: "no-store",
      headers: { Range: "bytes=0-32767" },
    });

    if (!response.ok && response.status !== 206) {
      return NextResponse.json({ ok: false, status: response.status }, { status: 502 });
    }

    const text = await response.text();
    return NextResponse.json({
      ok: true,
      status: response.status,
      contentRange: response.headers.get("content-range"),
      contentLength: response.headers.get("content-length"),
      sample: text.split(/\r?\n/).slice(0, 4),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Bulk probe failed" },
      { status: 500 },
    );
  }
}
