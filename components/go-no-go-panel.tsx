import { getSql } from "@/lib/db";
import { getCurrentCustomerProfile } from "@/lib/customer-profile";
import { AnalysisRefresh } from "@/components/analysis-refresh";

type Requirement={id:string;category:string;requirement_text:string;filename:string;line:number|null};
type ProfileDetail={bonding_limit:string|number|null;contract_vehicles:string[]|null;certifications:string[]|null;small_business_statuses:string[]|null;capability_terms:string[]|null};
type Credential={credential_type:string;credential_value:string;status:string};
type Decision={decision:string;reason:string|null;decided_at:string};

function norm(value:string){return value.toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}
function moneyFrom(text:string){const m=text.match(/\$\s*([\d,.]+)\s*(million|m|thousand|k)?/i);if(!m)return null;let n=Number(m[1].replace(/,/g,""));if(!Number.isFinite(n))return null;const unit=(m[2]||"").toLowerCase();if(unit==="million"||unit==="m")n*=1_000_000;if(unit==="thousand"||unit==="k")n*=1_000;return n}

export async function GoNoGoPanel({opportunityId}:{opportunityId:string}){
  const profile=await getCurrentCustomerProfile();
  if(!profile)return <section className="brief-panel"><div className="brief-panel-heading"><div><span>GO / NO-GO</span><h2>Company profile required</h2></div></div><p className="brief-explainer">Add your industry codes and qualifications before running a qualification check.</p></section>;
  const sql=getSql();
  const [decisionRows,jobRows,reqRows,profileRows,credentialRows]=await Promise.all([
    sql.query(`select decision,reason,decided_at from opportunity_decisions where organization_id=$1 and opportunity_id=$2 order by decided_at desc limit 1`,[profile.organizationId,opportunityId]),
    sql.query(`select count(*) filter(where state in ('pending','leased'))::int as active,count(*) filter(where state='dead')::int as dead from document_jobs where meta->>'organizationId'=$1 and meta->>'opportunityId'=$2 and meta->>'reason'='go_no_go'`,[profile.organizationId,opportunityId]),
    sql.query(`select r.id,r.category,r.requirement_text,d.filename,case when jsonb_typeof(r.evidence_locator)='object' then (r.evidence_locator->>'line')::int end as line from requirements r join opportunity_documents d on d.id=r.document_id where r.opportunity_id=$1 and r.mandatory=true order by r.created_at`,[opportunityId]),
    sql.query(`select bonding_limit,contract_vehicles,certifications,small_business_statuses,capability_terms from selling_profiles where organization_id=$1 order by updated_at desc limit 1`,[profile.organizationId]),
    sql.query(`select credential_type,credential_value,status from readiness_credentials where organization_id=$1 and status not in ('expired','revoked')`,[profile.organizationId]),
  ]);
  const decision=(decisionRows as Decision[])[0];
  const jobs=(jobRows as Array<{active:number;dead:number}>)[0]||{active:0,dead:0};
  const requirements=reqRows as Requirement[];
  const detail=(profileRows as ProfileDetail[])[0];
  const readiness=credentialRows as Credential[];
  const requested=Boolean(decision);
  const active=Number(jobs.active||0);
  const dead=Number(jobs.dead||0);
  const requestedAt=decision?.decided_at?new Date(decision.decided_at).getTime():0;
  const recentRequest=requestedAt>0&&Date.now()-requestedAt<10*60*1000;

  if(requested&&(active>0||(requirements.length===0&&recentRequest&&dead===0)))return <section className="brief-panel"><AnalysisRefresh/><div className="brief-panel-heading"><div><span>GO / NO-GO</span><h2>{active>0?"Analyzing qualification requirements":"Finding the bid package"}</h2></div></div><p className="brief-explainer">Pursuit is locating the solicitation, retrieving qualification-bearing documents and comparing the evidence against your saved company profile. This result updates automatically.</p></section>;

  if(!requested||requirements.length===0)return <section className="brief-panel"><div className="brief-panel-heading"><div><span>GO / NO-GO</span><h2>{requested&&dead>0?"Package analysis needs another attempt":requested?"No qualification evidence extracted":"Run a deep qualification check"}</h2></div></div><p className="brief-explainer">{requested&&dead>0?"One or more source documents could not be retrieved or processed. Re-run the check to retry available sources.":"Pursuit will retrieve the primary solicitation, specifications and relevant addenda only when you ask for this analysis."}</p><form action={`/api/opportunities/${opportunityId}/go-no-go`} method="post"><button className="filter-button" type="submit">{requested?"Re-run GO / NO-GO":"GO / NO-GO"}</button></form></section>;

  const profileTerms=[...(detail?.certifications||[]),...(detail?.contract_vehicles||[]),...(detail?.small_business_statuses||[]),...(detail?.capability_terms||[]),...readiness.map(r=>r.credential_value)].filter(Boolean);
  const normalizedTerms=profileTerms.map(norm).filter(v=>v.length>2);
  const bondingLimit=detail?.bonding_limit==null?null:Number(detail.bonding_limit);
  const confirmed:string[]=[];const risks:string[]=[];const unknown:string[]=[];
  for(const req of requirements){const text=norm(req.requirement_text);const source=`${req.filename}${req.line?` · line ${req.line}`:""}`;
    if(req.category==='bonding'){
      const required=moneyFrom(req.requirement_text);
      if(required!=null&&bondingLimit!=null){if(bondingLimit>=required)confirmed.push(`Bonding capacity meets the stated ${new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(required)} requirement — ${source}`);else risks.push(`Bonding requirement exceeds your saved limit: ${new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(required)} required — ${source}`)}else unknown.push(`Bonding requirement needs profile confirmation — ${source}`);continue;
    }
    if(req.category==='certification'){
      const hit=normalizedTerms.some(term=>term.length>=3&&(text.includes(term)||term.includes(text)));
      if(hit)confirmed.push(`Saved credential appears to satisfy: ${req.requirement_text} — ${source}`);else risks.push(`Potential credential gap: ${req.requirement_text} — ${source}`);continue;
    }
    if(req.category==='insurance'){unknown.push(`Insurance requirement needs policy confirmation: ${req.requirement_text} — ${source}`);continue}
    if(req.category==='site_visit'){unknown.push(`Attendance/action requirement: ${req.requirement_text} — ${source}`);continue}
    if(req.category==='technical'){
      const hit=normalizedTerms.some(term=>term.length>=4&&text.includes(term));
      if(hit)confirmed.push(`Capability evidence aligns with: ${req.requirement_text} — ${source}`);else unknown.push(`Technical requirement needs review: ${req.requirement_text} — ${source}`);continue;
    }
  }
  const confirmedNoGo=risks.some(item=>item.startsWith('Bonding requirement exceeds'));
  const verdict=confirmedNoGo?'NO-GO':risks.length?'REVIEW':confirmed.length?'GO':'REVIEW';
  const assessed=confirmed.length+risks.length;
  const score=assessed?Math.round(100*confirmed.length/assessed):null;
  return <section className="brief-panel"><div className="brief-panel-heading"><div><span>GO / NO-GO</span><h2>{verdict}{score!=null?` · ${score}% confirmed qualification fit`:''}</h2></div></div><p className="brief-explainer">Based only on requirements Pursuit found in the analyzed source documents and qualifications saved in your company profile.</p>{confirmed.length>0&&<div className="brief-list"><strong>Confirmed fit</strong>{confirmed.slice(0,8).map(item=><div key={item}><p>{item}</p></div>)}</div>}{risks.length>0&&<div className="brief-list"><strong>Potential disqualifiers</strong>{risks.slice(0,8).map(item=><div key={item}><p>{item}</p></div>)}</div>}{unknown.length>0&&<div className="brief-list"><strong>Needs review</strong>{unknown.slice(0,8).map(item=><div key={item}><p>{item}</p></div>)}</div>}<div className="profile-actions"><form action={`/api/opportunities/${opportunityId}/go-no-go`} method="post"><button className="filter-button" type="submit">Re-run GO / NO-GO</button></form><form action={`/api/opportunities/${opportunityId}/package`} method="post"><button className="secondary-button" type="submit">Get complete bid package</button></form></div></section>;
}
