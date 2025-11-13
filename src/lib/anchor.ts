// swap stubAnchor() with real RPC later
export async function anchor(): Promise<string> {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return "0x" + Array.from(b).map(x => x.toString(16).padStart(2, "0")).join("");
}
