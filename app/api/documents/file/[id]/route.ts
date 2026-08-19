import { get } from "@vercel/blob";
import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sql = getSql();
  const rows = await sql.query(
    `select storage_key, filename
     from opportunity_documents
     where id=$1 and storage_key is not null and is_missing=false
     limit 1`,
    [id],
  ) as Array<{ storage_key:string; filename:string }>;

  const document = rows[0];
  if (!document) return NextResponse.json({ error:"Document not found" }, { status:404 });

  const result = await get(document.storage_key, { access:"private" });
  if (!result || result.statusCode !== 200) return NextResponse.json({ error:"Stored document unavailable" }, { status:404 });

  const filename = document.filename.replace(/[\r\n"]/g, "");
  return new Response(result.stream, {
    headers: {
      "Content-Type": result.blob.contentType || "application/octet-stream",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
