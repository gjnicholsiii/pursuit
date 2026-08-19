import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const BASE = "https://vendor.myfloridamarketplace.com/mfmp";
const criteria = {
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
async function req(path:string, init?:RequestInit){
  const r=await fetch(BASE+path,{...init,headers:{accept:"application/json,text/plain,*/*","content-type":"application/json","user-agent":"Mozilla/5.0 PursuitGovernmentRevenue/1.0",...(init?.headers||{})},cache:"no-store"});
  const text=await r.text();
  return {path,status:r.status,contentType:r.headers.get("content-type"),body:text.slice(0,50000)};
}
export async function GET(){
  const results=[];
  for(const p of ["/pub/search/newsfeed","/pub/search/picklistOrg","/bids/AdTypes","/bids/AdStatuses"])try{results.push(await req(p))}catch(e){results.push({path:p,error:e instanceof Error?e.message:String(e)})}
  for(const [p,b] of [["/pub/search/bids/count",criteria],["/pub/search/bids",{...criteria,page:1}]] as const)try{results.push(await req(p,{method:"POST",body:JSON.stringify(b)}))}catch(e){results.push({path:p,error:e instanceof Error?e.message:String(e)})}
  return NextResponse.json({ok:true,results});
}
