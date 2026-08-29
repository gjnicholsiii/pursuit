export type RavenStateSeed = {
  state_code: string;
  county: string | null;
  scope: 'state' | 'county' | 'district';
  role_key: 'state_security_director' | 'security_director' | 'school_board' | 'superintendent' | 'assistant_superintendent' | 'it_director';
  full_name: string;
  title: string;
  email: string | null;
  phone: string | null;
  source_url: string;
  evidence_note: string;
};

export const ALABAMA_STATE_SEEDS: RavenStateSeed[] = [
  {
    state_code: 'AL', county: null, scope: 'state', role_key: 'state_security_director',
    full_name: 'Dr. Johnny H. Whaley', title: 'School Facilities and Safety Administrator',
    email: 'johnny.whaley@alsde.edu', phone: '334-694-0166',
    source_url: 'https://www.alabamaachieves.org/wp-content/uploads/2025/12/SBOE_20251218_School-Security-Act-Presentation_v1.pdf',
    evidence_note: 'ALSDE School Security Act presentation identifies Whaley as School Facilities and Safety Administrator; ALSDE School Facilities page provides direct phone.'
  },
  {
    state_code: 'AL', county: 'Autauga', scope: 'district', role_key: 'superintendent',
    full_name: 'Lyman Woodfin', title: 'Superintendent', email: null, phone: '334-365-5706',
    source_url: 'https://www.acboe.net/superintendent',
    evidence_note: 'Official Autauga County Schools superintendent page; district main phone used because direct email/extension is not published in page text.'
  },
  {
    state_code: 'AL', county: 'Baldwin', scope: 'district', role_key: 'superintendent',
    full_name: 'Marty McRae', title: 'Superintendent', email: null, phone: '251-937-0308',
    source_url: 'https://www.bcbe.org/superintendent-senior-staff/superintendent',
    evidence_note: 'Official Baldwin County Public Schools superintendent page.'
  },
  {
    state_code: 'AL', county: 'Baldwin', scope: 'district', role_key: 'security_director',
    full_name: 'Marty McRae', title: 'Assistant Superintendent of Safety, Prevention, & Athletics', email: null, phone: '251-937-0306',
    source_url: 'https://www.bcbe.org/departments/athletics-prevention-safety',
    evidence_note: 'Official district page explicitly places district safety under this role.'
  },
  {
    state_code: 'AL', county: 'Baldwin', scope: 'district', role_key: 'it_director',
    full_name: 'Dr. David Besancon', title: 'Assistant Superintendent, Educational Technology', email: null, phone: '251-937-0306',
    source_url: 'https://www.bcbe.org/superintendent-senior-staff/assistant-superintendent-educational-technology',
    evidence_note: 'Official district senior staff page; this is the district executive responsible for educational technology.'
  },
  {
    state_code: 'AL', county: 'Baldwin', scope: 'district', role_key: 'school_board',
    full_name: 'Ken Bradley', title: 'Board Member, District 1', email: null, phone: '251-406-8258',
    source_url: 'https://www.bcbe.org/board-of-education/bcbe-board-members',
    evidence_note: 'Official Baldwin County Board of Education member page.'
  },
  {
    state_code: 'AL', county: 'Baldwin', scope: 'district', role_key: 'school_board',
    full_name: 'Andrea Lindsey', title: 'Board Member, District 2', email: null, phone: '251-586-4274',
    source_url: 'https://www.bcbe.org/board-of-education/bcbe-board-members',
    evidence_note: 'Official Baldwin County Board of Education member page.'
  },
  {
    state_code: 'AL', county: 'Baldwin', scope: 'district', role_key: 'school_board',
    full_name: 'Tony Myrick', title: 'Board President, District 3', email: null, phone: null,
    source_url: 'https://www.bcbe.org/board-of-education/bcbe-board-members',
    evidence_note: 'Official Baldwin County Board of Education member page; phone not published in extracted official page text.'
  },
  {
    state_code: 'AL', county: 'Blount', scope: 'district', role_key: 'superintendent',
    full_name: 'Rodney Green', title: 'Superintendent', email: 'rgreen@blountboe.net', phone: '205-775-1950',
    source_url: 'https://www.blountboe.net/link-3',
    evidence_note: 'Official Blount County Schools directory.'
  },
  {
    state_code: 'AL', county: 'Blount', scope: 'district', role_key: 'assistant_superintendent',
    full_name: 'Christopher Lakey', title: 'Assistant Superintendent', email: 'clakey@blountboe.net', phone: '205-775-1950',
    source_url: 'https://www.blountboe.net/link-3',
    evidence_note: 'Official Blount County Schools directory.'
  },
  {
    state_code: 'AL', county: 'Blount', scope: 'district', role_key: 'security_director',
    full_name: 'Meagan Holt', title: 'Federal Programs Coordinator, EL/Migrant Coordinator, Safety Coordinator', email: 'mholt@blountboe.net', phone: '205-775-1950',
    source_url: 'https://www.blountboe.net/link-3',
    evidence_note: 'Official Blount County Schools directory explicitly identifies district Safety Coordinator.'
  },
  {
    state_code: 'AL', county: 'Blount', scope: 'district', role_key: 'it_director',
    full_name: 'Brad Williams', title: 'Technology Director', email: 'bdwilliams@blountboe.net', phone: '205-775-1950',
    source_url: 'https://www.blountboe.net/departments/technology',
    evidence_note: 'Official Blount County Schools technology department page.'
  },
  {
    state_code: 'AL', county: 'Blount', scope: 'district', role_key: 'school_board',
    full_name: 'Chris Latta', title: 'Board Member, President, District V', email: null, phone: '205-775-1950',
    source_url: 'https://www.blountboe.net/about-us/school-board',
    evidence_note: 'Official Blount County Schools board page; district main phone used.'
  },
  {
    state_code: 'AL', county: 'Blount', scope: 'district', role_key: 'school_board',
    full_name: 'Jackie Sivley', title: 'Board Member, Vice President, District II', email: null, phone: '205-775-1950',
    source_url: 'https://www.blountboe.net/about-us/school-board',
    evidence_note: 'Official Blount County Schools board page; district main phone used.'
  },
  {
    state_code: 'AL', county: 'Blount', scope: 'district', role_key: 'school_board',
    full_name: 'Ken Benton', title: 'Board Member, District I', email: null, phone: '205-775-1950',
    source_url: 'https://www.blountboe.net/about-us/school-board',
    evidence_note: 'Official Blount County Schools board page; district main phone used.'
  },
  {
    state_code: 'AL', county: 'Blount', scope: 'district', role_key: 'school_board',
    full_name: 'Dr. Philip Cleveland', title: 'Board Member, District III', email: null, phone: '205-775-1950',
    source_url: 'https://www.blountboe.net/about-us/school-board',
    evidence_note: 'Official Blount County Schools board page; district main phone used.'
  },
  {
    state_code: 'AL', county: 'Blount', scope: 'district', role_key: 'school_board',
    full_name: 'Daniel Smith', title: 'Board Member, District IV', email: null, phone: '205-775-1950',
    source_url: 'https://www.blountboe.net/about-us/school-board',
    evidence_note: 'Official Blount County Schools board page; district main phone used.'
  }
];
