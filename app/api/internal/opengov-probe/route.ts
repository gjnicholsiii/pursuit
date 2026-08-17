import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const API_BASES = [
  "https://api.procurement.opengov.com/api/v1",
  "https://api.procurement.opengov.com",
];

async function preview(response: Response) {
  const text = await response.text();
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    body: text.slice(0, 3000),
  };
}

export async function GET(request: NextRequest) {
  const deploymentHost = process.env.VERCEL_URL;
  const requestHost = request.headers.get("host");
  if (!deploymentHost || requestHost !== deploymentHost) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const projectBodies = [
    { governmentCode: "psusd", publicView: true },
    { governmentCode: "psusd", publicView: true, limit: 10, offset: 0 },
    { governmentCode: "psusd", publicView: true, page: 1, pageSize: 10 },
    { code: "psusd", publicView: true, limit: 10, offset: 0 },
    { government: "psusd", publicView: true, limit: 10, offset: 0 },
  ];

  const projectResults: unknown[] = [];
  for (const base of API_BASES) {
    for (const body of projectBodies) {
      try {
        const response = await fetch(`${base}/project/list`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(body),
          cache: "no-store",
        });
        projectResults.push({ base, request: body, ...(await preview(response)) });
      } catch (error) {
        projectResults.push({ base, request: body, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  const governmentPaths = ["/government/list", "/governments", "/government", "/portal/list", "/organization/list"];
  const governmentResults: unknown[] = [];
  for (const base of API_BASES) {
    for (const path of governmentPaths) {
      try {
        const response = await fetch(`${base}${path}`, { headers: { accept: "application/json" }, cache: "no-store" });
        governmentResults.push({ base, path, ...(await preview(response)) });
      } catch (error) {
        governmentResults.push({ base, path, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  return NextResponse.json({ ok: true, projectResults, governmentResults });
}
