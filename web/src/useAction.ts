import { useState } from "react";

/**
 * Runs a button's API call and tracks it: `pending` while it runs (to disable the button),
 * `error` if it failed (to show next to the button). The result isn't needed: the socket brings the new state.
 */
export function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return { run, pending, error };
}
