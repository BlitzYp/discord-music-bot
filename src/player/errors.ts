/** An error whose message is safe and useful to show to the user as-is. */
export class UserError extends Error {
  override name = "UserError";
}
