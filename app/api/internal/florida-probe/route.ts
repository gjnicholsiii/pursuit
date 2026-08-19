import { NextResponse } from "next/server";
export const dynamic="force-dynamic";
export const maxDuration=90;
const JS="https://vendor.myfloridamarketplace.com/11.147be3f0dc8ea308788d.js";
export async function GET(){
 try{
  const js=await fetch(JS,{cache:"no-store"}).then(r=>r.text());
  const contexts:string[]=[];
  for(const pattern of ["PUBLISHED","statusOpts","AdStatuses","publishedDate","pageSize:25","searchCount(","searchForm","fb.group","formBuilder.group"]){
   let i=0; while((i=js.indexOf(pattern,i))>=0&&contexts.length<200){contexts.push(js.slice(Math.max(0,i-1100),Math.min(js.length,i+2200)));i+=pattern.length;}
  }
  return NextResponse.json({ok:true,length:js.length,contexts});
 }catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:String(error)},{status:500})}
}
