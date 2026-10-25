import { useEffect, useState } from "react";

/** The current time, updated every `intervalMs`. Used to move the progress bar smoothly between updates. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
