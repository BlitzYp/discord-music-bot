import type { GuildSummary } from "../shared";

interface Props {
  guilds: GuildSummary[];
  onPick: (guildId: string) => void;
}

/** The list of servers to choose from, shown when no server is selected yet. */
export function GuildPicker({ guilds, onPick }: Props) {
  if (guilds.length === 0) {
    return (
      <section className="card empty">
        <p>The bot isn't in any servers yet.</p>
        <p className="muted">Invite it to a server first (see the README).</p>
      </section>
    );
  }

  return (
    <section className="card">
      <h3>Pick a server</h3>
      <ul className="guilds">
        {guilds.map((guild) => (
          <li key={guild.id}>
            <button type="button" onClick={() => onPick(guild.id)}>
              {guild.iconUrl ? <img src={guild.iconUrl} alt="" /> : <span className="icon placeholder">{guild.name[0]}</span>}
              {guild.name}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
