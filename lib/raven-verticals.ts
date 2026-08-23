export type RavenVertical = {
  key: string;
  label: string;
  description: string;
  organizationTypes: string[];
  buyerRoles: string[];
  sourcePlan: string[];
  status: 'live' | 'building';
};

export const RAVEN_VERTICALS: RavenVertical[] = [
  {
    key: 'k12',
    label: 'K-12',
    description: 'Public school districts, charter agencies and education service organizations.',
    organizationTypes: ['k12'],
    buyerRoles: ['IT Director', 'CTO', 'CIO', 'Director of Technology', 'Director of Safety / Security', 'Facilities Director', 'Superintendent', 'Procurement', 'Board Member'],
    sourcePlan: ['NCES / existing Pursuit agencies', 'District staff directories', 'Board pages and packets', 'Pursuit bids and awards'],
    status: 'live',
  },
  {
    key: 'higher-ed',
    label: 'Higher Education',
    description: 'Public and private colleges, universities and systems.',
    organizationTypes: ['higher_ed', 'education'],
    buyerRoles: ['CIO', 'CISO', 'Director of Public Safety', 'Security Director', 'Facilities', 'Procurement', 'AV / Infrastructure Leadership'],
    sourcePlan: ['IPEDS', 'University directories', 'Capital plans', 'Pursuit bids and awards'],
    status: 'live',
  },
  {
    key: 'fortune',
    label: 'Fortune 1000 / Enterprise',
    description: 'Large enterprises with meaningful physical-security and infrastructure spend.',
    organizationTypes: [],
    buyerRoles: ['Chief Security Officer', 'VP Security', 'Director of Corporate Security', 'CISO', 'Facilities', 'Real Estate', 'Procurement'],
    sourcePlan: ['Public company filings', 'Corporate leadership pages', 'Facilities and security announcements', 'Job and expansion signals'],
    status: 'building',
  },
  {
    key: 'retail',
    label: 'Retail Chains',
    description: 'Multi-location retailers and national store networks.',
    organizationTypes: [],
    buyerRoles: ['VP Asset Protection', 'Director of Loss Prevention', 'Security Director', 'Facilities', 'Construction', 'IT Infrastructure'],
    sourcePlan: ['Public chain directories', 'Corporate sites', 'Store expansion data', 'Security and construction signals'],
    status: 'building',
  },
  {
    key: 'convenience',
    label: 'Convenience / Fuel',
    description: 'Convenience-store, fuel and travel-center chains.',
    organizationTypes: [],
    buyerRoles: ['VP Operations', 'Asset Protection', 'Security', 'Facilities', 'Construction', 'IT'],
    sourcePlan: ['Chain location datasets', 'Corporate sites', 'Expansion announcements', 'Security technology signals'],
    status: 'building',
  },
  {
    key: 'healthcare',
    label: 'Healthcare',
    description: 'Health systems, hospitals and large ambulatory networks.',
    organizationTypes: [],
    buyerRoles: ['Security Director', 'VP Facilities', 'CIO', 'CISO', 'Emergency Management', 'Clinical Communications', 'Procurement'],
    sourcePlan: ['CMS / public provider datasets', 'Health-system sites', 'Capital plans', 'Pursuit and public procurement'],
    status: 'building',
  },
  {
    key: 'hospitality',
    label: 'Hospitality',
    description: 'Hotel ownership groups, management companies and major brands.',
    organizationTypes: [],
    buyerRoles: ['Corporate Security', 'Risk', 'IT', 'Facilities', 'Engineering', 'Procurement'],
    sourcePlan: ['Brand and ownership directories', 'Property portfolios', 'Renovation / construction signals'],
    status: 'building',
  },
  {
    key: 'government',
    label: 'State / Local Government',
    description: 'States, counties, municipalities, authorities, airports and public agencies.',
    organizationTypes: ['state_agency', 'local_government', 'municipality', 'municipal', 'county', 'authority', 'state', 'local'],
    buyerRoles: ['CIO', 'IT Director', 'Security', 'Facilities', 'Public Safety', 'Procurement', 'Capital Projects'],
    sourcePlan: ['Existing Pursuit agencies', 'Agency directories', 'Board / council records', 'Pursuit bids and awards'],
    status: 'live',
  },
  {
    key: 'integrators',
    label: 'Security / Low-Voltage Integrators',
    description: 'Security, low-voltage, fire, AV, nurse-call and building-systems integrators.',
    organizationTypes: [],
    buyerRoles: ['Owner', 'Founder', 'President', 'CEO', 'COO', 'VP Sales', 'General Manager'],
    sourcePlan: ['Manufacturer partner directories', 'State contractor licenses', 'Trade associations', 'Company leadership pages', 'Award history'],
    status: 'building',
  },
  {
    key: 'ae-consultants',
    label: 'A/E / Security Consultants',
    description: 'Architects, engineers, specifiers and independent security consultants influencing technology choices.',
    organizationTypes: [],
    buyerRoles: ['Principal', 'Partner', 'Security Consultant', 'Technology Designer', 'Electrical Engineer', 'Specification Writer'],
    sourcePlan: ['Professional directories', 'Project documents', 'Bid specifications', 'Award and consultant history'],
    status: 'building',
  },
];

export function getRavenVertical(key?: string) {
  return RAVEN_VERTICALS.find(v => v.key === key) || RAVEN_VERTICALS[0];
}
