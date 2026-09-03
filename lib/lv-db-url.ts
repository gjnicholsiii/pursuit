export function getLowVoltageDatabaseUrl() {
  const value = process.env.LOW_VOLTAGE_DATABASE_URL?.trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") return null;
    return value;
  } catch {
    return null;
  }
}

export function lowVoltageDatabaseUrlIsValid() {
  return Boolean(getLowVoltageDatabaseUrl());
}
