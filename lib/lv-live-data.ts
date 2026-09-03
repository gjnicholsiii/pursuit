import { neon } from "@neondatabase/serverless";
import {
  disciplines,
  incumbents as seedIncumbents,
  pursuits as seedPursuits,
  rebids as seedRebids,
  signals as seedSignals,
  specs as seedSpecs,
  type Discipline,
  type Incumbent,
  type Pursuit,
  type Rebid,
  type Signal,
  type SpecRecord,
} from "@/lib/low-voltage";

type Row = Record<string, unknown>;

function db() {
  const url = process.env.LOW_VOLTAGE_DATABASE_URL;
  return url && /^postgres(?:ql)?:\/\//i.test(url) ? neon(url) : null;
}

function asRows(value: unknown) {
  return value as Row[];
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function num(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function dateLabel(value: unknown) {
  const raw = text(value);
  if (!raw) return "Not stated";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw.slice(0, 10);
  return date.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
}

function monthYear(value: unknown) {
  const raw = text(value);
  if (!raw) return "Unknown";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw.slice(0, 10);
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function discipline(value: unknown): Discipline | null {
  const raw = text(value);
  return (disciplines as readonly string[]).includes(raw) ? raw as Discipline : null;
}

function disciplineArray(value: unknown): Discipline[] {
  if (!Array.isArray(value)) return [];
  return value.map(discipline).filter(Boolean) as Discipline[];
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(item => text(item)).filter(Boolean) : [];
}

export function liveDatabaseConfigured() {
  const url = process.env.LOW_VOLTAGE_DATABASE_URL;
  return Boolean(url && /^postgres(?:ql)?:\/\//i.test(url));
}

export async function getSignalsData(): Promise<Signal[]> {
  const sql = db();
  if (!sql) return seedSignals;
  try {
    const result = asRows(await sql`
      select
        s.id,
        o.organization_name,
        coalesce(p.location_text, o.state, '') as location,
        p.estimated_value,
        s.trigger_summary,
        s.score,
        s.confidence,
        s.buying_window,
        e.excerpt,
        (
          select pd.discipline
          from project_disciplines pd
          where pd.project_id = p.id
          order by pd.confidence desc
          limit 1
        ) as discipline
      from signals s
      join projects p on p.id = s.project_id
      join organizations o on o.id = p.organization_id
      join source_evidence e on e.id = s.evidence_id
      order by s.score desc, s.detected_at desc
      limit 250
    `);
    return result.map(row => {
      const d = discipline(row.discipline);
      if (!d) return null;
      return {
        id: `SIG-${row.id}`,
        organization: text(row.organization_name, "Unknown owner"),
        location: text(row.location, "Unknown"),
        discipline: d,
        trigger: text(row.trigger_summary, "Detected low-voltage activity"),
        evidence: text(row.excerpt, text(row.trigger_summary)),
        estimatedValue: num(row.estimated_value),
        buyingWindow: text(row.buying_window, "Unknown"),
        confidence: text(row.confidence, "LOW") as Signal["confidence"],
        score: num(row.score),
      } satisfies Signal;
    }).filter(Boolean) as Signal[];
  } catch {
    return [];
  }
}

export async function getPursuitsData(): Promise<Pursuit[]> {
  const sql = db();
  if (!sql) return seedPursuits;
  try {
    const result = asRows(await sql`
      select
        pu.id,
        o.organization_name,
        p.project_title,
        coalesce(p.location_text, o.state, '') as location,
        p.estimated_value,
        pu.due_at,
        pu.fit_score,
        pu.incumbent_text,
        pu.engineer_text,
        pu.prebid_requirement,
        pu.document_count,
        coalesce((select array_agg(pd.discipline order by pd.discipline) from project_disciplines pd where pd.project_id = p.id), '{}') as disciplines,
        coalesce((select array_agg(distinct sm.manufacturer order by sm.manufacturer) from spec_mentions sm where sm.project_id = p.id), '{}') as specified
      from pursuits pu
      join projects p on p.id = pu.project_id
      join organizations o on o.id = p.organization_id
      where pu.status = 'open'
      order by pu.fit_score desc nulls last, pu.due_at asc nulls last
      limit 250
    `);
    return result.map(row => {
      const ds = disciplineArray(row.disciplines);
      if (!ds.length) return null;
      return {
        id: `PUR-${row.id}`,
        organization: text(row.organization_name, "Unknown owner"),
        title: text(row.project_title, "Low-voltage opportunity"),
        location: text(row.location, "Unknown"),
        disciplines: ds,
        dueDate: dateLabel(row.due_at),
        estimatedValue: num(row.estimated_value),
        fit: num(row.fit_score),
        incumbent: text(row.incumbent_text) || undefined,
        specified: stringArray(row.specified),
        engineer: text(row.engineer_text) || undefined,
        preBid: text(row.prebid_requirement) || undefined,
        documents: num(row.document_count),
      } satisfies Pursuit;
    }).filter(Boolean) as Pursuit[];
  } catch {
    return [];
  }
}

export async function getRebidsData(): Promise<Rebid[]> {
  const sql = db();
  if (!sql) return seedRebids;
  try {
    const result = asRows(await sql`
      select
        c.id,
        o.organization_name,
        coalesce(o.state, o.organization_type, 'Federal') as location,
        c.contract_title,
        c.incumbent_name,
        c.award_value,
        c.current_end_date,
        rp.probability,
        rp.procurement_window,
        coalesce((select array_agg(cd.discipline order by cd.discipline) from contract_disciplines cd where cd.contract_id = c.id), '{}') as disciplines
      from contracts c
      join organizations o on o.id = c.organization_id
      left join lateral (
        select probability, procurement_window
        from rebid_predictions x
        where x.contract_id = c.id
        order by x.generated_at desc
        limit 1
      ) rp on true
      order by rp.probability desc nulls last, c.current_end_date asc nulls last
      limit 250
    `);
    return result.map(row => {
      const ds = disciplineArray(row.disciplines);
      if (!ds.length) return null;
      return {
        id: `REB-${row.id}`,
        organization: text(row.organization_name, "Unknown owner"),
        title: text(row.contract_title, "Low-voltage contract"),
        location: text(row.location, "Unknown"),
        incumbent: text(row.incumbent_name, "Unknown incumbent"),
        contractValue: num(row.award_value),
        currentEnd: monthYear(row.current_end_date),
        procurementWindow: text(row.procurement_window, "Unknown"),
        probability: num(row.probability),
        disciplines: ds,
      } satisfies Rebid;
    }).filter(Boolean) as Rebid[];
  } catch {
    return [];
  }
}

export async function getIncumbentsData(): Promise<Incumbent[]> {
  const sql = db();
  if (!sql) return seedIncumbents;
  try {
    const result = asRows(await sql`
      select
        c.incumbent_name,
        count(*)::int as contracts,
        coalesce(sum(c.award_value), 0) as identified_value,
        coalesce(array_agg(distinct o.organization_type) filter (where o.organization_type is not null), '{}') as markets
      from contracts c
      join organizations o on o.id = c.organization_id
      group by c.incumbent_name
      order by identified_value desc
      limit 200
    `);
    return result.map(row => ({
      contractor: text(row.incumbent_name, "Unknown incumbent"),
      identifiedValue: num(row.identified_value),
      contracts: num(row.contracts),
      markets: stringArray(row.markets),
      technologies: [],
    } satisfies Incumbent));
  } catch {
    return [];
  }
}

export async function getSpecsData(): Promise<SpecRecord[]> {
  const sql = db();
  if (!sql) return seedSpecs;
  try {
    const result = asRows(await sql`
      with per_project as (
        select distinct
          sm.manufacturer,
          sm.product,
          sm.project_id,
          p.project_stage,
          p.estimated_value
        from spec_mentions sm
        join projects p on p.id = sm.project_id
      )
      select
        manufacturer,
        product,
        count(*)::int as active_projects,
        count(*) filter (where project_stage = 'pre_rfp')::int as pre_rfp_projects,
        coalesce(sum(estimated_value), 0) as estimated_project_value
      from per_project
      group by manufacturer, product
      order by active_projects desc, estimated_project_value desc
      limit 200
    `);
    return result.map(row => ({
      manufacturer: text(row.manufacturer, "Unknown"),
      product: text(row.product) || undefined,
      activeProjects: num(row.active_projects),
      preRfpProjects: num(row.pre_rfp_projects),
      estimatedProjectValue: num(row.estimated_project_value),
      momentum: 0,
      pairedWith: [],
    } satisfies SpecRecord));
  } catch {
    return [];
  }
}

export async function getAllLVData() {
  const [signals, pursuits, rebids, incumbents, specs] = await Promise.all([
    getSignalsData(),
    getPursuitsData(),
    getRebidsData(),
    getIncumbentsData(),
    getSpecsData(),
  ]);
  return { signals, pursuits, rebids, incumbents, specs, live: liveDatabaseConfigured() };
}
