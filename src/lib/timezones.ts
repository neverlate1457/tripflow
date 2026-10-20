const COMMON = [
  "Asia/Taipei",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Hong_Kong",
  "Asia/Singapore",
  "Asia/Bangkok",
];
const FALLBACK = [...COMMON, "UTC", "Europe/London", "America/New_York", "America/Los_Angeles", "Australia/Sydney"];

export function supportedTimezones(source: typeof Intl = Intl) {
  const values = typeof source.supportedValuesOf === "function"
    ? source.supportedValuesOf("timeZone")
    : FALLBACK;
  return [...new Set([...COMMON, ...values])];
}
export function isValidTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch { return false; }
}
export function timezoneOffsetLabel(timezone: string, date: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "longOffset",
  }).formatToParts(new Date(`${date}T12:00:00Z`));
  return (parts.find((part) => part.type === "timeZoneName")?.value ?? "UTC").replace("GMT", "UTC");
}
