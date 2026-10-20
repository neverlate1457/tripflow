type CryptoSource = Pick<Crypto, "getRandomValues"> &
  Partial<Pick<Crypto, "randomUUID">>;
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function generateId(source?: CryptoSource): string {
  const value = source ?? globalThis.crypto;
  if (typeof value?.randomUUID === "function")
    return value.randomUUID.call(value);
  if (typeof value?.getRandomValues !== "function")
    throw new Error("SECURE_RANDOM_UNAVAILABLE");
  const bytes = new Uint8Array(16);
  value.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function isUuidV4(value: string) {
  return UUID_V4.test(value);
}
