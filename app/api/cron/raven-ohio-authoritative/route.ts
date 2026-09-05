// Ohio OEDS export integration is not yet implemented. Do not burn the scheduled
// statewide slot returning a 503 every ten minutes. Route this cron tick into the
// next untouched authoritative statewide superintendent queue instead.
//
// The Idaho worker starts from the Idaho Department of Education complete district
// roster, then follows only the official district sites linked by that statewide
// roster. When Ohio OEDS POST/export parsing is implemented, restore this route to
// the Ohio worker.
export { GET, dynamic, maxDuration } from "../raven-idaho-authoritative/route";
