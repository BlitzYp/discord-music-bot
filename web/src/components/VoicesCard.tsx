import { useEffect, useState } from "react";
import * as api from "../api";
import { DEFAULT_VOICE_ID, LANGUAGE_NAMES, type VoiceLanguage, type VoiceStatus } from "../shared";

/**
 * The Admin page's "Voices": every voice the bot can speak with, and a Download or Delete button for each. Servers pick
 * from the downloaded ones on their Settings page.
 */
export function VoicesCard() {
  const [voices, setVoices] = useState<VoiceStatus[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** The voice being downloaded or deleted from this page, and what went wrong with the last one. */
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    api
      .fetchVoices()
      .then(setVoices)
      .catch((err: Error) => setLoadError(err.message));
  }, []);

  async function act(voiceId: string, action: (voiceId: string) => Promise<VoiceStatus[]>) {
    setBusyId(voiceId);
    setActionError(null);
    try {
      setVoices(await action(voiceId));
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const languages = [...new Set(voices?.map((voice) => voice.language))] as VoiceLanguage[];

  return (
    <section className="card">
      <h3>Voices</h3>
      <p className="muted hint">
        The voices announcements can use. Each server picks one of the downloaded voices on its Settings page; a server
        whose voice you delete speaks with the default voice.
      </p>
      {loadError && <p className="error-text">Couldn't load the voices: {loadError}</p>}
      {!voices && !loadError && <p className="muted">Loading…</p>}
      {languages.map((language) => (
        <div key={language} className="voice-group">
          <h4>{LANGUAGE_NAMES[language]}</h4>
          <ul className="voice-list">
            {voices!
              .filter((voice) => voice.language === language)
              .map((voice) => (
                <li key={voice.id}>
                  <span className="voice-name">
                    {voice.name}
                    {voice.id === DEFAULT_VOICE_ID && <span className="muted"> · default</span>}
                  </span>
                  <span className="muted voice-description">
                    {voice.description} · {voice.sizeMb} MB
                  </span>
                  {voice.downloaded ? (
                    voice.id === DEFAULT_VOICE_ID ? (
                      <span className="ok voice-action">Downloaded</span>
                    ) : (
                      <button
                        type="button"
                        className="small voice-action"
                        disabled={busyId !== null}
                        onClick={() => act(voice.id, api.deleteVoice)}
                      >
                        {busyId === voice.id ? "Deleting…" : "Delete"}
                      </button>
                    )
                  ) : (
                    <button
                      type="button"
                      className="small voice-action"
                      disabled={busyId !== null || voice.downloading}
                      onClick={() => act(voice.id, api.downloadVoice)}
                    >
                      {busyId === voice.id || voice.downloading ? "Downloading…" : "Download"}
                    </button>
                  )}
                </li>
              ))}
          </ul>
        </div>
      ))}
      {actionError && <p className="hint error-text">{actionError}</p>}
    </section>
  );
}
