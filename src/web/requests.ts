import type { IncomingMessage } from "node:http";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Whether a request came straight from this computer (http://localhost:<WEB_PORT>), rather than through the
 * public URL. Tailscale Funnel delivers public requests to this server from this computer too, but it adds
 * `X-Forwarded-For` and keeps the public host name (`<pc>.<tailnet>.ts.net`) in the `Host` header.
 */
export function isLocalRequest(req: IncomingMessage): boolean {
  const forwarded = req.headers["x-forwarded-for"] !== undefined || req.headers["x-forwarded-host"] !== undefined;
  const hostName = (req.headers.host ?? "").replace(/:\d+$/, "");
  return !forwarded && LOCAL_HOSTS.has(hostName);
}
