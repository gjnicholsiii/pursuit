import { get } from "@vercel/blob";
import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Row = { id:string; opportunity_id:string; filename:string; text_storage_key:string };
type Req = { category:string; text:string; line:number };

function compact(v:string){ return v.replace(/\s+/g," ").trim(); }
function skipRequirementMining(filename:string){
  return /\b(w[- ]?9|form 1295|1295[_ -]?form|certificate of interested parties)\b/i.test(filename);
}

function collectRequirements(lines:string[]):Req[] {
  const out:Req[]=[]; const seen=new Set<string>();
  lines.forEach((raw,i)=>{
    const line=compact(raw);
    if(line.length<25 || line.length>600) return;
    if(!/\b(shall|must|required to|are required to|is required to)\b/i.test(line)) return;
    if(/\b(if required|not required|not is required)\b/i.test(line)) return;
    const key=line.toLowerCase(); if(seen.has(key)) return; seen.add(key);
    let category="submission_requirement";
    if(/bond|bonding/i.test(line)) category="bonding";
    else if(/insurance|insured/i.test(line)) category="insurance";
    else if(/certif|license|registration/i.test(line)) category="certification";
    else if(/delivery|period of performance|completion date/i.test(line)) category="performance";
    else if(/technical|specification|scope of work|statement of work/i.test(line)) category="technical";
    else if(/price|pricing|cost/i.test(line)) category="pricing";
    else if(/site visit|pre[- ]bid|preproposal|pre-proposal/i.test(line)) category="site_visit";
    out.push({category,text:line,line:i+1});
  });
  return out.slice(0,30);
}

async function analyzeOne(document:Row){
  const sql=getSql();
  try{
    if(skipRequirementMining(document.filename)){
      await sql.query(`update opportunity_documents set extraction_status='analyzed' where id=$1::uuid`,[document.id]);
      return {ok:true,documentId:document.id,opportunityId:document.opportunity_id,filename:document.filename,requirementsFound:0,skippedBoilerplate:true};
    }
    const blob=await get(document.text_storage_key,{access:"private"});
    if(!blob || blob.statusCode!==200 || !blob.stream) return {ok:false,documentId:document.id,reason:"extracted_text_unavailable"};
    const text=await new Response(blob.stream).text();
    const requirements=collectRequirements(text.split(/\r?\n/));

    for(const r of requirements){
      await sql.query(
        `insert into requirements (opportunity_id,document_id,category,requirement_text,mandatory,evidence_locator,normalized_value,extraction_confidence)
         select $1::uuid,$2::uuid,$3::text,$4::text,true,
                jsonb_build_object('document_id',$2::text,'line',$5::int),
                jsonb_build_object('source','document_text'),0.98
         where not exists (select 1 from requirements x where x.document_id=$2::uuid and x.requirement_text=$4::text)`,
        [document.opportunity_id,document.id,r.category,r.text,r.line]
      );
    }

    await sql.query(`update opportunity_documents set extraction_status='analyzed' where id=$1::uuid`,[document.id]);
    return {ok:true,documentId:document.id,opportunityId:document.opportunity_id,filename:document.filename,requirementsFound:requirements.length};
  }catch(error){
    return {ok:false,documentId:document.id,reason:error instanceof Error?error.message:"evidence_analysis_failed"};
  }
}

export async function GET(){
  const sql=getSql();
  const rows=await sql.query(
    `select d.id,d.opportunity_id,d.filename,ef.normalized_value->>'text_storage_key' as text_storage_key
     from opportunity_documents d
     join extracted_facts ef on ef.document_id=d.id and ef.fact_type='document_text_extract'
     join opportunities o on o.id=d.opportunity_id
     join sources s on s.id=o.source_id
     where d.extraction_status='text_extracted'
       and ef.normalized_value->>'text_storage_key' is not null
     order by case when d.document_type='ionwave_attachment' then 0 when s.source_family='sled' then 1 else 2 end,
              d.fetched_at asc nulls last,d.id
     limit 5`
  ) as Row[];

  if(!rows.length) return NextResponse.json({ok:true,processed:0,message:"No extracted documents are waiting for evidence analysis"});
  const results=[] as Array<Record<string,unknown>>;
  for(const document of rows) results.push(await analyzeOne(document));
  const analyzed=results.filter(result=>result.ok).length;
  return NextResponse.json({ok:true,processed:results.length,analyzed,failed:results.length-analyzed,requirementsFound:results.reduce((sum,result)=>sum+Number(result.requirementsFound||0),0),results});
}
