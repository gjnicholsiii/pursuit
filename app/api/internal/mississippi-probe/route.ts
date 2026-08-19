import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const ENDPOINT = "https://www.ms.gov/dfa/contract_bid_search/Bid/BidData?AppId=1&Status=Open";

export async function GET() {
  try {
    const form = new URLSearchParams();
    form.set("sEcho","1");
    form.set("iDisplayStart","0");
    form.set("iDisplayLength","9999");
    form.set("iColumns","9");
    form.set("sSearch","");
    for (let i=0;i<9;i++) {
      form.set(`mDataProp_${i}`, ["Agency","BidNumber","ObjectID","VerNumber","BidStatus","AdvertiseDate","SubmissionDate","OpeningDate","BidID"][i]);
      form.set(`bSearchable_${i}`,"true");
      form.set(`bSortable_${i}`,i===8?"false":"true");
      form.set(`sSearch_${i}`,"");
      form.set(`bRegex_${i}`,"false");
    }
    form.set("iSortingCols","0");
    const r = await fetch(ENDPOINT,{method:"POST",headers:{accept:"application/json,text/javascript,*/*;q=0.01","content-type":"application/x-www-form-urlencoded; charset=UTF-8","x-requested-with":"XMLHttpRequest","user-agent":"Mozilla/5.0 PursuitGovernmentRevenue/1.0","referer":"https://www.ms.gov/dfa/contract_bid_search/Bid?autoloadGrid=true"},body:form.toString(),cache:"no-store"});
    const text=await r.text();
    let parsed:any=null; try{parsed=JSON.parse(text);}catch{}
    return NextResponse.json({status:r.status,contentType:r.headers.get("content-type"),length:text.length,parsed,sample:parsed?undefined:text.slice(0,5000)});
  } catch(e){return NextResponse.json({error:e instanceof Error?e.message:String(e)},{status:500});}
}
