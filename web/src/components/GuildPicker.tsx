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
        <p>You and the bot aren't in any server together.</p>
        <p className="muted">Invite the bot to one of your servers first (see the README).</p>
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
