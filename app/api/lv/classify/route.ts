import { NextRequest, NextResponse } from "next/server";
import { classifyLowVoltage } from "@/lib/lv-classifier";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as null | { title?: string; description?: string; scope?: string };
  if (!body || (!body.title && !body.description && !body.scope)) {
    return NextResponse.json({ error: "Provide title, description or scope." }, { status: 400 });
  }

  return NextResponse.json(classifyLowVoltage(body));
}
