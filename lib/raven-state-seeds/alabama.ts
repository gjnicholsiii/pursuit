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
    evidence_note: 'ALSDE School Security Act presentation identifies Whaley on the Support Services School Safety Team as School Facilities and Safety Administrator; April 9, 2026 ALSDE safety correspondence confirms his direct email.'
  },
  {
    state_code: 'AL', county: 'Autauga', scope: 'district', role_key: 'superintendent',
    full_name: 'Lyman Woodfin', title: 'Superintendent', email: null, phone: '334-365-5706',
    source_url: 'https://www.acboe.net/superintendent',
    evidence_note: 'Current official Autauga County Schools superintendent page; district main phone used because direct email/extension is not published in page text.'
  },
  {
    state_code: 'AL', county: 'Autauga', scope: 'district', role_key: 'school_board',
    full_name: 'Jamie Jackson', title: 'Board Chairman', email: 'jamie.jackson@acboe.net', phone: '334-365-5706',
    source_url: 'https://www.acboe.net/boardvacancy',
    evidence_note: 'Official Autauga County Schools 2025 board-vacancy notice identifies Jamie Jackson as Board Chairman and publishes his direct district email.'
  },
  {
    state_code: 'AL', county: 'Autauga', scope: 'district', role_key: 'school_board',
    full_name: 'Bradley D. Robbins', title: 'District 1 Board Member', email: null, phone: '334-365-5706',
    source_url: 'https://www.acboe.net/sys/content/newspost/2d57620e4ac14768b8e48be691d8db7a',
    evidence_note: 'Official Autauga County Schools appointment announcement identifies Bradley D. Robbins as the current District 1 board member.'
  },
  {
    state_code: 'AL', county: 'Baldwin', scope: 'district', role_key: 'superintendent',
    full_name: 'Marty McRae', title: 'Superintendent', email: null, phone: '251-937-0308',
    source_url: 'https://www.bcbe.org/superintendent-senior-staff/superintendent',
    evidence_note: 'Current official Baldwin County Public Schools superintendent page; page states McRae transitioned from interim superintendent to superintendent effective immediately.'
  },
  {
    state_code: 'AL', county: 'Baldwin', scope: 'district', role_key: 'assistant_superintendent',
    full_name: 'Joe Sharp', title: 'Assistant Superintendent, Secondary Education', email: null, phone: '251-937-0306',
    source_url: 'https://www.bcbe.org/superintendent-senior-staff/assistant-superintendent-secondary-education',
    evidence_note: 'Current official Baldwin County Public Schools senior-staff page.'
  },
  {
    state_code: 'AL', county: 'Baldwin', scope: 'district', role_key: 'it_director',
    full_name: 'Dr. David Besancon', title: 'Assistant Superintendent, Educational Technology', email: null, phone: '251-937-0306',
    source_url: 'https://www.bcbe.org/superintendent-senior-staff/assistant-superintendent-educational-technology',
    evidence_note: 'Current official district senior-staff page identifies the executive responsible for Educational Technology; an official BCBE handbook identifies David Besancon as Ed Technology Director.'
  },
  { state_code:'AL', county:'Baldwin', scope:'district', role_key:'school_board', full_name:'Ken Bradley', title:'Board Member, District 1', email:null, phone:'251-406-8258', source_url:'https://www.bcbe.org/board-of-education/bcbe-board-members', evidence_note:'Current official Baldwin County Board of Education member page.' },
  { state_code:'AL', county:'Baldwin', scope:'district', role_key:'school_board', full_name:'Andrea Lindsey', title:'Board Member, District 2', email:null, phone:'251-586-4274', source_url:'https://www.bcbe.org/board-of-education/bcbe-board-members', evidence_note:'Current official Baldwin County Board of Education member page.' },
  { state_code:'AL', county:'Baldwin', scope:'district', role_key:'school_board', full_name:'Tony Myrick', title:'Board President, District 3', email:null, phone:null, source_url:'https://www.bcbe.org/board-of-education/bcbe-board-members', evidence_note:'Current official Baldwin County Board of Education member page.' },
  { state_code:'AL', county:'Baldwin', scope:'district', role_key:'school_board', full_name:'Rondi Kirby', title:'Board Member, District 4', email:null, phone:null, source_url:'https://www.bcbe.org/board-of-education/bcbe-board-members', evidence_note:'Current official Baldwin County Board of Education member page.' },
  { state_code:'AL', county:'Baldwin', scope:'district', role_key:'school_board', full_name:'Jason P. Woerner', title:'Board Member, District 5', email:null, phone:'251-232-0038', source_url:'https://www.bcbe.org/board-of-education/bcbe-board-members', evidence_note:'Current official Baldwin County Board of Education member page.' },
  { state_code:'AL', county:'Baldwin', scope:'district', role_key:'school_board', full_name:'Cecil Christenberry', title:'Board Member, District 6', email:null, phone:null, source_url:'https://www.bcbe.org/board-of-education/bcbe-board-members', evidence_note:'Current official Baldwin County Board of Education member page.' },
  { state_code:'AL', county:'Baldwin', scope:'district', role_key:'school_board', full_name:'April Bradley', title:'Board Vice President, District 7', email:null, phone:null, source_url:'https://www.bcbe.org/board-of-education/bcbe-board-members', evidence_note:'Current official Baldwin County Board of Education member page.' },
  {
    state_code: 'AL', county: 'Bibb', scope: 'district', role_key: 'superintendent',
    full_name: 'Kevin Cotner', title: 'Superintendent', email: 'cotnerk@bibbed.org', phone: '205-926-9881',
    source_url: 'https://www.bibbed.org/our-district/superintendent',
    evidence_note: 'Current official Bibb County Schools superintendent/staff profile.'
  },
  { state_code:'AL', county:'Bibb', scope:'district', role_key:'school_board', full_name:'Camille Gibson', title:'Board President', email:null, phone:'205-926-9881', source_url:'https://www.bibbed.org/our-district/board-of-education/board-members', evidence_note:'Current official Bibb County Schools board roster.' },
  { state_code:'AL', county:'Bibb', scope:'district', role_key:'school_board', full_name:'Elaine Jones', title:'Board Vice President', email:null, phone:'205-926-9881', source_url:'https://www.bibbed.org/our-district/board-of-education/board-members', evidence_note:'Current official Bibb County Schools board roster.' },
  { state_code:'AL', county:'Bibb', scope:'district', role_key:'school_board', full_name:'Mike McMillan', title:'Board Member', email:null, phone:'205-926-9881', source_url:'https://www.bibbed.org/our-district/board-of-education/board-members', evidence_note:'Current official Bibb County Schools board roster.' },
  { state_code:'AL', county:'Bibb', scope:'district', role_key:'school_board', full_name:'Morris Moody', title:'Board Member', email:null, phone:'205-926-9881', source_url:'https://www.bibbed.org/our-district/board-of-education/board-members', evidence_note:'Current official Bibb County Schools board roster.' },
  { state_code:'AL', county:'Bibb', scope:'district', role_key:'school_board', full_name:'Cheryl Dodson', title:'Board Member', email:null, phone:'205-926-9881', source_url:'https://www.bibbed.org/our-district/board-of-education/board-members', evidence_note:'Current official Bibb County Schools board roster.' },
  {
    state_code: 'AL', county: 'Blount', scope: 'district', role_key: 'superintendent',
    full_name: 'Rodney Green', title: 'Superintendent', email: 'rgreen@blountboe.net', phone: '205-775-1950',
    source_url: 'https://www.blountboe.net/link-3', evidence_note: 'Official Blount County Schools directory.'
  },
  { state_code:'AL', county:'Blount', scope:'district', role_key:'assistant_superintendent', full_name:'Christopher Lakey', title:'Assistant Superintendent', email:'clakey@blountboe.net', phone:'205-775-1950', source_url:'https://www.blountboe.net/link-3', evidence_note:'Official Blount County Schools directory.' },
  { state_code:'AL', county:'Blount', scope:'district', role_key:'security_director', full_name:'Meagan Holt', title:'Federal Programs Coordinator, EL/Migrant Coordinator, Safety Coordinator', email:'mholt@blountboe.net', phone:'205-775-1950', source_url:'https://www.blountboe.net/link-3', evidence_note:'Official Blount County Schools directory explicitly identifies district Safety Coordinator.' },
  { state_code:'AL', county:'Blount', scope:'district', role_key:'it_director', full_name:'Brad Williams', title:'Technology Director', email:'bdwilliams@blountboe.net', phone:'205-775-1950', source_url:'https://www.blountboe.net/departments/technology', evidence_note:'Official Blount County Schools technology department page.' },
  { state_code:'AL', county:'Blount', scope:'district', role_key:'school_board', full_name:'Chris Latta', title:'Board Member, President, District V', email:null, phone:'205-775-1950', source_url:'https://www.blountboe.net/about-us/school-board', evidence_note:'Official Blount County Schools board page; district main phone used.' },
  { state_code:'AL', county:'Blount', scope:'district', role_key:'school_board', full_name:'Jackie Sivley', title:'Board Member, Vice President, District II', email:null, phone:'205-775-1950', source_url:'https://www.blountboe.net/about-us/school-board', evidence_note:'Official Blount County Schools board page; district main phone used.' },
  { state_code:'AL', county:'Blount', scope:'district', role_key:'school_board', full_name:'Ken Benton', title:'Board Member, District I', email:null, phone:'205-775-1950', source_url:'https://www.blountboe.net/about-us/school-board', evidence_note:'Official Blount County Schools board page; district main phone used.' },
  { state_code:'AL', county:'Blount', scope:'district', role_key:'school_board', full_name:'Dr. Philip Cleveland', title:'Board Member, District III', email:null, phone:'205-775-1950', source_url:'https://www.blountboe.net/about-us/school-board', evidence_note:'Official Blount County Schools board page; district main phone used.' },
  { state_code:'AL', county:'Blount', scope:'district', role_key:'school_board', full_name:'Daniel Smith', title:'Board Member, District IV', email:null, phone:'205-775-1950', source_url:'https://www.blountboe.net/about-us/school-board', evidence_note:'Official Blount County Schools board page; district main phone used.' }
];
