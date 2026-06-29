// FUTUREHAT mobile — navigation param list shared across screens.
import type { UUID } from '../lib/shared';

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
  Chat: { conversationId: UUID; title: string };
  NewChat: undefined;
  NewGroup: undefined;
  Profile: { userId: UUID };
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
};
