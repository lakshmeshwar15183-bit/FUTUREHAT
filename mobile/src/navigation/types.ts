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
};
