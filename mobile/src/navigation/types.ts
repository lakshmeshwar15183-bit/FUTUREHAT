// Lumixo mobile — navigation param list shared across screens.
import type { UUID, CallHistoryItem } from '../lib/shared';
import type { PickedAsset } from '../screens/MediaPickerScreen';

export type RootStackParamList = {
  Auth: undefined;
  /** Landing screen for the password-recovery deep link. `recoveryError` is set
   *  by the App-level link handler when it couldn't install a recovery session
   *  (malformed/expired token) so the screen can show an explanation instead
   *  of a form that will silently no-op. */
  ResetPassword: { recoveryError?: string } | undefined;
  Main: undefined;
  Chat: { conversationId: UUID; title: string };
  NewChat: undefined;
  NewGroup: undefined;
  GroupInfo: { conversationId: UUID; isAdmin: boolean };
  Profile: { userId: UUID; conversationId?: UUID };
  EditProfile: undefined;
  Appearance: undefined;
  Premium: undefined;
  AppLockSetup: undefined;
  CreateCommunity: undefined;
  CommunityDetail: { communityId: UUID; name: string };
  HelpSupport: undefined;
  // Phase 4 settings & account screens
  Privacy: undefined;
  Notifications: undefined;
  ChatSettings: undefined;
  StorageData: undefined;
  AccountSecurity: undefined;
  DataExport: undefined;
  ArchivedChats: undefined;
  Legal: undefined;
  Diagnostics: undefined;
  Invite: undefined;
  Starred: undefined;
  Admin: undefined;
  AdminUserDetail: { userId: string; isOwner: boolean };
  Moderator: undefined;
  Mailbox: undefined;
  // `calls` carries the specific call records for the tapped history row so the
  // detail screen renders that call's real metadata instantly (offline-first)
  // instead of generic contact info. Optional so deep-links still work (the
  // screen re-fetches by conversation when it's absent).
  CallDetail: { conversationId: UUID; peerId?: UUID; title: string; username?: string; avatarUrl?: string | null; calls?: CallHistoryItem[] };
  ScheduledCalls: undefined;
  CallSettings: undefined;
  // Media picker/editor (0030): full-screen picker → per-asset preview/editor.
  MediaPicker: { conversationId: UUID; maxSelection?: number };
  MediaPreview: { conversationId: UUID; assets: PickedAsset[]; startIndex?: number };
  // Streaks (0029): the hub, one pair's detail, the info pages, and Hall of Legends.
  Streaks: undefined;
  StreakDetail: { conversationId: UUID; title: string };
  StreakInfo: { page: 'how' | 'qualifying' | 'levels' | 'rewards' | 'penalties' | 'restrictions' | 'moderator' };
  HallOfLegends: undefined;
};
