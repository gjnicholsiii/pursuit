export const FOUR_STATE_DEMO = "four-state";
export const FOUR_STATE_CODES = ["IN", "OH", "KY", "TN"];

export function isFourStateDemo(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) === FOUR_STATE_DEMO;
}

export function demoHref(path: string, enabled: boolean) {
  if (!enabled) return path;
  return `${path}${path.includes("?") ? "&" : "?"}demo=${FOUR_STATE_DEMO}`;
}
