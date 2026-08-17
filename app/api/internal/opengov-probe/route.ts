import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function absolute(base: string, src: string) {
  return new URL(src, base).toString();
}

export async function GET(request: NextRequest) {
  const deploymentHost = process.env.VERCEL_URL;
  const requestHost = request.headers.get("host");
  if (!deploymentHost || requestHost !== deploymentHost) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const pageUrl = "https://procurement.opengov.com/portal/embed/psusd/project-list?departmentId=all&status=all";
  const page = await fetch(pageUrl, { cache: "no-store" });
  const html = await page.text();
  const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m => absolute(pageUrl, m[1]));
  const matches: Array<{ script: string; snippets: string[] }> = [];

  for (const script of scripts.slice(0, 40)) {
    try {
      const response = await fetch(script, { cache: "no-store" });
      if (!response.ok) continue;
      const text = await response.text();
      const needles = ["/project/list", "publicView", "government/list", "governmentCode"];
      const snippets: string[] = [];
      for (const needle of needles) {
        let from = 0;
        while (snippets.length < 12) {
          const index = text.indexOf(needle, from);
          if (index < 0) break;
          snippets.push(text.slice(Math.max(0, index - 350), Math.min(text.length, index + 700)));
          from = index + needle.length;
        }
      }
      if (snippets.length) matches.push({ script, snippets });
    } catch {
      // Best-effort diagnostics only.
    }
  }

  return NextResponse.json({
    ok: true,
    pageStatus: page.status,
    scriptCount: scripts.length,
    scripts,
    matches,
  });
}
