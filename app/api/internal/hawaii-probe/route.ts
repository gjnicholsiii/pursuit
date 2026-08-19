import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const API = "https://hands.ehawaii.gov/hands/api/bidding-opportunities";
const CRITERIA = { query:"", showClosed:false, showCancelled:false, omitPagination:false, categories:[], procurementCategory:"", department:"", islands:[], statuses:["POSTED"], publishDate:"", offerDueDate:"", jurisdiction:"" };

async function page(page:number){
  const r=await fetch(`${API}?size=100&page=${page}&sort=publish_date_dt,desc`,{method:"POST",headers:{accept:"application/json","content-type":"application/json","user-agent":"Mozilla/5.0 PursuitGovernmentRevenue/1.0"},body:JSON.stringify(CRITERIA),cache:"no-store"});
  return r.json();
}

export async function GET(){
  const first:any=await page(0); const pages=first?.data?.searchResult?.totalPages || 0;
  const rows:any[]=[...(first?.data?.searchResult?.content||[])];
  for(let p=1;p<pages;p++){const next:any=await page(p); rows.push(...(next?.data?.searchResult?.content||[]));}
  const missingId=rows.filter(r=>r.id==null);
  const missingNo=rows.filter(r=>!r.solicitionNo);
  const key=(r:any)=>`${r.system||"HANDS"}:${r.id ?? r.solicitionNo ?? `${r.title}|${r.dueDate}`}`;
  const keys=rows.map(key); const counts=new Map<string,number>(); keys.forEach(k=>counts.set(k,(counts.get(k)||0)+1));
  const duplicates=[...counts.entries()].filter(([,n])=>n>1);
  const systems=rows.reduce((a:any,r:any)=>(a[r.system||"unknown"]=(a[r.system||"unknown"]||0)+1,a),{});
  return NextResponse.json({total:first?.data?.total,totalElements:first?.data?.searchResult?.totalElements,pages,rows:rows.length,missingId,missingNo,uniqueKeys:new Set(keys).size,duplicates,systems});
}
