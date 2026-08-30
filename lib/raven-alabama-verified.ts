export type RavenVerifiedContact = {
  state_code: string;
  county: string | null;
  agency_match: string | null;
  scope: 'state' | 'district';
  role_key: 'state_security_director' | 'security_director' | 'school_board' | 'superintendent' | 'assistant_superintendent' | 'it_director';
  full_name: string;
  title: string;
  email: string | null;
  phone: string | null;
  source_url: string;
  evidence_note: string;
};

export const ALABAMA_VERIFIED_CONTACTS: RavenVerifiedContact[] = [
  {
    state_code: 'AL', county: null, agency_match: null, scope: 'state', role_key: 'state_security_director',
    full_name: 'Erica Butler, Ed.D.', title: 'Education Specialist – Crisis Management and School Safety',
    email: 'erica.butler@alsde.edu', phone: '334-694-4717',
    source_url: 'https://www.alabamaachieves.org/wp-content/uploads/2024/06/StateSuperIn_Memos_20240611_FY24-3027_School-Safety-and-nSide-Training-2024_V1.0.pdf',
    evidence_note: 'ALSDE School Safety Section memo lists Dr. Erica Butler as the school-safety contact.'
  },
  {
    state_code: 'AL', county: 'Autauga', agency_match: 'Autauga County', scope: 'district', role_key: 'superintendent',
    full_name: 'Lyman Woodfin', title: 'Superintendent', email: null, phone: '334-365-5706',
    source_url: 'https://www.acboe.net/superintendentupdate082025',
    evidence_note: 'Official Autauga County Schools superintendent update identifies Lyman Woodfin as superintendent.'
  },
  {
    state_code: 'AL', county: 'Baldwin', agency_match: 'Baldwin County', scope: 'district', role_key: 'superintendent',
    full_name: 'Marty McRae', title: 'Superintendent', email: null, phone: '251-937-0308',
    source_url: 'https://www.bcbe.org/superintendent-senior-staff/superintendent',
    evidence_note: 'Official Baldwin County Public Schools superintendent page identifies Marty McRae and office phone.'
  },
  {
    state_code: 'AL', county: 'Baldwin', agency_match: 'Baldwin County', scope: 'district', role_key: 'assistant_superintendent',
    full_name: 'Joe Sharp', title: 'Assistant Superintendent, Secondary Education', email: null, phone: '251-970-7322',
    source_url: 'https://www.bcbe.org/superintendent-senior-staff/assistant-superintendent-secondary-education',
    evidence_note: 'Official BCPS senior staff page identifies Joe Sharp as Assistant Superintendent, Secondary Education.'
  },
  {
    state_code: 'AL', county: 'Baldwin', agency_match: 'Baldwin County', scope: 'district', role_key: 'assistant_superintendent',
    full_name: 'David Besancon, Ph.D., M.B.A.', title: 'Assistant Superintendent, Educational Technology', email: null, phone: '251-937-0306',
    source_url: 'https://www.bcbe.org/superintendent-senior-staff/assistant-superintendent-educational-technology',
    evidence_note: 'Official BCPS senior staff page identifies David Besancon as Assistant Superintendent, Educational Technology.'
  },
  {
    state_code: 'AL', county: 'Baldwin', agency_match: 'Baldwin County', scope: 'district', role_key: 'security_director',
    full_name: 'Jeff Spaller', title: 'Safety Supervisor', email: null, phone: '251-972-6854',
    source_url: 'https://www.bcbe.org/departments/athletics-prevention-safety/safety',
    evidence_note: 'Official BCPS Safety Department page identifies Jeff Spaller as Safety Supervisor with direct office and cell numbers.'
  },
  {
    state_code: 'AL', county: 'Baldwin', agency_match: 'Baldwin County', scope: 'district', role_key: 'school_board',
    full_name: 'Ken Bradley', title: 'Board Member, District 1', email: null, phone: '251-406-8258',
    source_url: 'https://www.bcbe.org/board-of-education/bcbe-board-members',
    evidence_note: 'Official BCBE board page lists Ken Bradley as District 1 board member.'
  },
  {
    state_code: 'AL', county: 'Baldwin', agency_match: 'Baldwin County', scope: 'district', role_key: 'school_board',
    full_name: 'Andrea Lindsey', title: 'Board Member, District 2', email: null, phone: '251-586-4274',
    source_url: 'https://www.bcbe.org/board-of-education/bcbe-board-members',
    evidence_note: 'Official BCBE board page lists Andrea Lindsey as District 2 board member.'
  },
  {
    state_code: 'AL', county: 'Baldwin', agency_match: 'Baldwin County', scope: 'district', role_key: 'school_board',
    full_name: 'Tony Myrick', title: 'Board President, District 3', email: null, phone: null,
    source_url: 'https://www.bcbe.org/board-of-education/bcbe-board-members',
    evidence_note: 'Official BCBE board page lists Tony Myrick as Board President, District 3.'
  },
  {
    state_code: 'AL', county: 'Baldwin', agency_match: 'Baldwin County', scope: 'district', role_key: 'school_board',
    full_name: 'Rondi Kirby', title: 'Board Member, District 4', email: null, phone: null,
    source_url: 'https://www.bcbe.org/board-of-education/bcbe-board-members',
    evidence_note: 'Official BCBE board page lists Rondi Kirby as District 4 board member.'
  },
  {
    state_code: 'AL', county: 'Baldwin', agency_match: 'Baldwin County', scope: 'district', role_key: 'school_board',
    full_name: 'Jason P. Woerner', title: 'Board Member, District 5', email: null, phone: '251-232-0038',
    source_url: 'https://www.bcbe.org/board-of-education/bcbe-board-members',
    evidence_note: 'Official BCBE board page lists Jason P. Woerner as District 5 board member.'
  },
  {
    state_code: 'AL', county: 'Baldwin', agency_match: 'Baldwin County', scope: 'district', role_key: 'school_board',
    full_name: 'Cecil Christenberry', title: 'Board Member, District 6', email: null, phone: null,
    source_url: 'https://www.bcbe.org/board-of-education/bcbe-board-members',
    evidence_note: 'Official BCBE board page lists Cecil Christenberry as District 6 board member.'
  },
  {
    state_code: 'AL', county: 'Baldwin', agency_match: 'Baldwin County', scope: 'district', role_key: 'school_board',
    full_name: 'April Bradley', title: 'Board Vice President, District 7', email: null, phone: null,
    source_url: 'https://www.bcbe.org/board-of-education/bcbe-board-members',
    evidence_note: 'Official BCBE board page lists April Bradley as Board Vice President, District 7.'
  },
  {
    state_code: 'AL', county: 'Barbour', agency_match: 'Barbour County', scope: 'district', role_key: 'it_director',
    full_name: 'Geoff Jones', title: 'Executive Director of Technology', email: null, phone: '334-775-3453',
    source_url: 'https://www.barbourcountyschools.org/page/technology',
    evidence_note: 'Official Barbour County School District Technology page lists Geoff Jones as Executive Director of Technology.'
  },
  {
    state_code: 'AL', county: 'Bibb', agency_match: 'Bibb County', scope: 'district', role_key: 'school_board',
    full_name: 'Camille Gibson', title: 'Board President', email: 'admin@bibbed.org', phone: '205-926-9881',
    source_url: 'https://www.bibbed.org/our-district/board-of-education/board-members',
    evidence_note: 'Official Bibb County Schools board page lists Camille Gibson as president; district board contact email/phone shown on the same page.'
  },
  {
    state_code: 'AL', county: 'Bibb', agency_match: 'Bibb County', scope: 'district', role_key: 'school_board',
    full_name: 'Elaine Jones', title: 'Board Vice President', email: 'admin@bibbed.org', phone: '205-926-9881',
    source_url: 'https://www.bibbed.org/our-district/board-of-education/board-members',
    evidence_note: 'Official Bibb County Schools board page lists Elaine Jones as vice president; district board contact email/phone shown on the same page.'
  },
  {
    state_code: 'AL', county: 'Bibb', agency_match: 'Bibb County', scope: 'district', role_key: 'school_board',
    full_name: 'Mike McMillan', title: 'Board Member', email: 'admin@bibbed.org', phone: '205-926-9881',
    source_url: 'https://www.bibbed.org/our-district/board-of-education/board-members',
    evidence_note: 'Official Bibb County Schools board page lists Mike McMillan as a board member; district board contact email/phone shown on the same page.'
  },
  {
    state_code: 'AL', county: 'Bibb', agency_match: 'Bibb County', scope: 'district', role_key: 'school_board',
    full_name: 'Morris Moody', title: 'Board Member', email: 'admin@bibbed.org', phone: '205-926-9881',
    source_url: 'https://www.bibbed.org/our-district/board-of-education/board-members',
    evidence_note: 'Official Bibb County Schools board page lists Morris Moody as a board member; district board contact email/phone shown on the same page.'
  },
  {
    state_code: 'AL', county: 'Bibb', agency_match: 'Bibb County', scope: 'district', role_key: 'school_board',
    full_name: 'Cheryl Dodson', title: 'Board Member', email: 'admin@bibbed.org', phone: '205-926-9881',
    source_url: 'https://www.bibbed.org/our-district/board-of-education/board-members',
    evidence_note: 'Official Bibb County Schools board page lists Cheryl Dodson as a board member; district board contact email/phone shown on the same page.'
  },
  {
    state_code: 'AL', county: 'Blount', agency_match: 'Blount County', scope: 'district', role_key: 'superintendent',
    full_name: 'Rodney Green', title: 'Superintendent', email: null, phone: '205-775-1950',
    source_url: 'https://www.blountboe.net/about-us/superintendent',
    evidence_note: 'Official Blount County School District superintendent page identifies Rodney Green as superintendent.'
  },
  {
    state_code: 'AL', county: 'Blount', agency_match: 'Blount County', scope: 'district', role_key: 'it_director',
    full_name: 'Brad Williams', title: 'Technology Director', email: 'bdwilliams@blountboe.net', phone: '205-775-1950',
    source_url: 'https://www.blountboe.net/departments/technology',
    evidence_note: 'Official Blount County School District Technology page lists Brad Williams as Technology Director with email.'
  },
  {
    state_code: 'AL', county: 'Blount', agency_match: 'Blount County', scope: 'district', role_key: 'school_board',
    full_name: 'Chris Latta', title: 'Board Member, President, District V', email: null, phone: '205-775-1950',
    source_url: 'https://www.blountboe.net/about-us/school-board',
    evidence_note: 'Official Blount County School District board page lists Chris Latta as board president, District V.'
  },
  {
    state_code: 'AL', county: 'Blount', agency_match: 'Blount County', scope: 'district', role_key: 'school_board',
    full_name: 'Jackie Sivley', title: 'Board Member, Vice President, District II', email: null, phone: '205-775-1950',
    source_url: 'https://www.blountboe.net/about-us/school-board',
    evidence_note: 'Official Blount County School District board page lists Jackie Sivley as board vice president, District II.'
  },
  {
    state_code: 'AL', county: 'Blount', agency_match: 'Blount County', scope: 'district', role_key: 'school_board',
    full_name: 'Ken Benton', title: 'Board Member, District I', email: null, phone: '205-775-1950',
    source_url: 'https://www.blountboe.net/about-us/school-board',
    evidence_note: 'Official Blount County School District board page lists Ken Benton as District I board member.'
  },
  {
    state_code: 'AL', county: 'Blount', agency_match: 'Blount County', scope: 'district', role_key: 'school_board',
    full_name: 'Dr. Philip Cleveland', title: 'Board Member, District III', email: null, phone: '205-775-1950',
    source_url: 'https://www.blountboe.net/about-us/school-board',
    evidence_note: 'Official Blount County School District board page lists Dr. Philip Cleveland as District III board member.'
  },
  {
    state_code: 'AL', county: 'Blount', agency_match: 'Blount County', scope: 'district', role_key: 'school_board',
    full_name: 'Daniel Smith', title: 'Board Member, District IV', email: null, phone: '205-775-1950',
    source_url: 'https://www.blountboe.net/about-us/school-board',
    evidence_note: 'Official Blount County School District board page lists Daniel Smith as District IV board member.'
  }
];
