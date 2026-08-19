import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const ENDPOINT = "https://www.ms.gov/dfa/contract_bid_search/Bid/BidData?AppId=1&Status=Open";

export async function GET() {
  try {
    const form = new URLSearchParams();
    form.set("sEcho", "1");
    form.set("iDisplayStart", "0");
    form.set("iDisplayLength", "9999");
    form.set("iColumns", "9");
    form.set("sSearch", "");
    const columns = ["Agency", "BidNumber", "ObjectID", "VerNumber", "BidStatus", "AdvertiseDate", "SubmissionDate", "OpeningDate", "BidID"];
    for (let i = 0; i < columns.length; i += 1) {
      form.set(`mDataProp_${i}`, columns[i]);
      form.set(`bSearchable_${i}`, "true");
      form.set(`bSortable_${i}`, i === 8 ? "false" : "true");
      form.set(`sSearch_${i}`, "");
      form.set(`bRegex_${i}`, "false");
    }
    form.set("iSortingCols", "0");
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        accept: "application/json,text/javascript,*/*;q=0.01",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
        "user-agent": "Mozilla/5.0 PursuitGovernmentRevenue/1.0",
        referer: "https://www.ms.gov/dfa/contract_bid_search/Bid?autoloadGrid=true",
      },
      body: form.toString(),
      cache: "no-store",
    });
    const text = await response.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch {}
    const rows = Array.isArray(parsed?.aaData) ? parsed.aaData : Array.isArray(parsed?.data) ? parsed.data : [];
    return NextResponse.json({
      status: response.status,
      contentType: response.headers.get("content-type"),
      length: text.length,
      keys: parsed && typeof parsed === "object" ? Object.keys(parsed) : [],
      total: parsed?.iTotalRecords ?? parsed?.recordsTotal ?? null,
      filtered: parsed?.iTotalDisplayRecords ?? parsed?.recordsFiltered ?? null,
      rows: rows.length,
      sample: rows.slice(0, 3),
      parseError: parsed ? null : text.slice(0, 500),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
