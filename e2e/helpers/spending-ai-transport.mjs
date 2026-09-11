// Loaded only by the isolated Playwright backend. Keep production destination
// checks enabled, but route this synthetic public host to the local AI fixture.
import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";

const hostname = "spending-ai.e2e.invalid";
const lookup = dns.lookup;
dns.lookup = async function (host, options) {
  if (host !== hostname) return lookup(host, options);
  const address = { address: "8.8.8.8", family: 4 };
  return options?.all ? [address] : address;
};
syncBuiltinESMExports();

const transport = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.hostname !== hostname) return transport(input, init);
  url.hostname = "127.0.0.1";
  return transport(input instanceof Request ? new Request(url, input) : url, init);
};
