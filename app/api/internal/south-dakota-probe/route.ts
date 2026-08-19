import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const uid = "3444a404-3818-494f-84c5-2a850acd7779";
const base = `https://postingboard.esmsolutions.com/api/postingBoard/${uid}`;

function url(path: string, params: Record<string,string>) {
  const u = new URL(`${base}/${path}`);
  for (const [k,v] of Object.entries(params)) u.searchParams.set(k,v);
  u.searchParams.set("browserGlobalTimeZoneNameId", "Central Standard Time");
  u.searchParams.set("browserGlobalTimeZoneName", "America/Chicago");
  u.searchParams.set("browserOffset", "-05:00:00");
  return u;
}

async function get(path: string, params: Record<string,string>) {
  const r = await fetch(url(path, params), { cache: "no-store", headers: { accept: "application/json", "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0" } });
  const t = await r.text();
  let p: unknown = null; try { p = JSON.parse(t); } catch {}
  return { status: r.status, parsed: p, sample: t.slice(0, 5000) };
}

export async function GET() {
  return NextResponse.json({
    header: await get("headereventdetails", { eventId: "19895" }),
    general: await get("generaleventdetails", { eventId: "19895" }),
    commodities: await get("eventcommodities", { eventId: "19895", pageNo: "0", recordsPerPage: "50" }),
  });
}
