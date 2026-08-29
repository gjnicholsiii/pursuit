export type RavenStateSeed = {
  state_code: string;
  county: string | null;
  organization: string;
  scope: 'state' | 'county' | 'district';
  role_key: 'state_security_director' | 'security_director' | 'school_board' | 'superintendent' | 'assistant_superintendent' | 'it_director';
  full_name: string;
  title: string;
  email: string | null;
  phone: string | null;
  source_url: string;
  verification_status: 'verified' | 'candidate';
  evidence_note: string;
};

export const ALABAMA_SEEDS: RavenStateSeed[] = [
  {
    state_code: 'AL', county: 'Autauga', organization: 'Autauga County Schools', scope: 'district', role_key: 'superintendent',
    full_name: 'Lyman Woodfin', title: 'Superintendent', email: null, phone: '334-365-5706',
    source_url: 'https://www.acboe.net/superintendent', verification_status: 'verified',
    evidence_note: 'Current official district superintendent page, crawled August 2026.'
  },
  {
    state_code: 'AL', county: 'Baldwin', organization: 'Baldwin County Public Schools', scope: 'district', role_key: 'superintendent',
    full_name: 'Marty McRae', title: 'Superintendent', email: null, phone: '251-937-0306',
    source_url: 'https://www.bcbe.org/', verification_status: 'verified',
    evidence_note: 'Current official district homepage identifies Marty McRae as superintendent in August 2026.'
  },
  {
    state_code: 'AL', county: 'Baldwin', organization: 'Baldwin County Public Schools', scope: 'district', role_key: 'security_director',
    full_name: 'Jeff Spaller', title: 'Safety Supervisor', email: null, phone: '251-972-6854',
    source_url: 'https://www.bcbe.org/departments/athletics-prevention-safety/safety', verification_status: 'verified',
    evidence_note: 'Current official Safety Department contact page; title directly owns school safety.'
  },
  {
    state_code: 'AL', county: 'Baldwin', organization: 'Baldwin County Public Schools', scope: 'district', role_key: 'assistant_superintendent',
    full_name: 'Joe Sharp', title: 'Assistant Superintendent, Secondary Education', email: null, phone: '251-970-7322',
    source_url: 'https://www.bcbe.org/superintendent-senior-staff/assistant-superintendent-secondary-education', verification_status: 'verified',
    evidence_note: 'Current official senior staff page.'
  },
  {
    state_code: 'AL', county: 'Baldwin', organization: 'Baldwin County Public Schools', scope: 'district', role_key: 'it_director',
    full_name: 'David Besancon', title: 'Assistant Superintendent, Educational Technology', email: null, phone: '251-937-0306',
    source_url: 'https://www.bcbe.org/superintendent-senior-staff/assistant-superintendent-educational-technology', verification_status: 'verified',
    evidence_note: 'Current official senior staff page; executive owner of district educational technology.'
  },
  {
    state_code: 'AL', county: 'Baldwin', organization: 'Baldwin County Board of Education', scope: 'district', role_key: 'school_board',
    full_name: 'Ken Bradley', title: 'Board Member, District 1', email: null, phone: '251-406-8258',
    source_url: 'https://www.bcbe.org/board-of-education/bcbe-board-members', verification_status: 'verified',
    evidence_note: 'Current official board-member page; term 2024-2030.'
  },
  {
    state_code: 'AL', county: 'Baldwin', organization: 'Baldwin County Board of Education', scope: 'district', role_key: 'school_board',
    full_name: 'April Bradley', title: 'Board Vice President, District 7', email: null, phone: null,
    source_url: 'https://www.bcbe.org/board-of-education/bcbe-board-members', verification_status: 'verified',
    evidence_note: 'Current official board-member page; term 2022-2028.'
  },
  {
    state_code: 'AL', county: 'Blount', organization: 'Blount County Schools', scope: 'district', role_key: 'superintendent',
    full_name: 'Rodney Green', title: 'Superintendent', email: null, phone: '205-775-1950',
    source_url: 'https://www.blountboe.net/about-us/superintendent', verification_status: 'verified',
    evidence_note: 'Current official superintendent page, crawled August 2026.'
  },
  {
    state_code: 'AL', county: 'Blount', organization: 'Blount County Schools', scope: 'district', role_key: 'it_director',
    full_name: 'Brad Williams', title: 'Technology Director', email: 'bdwilliams@blountboe.net', phone: '205-775-1950',
    source_url: 'https://www.blountboe.net/departments/technology', verification_status: 'verified',
    evidence_note: 'Current official Technology department staff page.'
  },
  {
    state_code: 'AL', county: 'Blount', organization: 'Blount County Schools', scope: 'district', role_key: 'security_director',
    full_name: 'Meagan Holt', title: 'Federal Programs Coordinator, EL/Migrant Coordinator, Safety Coordinator', email: 'mholt@blountboe.net', phone: '205-775-1950',
    source_url: 'https://www.blountboe.net/link-3', verification_status: 'verified',
    evidence_note: 'Current official district directory explicitly lists Safety Coordinator responsibility.'
  },
  {
    state_code: 'AL', county: 'Blount', organization: 'Blount County Board of Education', scope: 'district', role_key: 'school_board',
    full_name: 'Chris Latta', title: 'Board Member, President, District V', email: null, phone: '205-775-1950',
    source_url: 'https://www.blountboe.net/about-us/school-board', verification_status: 'verified',
    evidence_note: 'Current official school-board page.'
  },
  {
    state_code: 'AL', county: 'Blount', organization: 'Blount County Board of Education', scope: 'district', role_key: 'school_board',
    full_name: 'Jackie Sivley', title: 'Board Member, Vice President, District II', email: null, phone: '205-775-1950',
    source_url: 'https://www.blountboe.net/about-us/school-board', verification_status: 'verified',
    evidence_note: 'Current official school-board page.'
  },
  {
    state_code: 'AL', county: 'Blount', organization: 'Blount County Board of Education', scope: 'district', role_key: 'school_board',
    full_name: 'Ken Benton', title: 'Board Member, District I', email: null, phone: '205-775-1950',
    source_url: 'https://www.blountboe.net/about-us/school-board', verification_status: 'verified',
    evidence_note: 'Current official school-board page.'
  },
  {
    state_code: 'AL', county: 'Blount', organization: 'Blount County Board of Education', scope: 'district', role_key: 'school_board',
    full_name: 'Dr. Philip Cleveland', title: 'Board Member, District III', email: null, phone: '205-775-1950',
    source_url: 'https://www.blountboe.net/about-us/school-board', verification_status: 'verified',
    evidence_note: 'Current official school-board page.'
  },
  {
    state_code: 'AL', county: 'Blount', organization: 'Blount County Board of Education', scope: 'district', role_key: 'school_board',
    full_name: 'Daniel Smith', title: 'Board Member, District IV', email: null, phone: '205-775-1950',
    source_url: 'https://www.blountboe.net/about-us/school-board', verification_status: 'verified',
    evidence_note: 'Current official school-board page.'
  },
  {
    state_code: 'AL', county: null, organization: 'Alabama State Department of Education', scope: 'state', role_key: 'state_security_director',
    full_name: 'Ayanna Long', title: 'Education Administrator - School Safety', email: null, phone: '334-694-4717',
    source_url: 'https://www.alabamaachieves.org/wp-content/uploads/2024/02/COMM_2024112_DAPS-2024_V1.0.pdf', verification_status: 'candidate',
    evidence_note: 'Official ALSDE directory identifies School Safety responsibility, but the named directory is 2024 and requires current-source reconfirmation before VERIFIED status.'
  }
];
