import { timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { SessionUser } from "../shared/types.js";

/**
 * Bot-to-bot access to the web API, for Jarvis (the AI bot in the same server, ../Keith-AI).
 *
 * Jarvis sends the shared key (INTEGRATION_KEY) as `Authorization: Bearer <key>`, and for anything a person asked
 * for, who that person is: `X-Acting-User-Id` and `X-Acting-User-Name`. The request then counts as that person,
 * so the usual checks (DJ role, same voice channel) apply to them: the key never gives more than the person has.
 * Admin routes refuse the key altogether (see `requireOwner()` in access.ts).
 */

export const ACTING_USER_ID_HEADER = "x-acting-user-id";
export const ACTING_USER_NAME_HEADER = "x-acting-user-name";

/** Discord ids (snowflakes) are 17 to 20 digits; anything else in the header is refused. */
const DISCORD_ID = /^\d{15,25}$/;

/** Whether the Authorization header carries the integration key. Always false when no key is set up. */
export function integrationKeyMatches(authorization: string | undefined, key: string | undefined): boolean {
  if (!key || !authorization?.startsWith("Bearer ")) return false;
  const given = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(key);
  // timingSafeEqual takes the same time whatever matches, so the key can't be guessed letter by letter
  // from response times. It needs equal lengths, which leaks only the length.
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * The person a request acts for, if it carries the integration key and names a person; null otherwise (then the
 * request is checked as a normal logged-in website request).
 */
export function integrationUserOf(headers: IncomingHttpHeaders, key: string | undefined): SessionUser | null {
  if (!integrationKeyMatches(headers.authorization, key)) return null;
  const id = headerValue(headers[ACTING_USER_ID_HEADER]);
  if (!id || !DISCORD_ID.test(id)) return null;
  return { id, name: decodedName(headerValue(headers[ACTING_USER_NAME_HEADER])) ?? id, avatarUrl: "" };
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Names are sent URI-encoded, because headers can only hold plain ASCII. */
function decodedName(encoded: string | undefined): string | undefined {
  if (!encoded) return undefined;
  try {
    return decodeURIComponent(encoded).slice(0, 100);
  } catch {
    return undefined;
  }
}
