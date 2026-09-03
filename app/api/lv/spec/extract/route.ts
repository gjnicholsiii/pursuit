import { NextRequest, NextResponse } from "next/server";
import { extractSpecMentions } from "@/lib/lv-spec-extractor";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as null | { text?: string };
  if (!body?.text?.trim()) {
    return NextResponse.json({ error: "Provide project document text." }, { status: 400 });
  }

  const mentions = extractSpecMentions(body.text);
  const manufacturers = [...new Set(mentions.map(item => item.manufacturer))];
  return NextResponse.json({
    mentions: mentions.length,
    manufacturers,
    results: mentions,
  });
}
