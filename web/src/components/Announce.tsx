import { type FormEvent, useId, useState } from "react";
import * as api from "../api";
import { MAX_ANNOUNCEMENT_LENGTH } from "../shared";
import { useAction } from "../useAction";

/**
 * "Announce": the bot says the typed text in the voice channel (text-to-speech), the same as /announce in Discord.
 * The song pauses for it and then continues. Only shown to DJs.
 */
export function Announce({ guildId, announcing }: { guildId: string; announcing: boolean }) {
  const textId = useId();
  const [text, setText] = useState("");
  const { run, pending, error } = useAction();
  const isEmpty = text.trim() === "";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (isEmpty) return;
    await run(async () => {
      // Answers once the bot has said it, so the button stays on "Speaking…" until then.
      await api.announce(guildId, text);
      setText(""); // only cleared when it worked, so a typo can be fixed
    });
  }

  return (
    <section className="card announce" aria-labelledby={textId + "-heading"}>
      <h3 id={textId + "-heading"}>Announce</h3>
      <label className="visually-hidden" htmlFor={textId}>What the bot should say</label>
      <form className="add-song" onSubmit={submit}>
        <input
          id={textId}
          type="text"
          placeholder="Type something for the bot to say…"
          maxLength={MAX_ANNOUNCEMENT_LENGTH}
          value={text}
          onChange={(event) => setText(event.target.value)}
          disabled={pending}
        />
        <button type="submit" className="primary" disabled={pending || announcing || isEmpty}>
          {pending ? "Speaking…" : "Say it"}
        </button>
      </form>
      <p className="muted hint">
        {announcing && !pending
          ? "Someone else's announcement is being said. Wait for it to finish."
          : `The song pauses while the bot speaks, then carries on. ${text.length}/${MAX_ANNOUNCEMENT_LENGTH} characters.`}
      </p>
      {error && <p className="hint error-text">{error}</p>}
    </section>
  );
}
