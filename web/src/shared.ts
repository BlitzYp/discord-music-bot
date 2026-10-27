// Everything the website uses from the backend's shared code (src/shared/), in one place.
export type * from "../../src/shared/types";
export { formatDuration } from "../../src/shared/format";
export { AUDIO_FILTERS, FILTER_DESCRIPTIONS, playbackRate } from "../../src/shared/filters";
export { hasLevel, type PermissionLevel } from "../../src/shared/permissions";
export { MAX_VOLUME } from "../../src/shared/player";
export { MAX_ANNOUNCEMENT_LENGTH } from "../../src/shared/announcements";
export {
  AUTO_ANNOUNCEMENT_WORDS,
  BOT_STATUS_DOTS,
  BOT_STATUS_TYPES,
  GLOBAL_SETTING_LIMITS,
  MAX_AUTO_ANNOUNCEMENT_MESSAGE_LENGTH,
  MAX_BOT_STATUS_LENGTH,
  SETTING_LIMITS,
  SONG_START_WHEN,
  YOUTUBE_MODES,
} from "../../src/shared/settings";
export type {
  AdminStatus,
  AutoAnnouncement,
  AutoAnnouncementKind,
  AutoAnnouncements,
  BotStatus,
  BotStatusDot,
  BotStatusType,
  GlobalSettings,
  GuildSettings,
  GuildSettingsResponse,
  SongStartWhen,
  YoutubeMode,
} from "../../src/shared/settings";
export { describeAddMany, isYoutubePlaylistLink, MAX_PLAYLIST_NAME_LENGTH, MAX_PLAYLIST_SONGS } from "../../src/shared/playlists";
export { isSpotifyCollectionLink } from "../../src/shared/spotify";
export type {
  AddManyResult,
  PlaylistDetails,
  PlaylistItem,
  PlaylistPlayMode,
  PlaylistSummary,
} from "../../src/shared/playlists";
export { formatBytes, UPLOAD_ACCEPT, UPLOAD_PERMISSIONS } from "../../src/shared/library";
export type { LibraryFile, LibraryOverview, UploadPermission } from "../../src/shared/library";
