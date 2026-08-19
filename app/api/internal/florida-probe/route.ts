import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const BASE = "https://vendor.myfloridamarketplace.com/mfmp";
const blank = {
  pageSize: 25,
  type: [],
  status: [],
  agency: [],
  adNumber: "",
  agencyAdvertisementNumber: "",
  title: "",
  publishedDate: "",
  openDate: "",
  endDate: "",
  commodityCodes: [],
  intendsToParticipate: "",
  assignee: "",
};

async function post(path:string, body:unknown){
  const r=await fetch(BASE+path,{method:"POST",headers:{accept:"application/json,text/plain,*/*","content-type":"application/json","user-agent":"Mozilla/5.0 PursuitGovernmentRevenue/1.0"},body:JSON.stringify(body),cache:"no-store"});
  const text=await r.text();
  return {status:r.status,body:text.slice(0,25000)};
}

export async function GET(){
  const itb={id:"4",value:"Invitation to Bid"};
  const rfp={id:"6",value:"Request for Proposals"};
  const tests=[
    {name:"itb",criteria:{...blank,type:[itb]}},
    {name:"rfp",criteria:{...blank,type:[rfp]}},
    {name:"itb_end_iso",criteria:{...blank,type:[itb],endDate:"2026-08-18T00:00:00.000Z"}},
    {name:"itb_end_us",criteria:{...blank,type:[itb],endDate:"08/18/2026"}},
    {name:"itb_open_iso",criteria:{...blank,type:[itb],openDate:"2026-08-18T00:00:00.000Z"}},
    {name:"title_a",criteria:{...blank,title:"a"}},
  ];
  const results=[];
  for(const test of tests){
    try{
      const count=await post("/pub/search/bids/count",test.criteria);
      const rows=await post("/pub/search/bids",{...test.criteria,page:1});
      results.push({name:test.name,criteria:test.criteria,count,rows});
    }catch(error){results.push({name:test.name,error:error instanceof Error?error.message:String(error)})}
  }
  return NextResponse.json({ok:true,results});
}
