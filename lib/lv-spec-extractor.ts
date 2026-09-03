import type { Discipline } from "@/lib/low-voltage";

export type SpecMention = {
  manufacturer: string;
  product: string | null;
  discipline: Discipline | null;
  excerpt: string;
  index: number;
};

type SpecRule = {
  manufacturer: string;
  discipline: Discipline;
  manufacturerPattern: RegExp;
  products?: Array<{ product: string; pattern: RegExp }>;
};

const RULES: SpecRule[] = [
  { manufacturer: "Genetec", discipline: "Access Control", manufacturerPattern: /\bgenetec\b|\bsynergis\b/ig, products: [
    { product: "Security Center", pattern: /\bsecurity center\b/ig },
    { product: "Synergis", pattern: /\bsynergis\b/ig },
  ]},
  { manufacturer: "Axis", discipline: "Video Surveillance", manufacturerPattern: /\baxis communications\b|\baxis\b(?=\s+(?:camera|network|p\d|q\d|m\d))/ig },
  { manufacturer: "Mercury", discipline: "Access Control", manufacturerPattern: /\bmercury security\b|\bmercury\b(?=\s+(?:lp|mr|ep))/ig, products: [
    { product: "LP4502", pattern: /\blp[- ]?4502\b/ig },
    { product: "LP1502", pattern: /\blp[- ]?1502\b/ig },
    { product: "LP1501", pattern: /\blp[- ]?1501\b/ig },
    { product: "MR52", pattern: /\bmr[- ]?52\b/ig },
  ]},
  { manufacturer: "HID", discipline: "Access Control", manufacturerPattern: /\bhid global\b|\bhid signo\b|\biclass se\b/ig, products: [
    { product: "Signo", pattern: /\bsigno\s*\d{1,3}\b/ig },
    { product: "iCLASS SE", pattern: /\biclass se\b/ig },
  ]},
  { manufacturer: "LenelS2", discipline: "Access Control", manufacturerPattern: /\blenels2\b|\blenel s2\b|\bonguard\b/ig, products: [
    { product: "OnGuard", pattern: /\bonguard\b/ig },
  ]},
  { manufacturer: "Avigilon", discipline: "Video Surveillance", manufacturerPattern: /\bavigilon\b/ig, products: [
    { product: "Unity Video", pattern: /\bunity video\b/ig },
    { product: "Alta", pattern: /\bavigilon alta\b|\balta video\b/ig },
  ]},
  { manufacturer: "Milestone", discipline: "Video Surveillance", manufacturerPattern: /\bmilestone systems\b|\bxprotect\b/ig, products: [
    { product: "XProtect", pattern: /\bxprotect\b/ig },
  ]},
  { manufacturer: "Verkada", discipline: "Video Surveillance", manufacturerPattern: /\bverkada\b/ig },
  { manufacturer: "Simplex", discipline: "Fire Alarm", manufacturerPattern: /\bsimplex\b/ig, products: [
    { product: "4100ES", pattern: /\b4100es\b/ig },
    { product: "TrueAlarm", pattern: /\btruealarm\b/ig },
  ]},
  { manufacturer: "Notifier", discipline: "Fire Alarm", manufacturerPattern: /\bnotifier\b/ig, products: [
    { product: "NFS2-3030", pattern: /\bnfs2[- ]?3030\b/ig },
  ]},
  { manufacturer: "CommScope", discipline: "Structured Cabling / Fiber", manufacturerPattern: /\bcommscope\b|\bsystimax\b/ig, products: [
    { product: "SYSTIMAX", pattern: /\bsystimax\b/ig },
  ]},
  { manufacturer: "Corning", discipline: "Structured Cabling / Fiber", manufacturerPattern: /\bcorning\b(?=\s+(?:fiber|optical|cable))/ig },
  { manufacturer: "Panduit", discipline: "Structured Cabling / Fiber", manufacturerPattern: /\bpanduit\b/ig },
  { manufacturer: "Q-SYS", discipline: "AV", manufacturerPattern: /\bq-sys\b|\bqsys\b/ig, products: [
    { product: "Core", pattern: /\bcore\s+(?:110f|8 flex|nano)\b/ig },
  ]},
  { manufacturer: "Crestron", discipline: "AV", manufacturerPattern: /\bcrestron\b/ig },
  { manufacturer: "Biamp", discipline: "AV", manufacturerPattern: /\bbiamp\b/ig },
  { manufacturer: "AtlasIED", discipline: "Intercom / Mass Notification", manufacturerPattern: /\batlasied\b|\batlas ied\b/ig },
  { manufacturer: "Rauland", discipline: "Nurse Call", manufacturerPattern: /\brauland\b|\bresponder 5\b/ig, products: [
    { product: "Responder 5", pattern: /\bresponder\s*5\b/ig },
  ]},
  { manufacturer: "Ascom", discipline: "Nurse Call", manufacturerPattern: /\bascom\b/ig },
];

function context(text: string, index: number, matchLength: number) {
  const start = Math.max(0, index - 140);
  const end = Math.min(text.length, index + matchLength + 220);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

export function extractSpecMentions(text: string): SpecMention[] {
  const mentions: SpecMention[] = [];
  const seen = new Set<string>();

  for (const rule of RULES) {
    rule.manufacturerPattern.lastIndex = 0;
    for (const match of text.matchAll(rule.manufacturerPattern)) {
      const index = match.index ?? 0;
      const nearby = text.slice(Math.max(0, index - 220), Math.min(text.length, index + 420));
      const matchedProducts = (rule.products || []).filter(item => {
        item.pattern.lastIndex = 0;
        return item.pattern.test(nearby);
      });
      const products = matchedProducts.length ? matchedProducts.map(item => item.product) : [null];
      for (const product of products) {
        const key = `${rule.manufacturer}|${product || ""}|${Math.floor(index / 250)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        mentions.push({
          manufacturer: rule.manufacturer,
          product,
          discipline: rule.discipline,
          excerpt: context(text, index, match[0].length),
          index,
        });
      }
    }
  }

  return mentions.sort((a, b) => a.index - b.index);
}
