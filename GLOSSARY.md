# Brick Maback

A self-hosted Discord music bot: people in a Discord server queue up music, and the bot plays it in a voice channel. It's controlled with slash commands and a website.

## Language

### What plays

**Song**:
Something the bot plays that has an end: a YouTube video, a SoundCloud upload, a library file, even a two-hour mix.
_Avoid_: track, item, video

**Stream**:
Something the bot plays that is live and has no fixed length, such as a Twitch broadcast or an internet radio station. Not a kind of Song: say "song" or "stream" for whichever it is, and leave the noun out where it could be either ("Up next · 3"). There is deliberately no word for both.
_Avoid_: livestream, live track, track (as a word for either)

**Now playing**:
The song or stream the bot is playing in a server right now, including while it's paused.
_Avoid_: current track

**Queue**:
The songs and streams waiting to play after Now playing, in order. It never includes Now playing itself; the website heads it "Up next".
_Avoid_: playlist (a different thing)

**Recently played**:
The songs and streams a server has played before Now playing, newest first, so they can be queued again.
_Avoid_: history

### Sound

**Effect**:
A change to how everything the bot plays sounds, such as nightcore, vaporwave or bass boost. One at a time per server, kept until changed.
_Avoid_: filter

**Volume normalization**:
Playing every song at about the same loudness, so a loud song after a quiet one isn't a jolt. Each server switches it on or off; it isn't an Effect and works alongside one.
_Avoid_: audio normalization, loudness normalization, effect

**Announcement**:
Something a DJ types that the bot says aloud in the voice channel (text-to-speech). Now playing pauses for it and then carries on.
_Avoid_: TTS message, broadcast

### Playlists

**Playlist**:
A named list of songs and streams saved in a server, which members add to and DJs play. Always the bot's own; lists that live elsewhere are Playlist links.
_Avoid_: saved playlist

**Playlist link**:
A link to a list of songs that lives outside the bot: a YouTube playlist, or a Spotify playlist or album. Its songs can be queued all at once, or imported into a Playlist.
_Avoid_: playlist (on its own), YouTube playlist (when Spotify is meant too)

**Import**:
Copying the songs of a Playlist link into a Playlist, where they stay even if the link changes later.
_Avoid_: sync

### Library

**Library**:
A server's collection of audio files that its members uploaded to the bot, so they can be played again without a link.
_Avoid_: uploads, files

**Library file**:
One audio file in a Library. Once queued, it plays as a Song like any other. "Upload" is only the act of adding one.
_Avoid_: upload (as a noun), audio file, track

### People

**Server**:
A Discord server the bot is in. Each has its own Now playing, Queue, Playlists, Library and settings.
_Avoid_: guild

**Member**:
Anyone in a Discord server the bot is in. Members can see what's playing and add to Playlists, but not control playback.
_Avoid_: user, listener

**DJ**:
A Member who may control playback: queue, skip, pause, change the volume and so on. Who is a DJ is chosen by a Server admin (a role, or everyone).
_Avoid_: controller, moderator

**Server admin**:
A Member with Discord's Administrator or Manage Server permission in that server. Can do everything a DJ can, and change the server's settings.
_Avoid_: admin (on its own), moderator, server owner

**Bot owner**:
The one person who runs the bot, on whose computer it lives. Can do everything in every server, and alone has the Admin page.
_Avoid_: owner (on its own: Discord's server owner is someone else), admin

**Admin page**:
The website page where the Bot owner changes settings for the whole bot. Despite its name, Server admins can't open it; their page is the server's Settings.
_Avoid_: owner page, admin panel
