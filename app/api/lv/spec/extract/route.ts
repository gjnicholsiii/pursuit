import { NextRequest, NextResponse } from "next/server";
import { extractSpecMentions } from "@/lib/lv-spec-extractor";
import { persistSpecMentions } from "@/lib/lv-spec-persistence";
import { lowVoltageDatabaseConfigured } from "@/lib/lv-persistence";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as null | {
    text?: string;
    projectId?: number;
    evidenceId?: number;
    specifyingFirm?: string | null;
    persist?: boolean;
  };
  if (!body?.text?.trim()) {
    return NextResponse.json({ error: "Provide project document text." }, { status: 400 });
  }

  const mentions = extractSpecMentions(body.text);
  const manufacturers = [...new Set(mentions.map(item => item.manufacturer))];
  let persisted = 0;
  let persistenceReason: string | null = null;

  if (body.persist && body.projectId && body.evidenceId) {
    const result = await persistSpecMentions({
      projectId: body.projectId,
      evidenceId: body.evidenceId,
      mentions,
      specifyingFirm: body.specifyingFirm,
    });
    persisted = result.stored;
    persistenceReason = "reason" in result ? String(result.reason) : null;
  }

  return NextResponse.json({
    mentions: mentions.length,
    manufacturers,
    databaseConfigured: lowVoltageDatabaseConfigured(),
    persisted,
    persistenceReason,
    results: mentions,
  });
}
