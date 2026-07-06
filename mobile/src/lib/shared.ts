// FUTUREHAT mobile — single re-export barrel for the monorepo `shared/` package.
// Metro resolves these relative paths via watchFolders (see metro.config.js);
// TypeScript resolves them via the @shared/* path alias / relative source.
export * from '../../../shared/api';
export * from '../../../shared/types';
export * from '../../../shared/messageExtras';
export * from '../../../shared/recentContactsApi';
export * from '../../../shared/premiumApi';
export * from '../../../shared/chatLockApi';
export * from '../../../shared/adminApi';
export * from '../../../shared/callsApi';
export * from '../../../shared/callSettingsApi';
export * from '../../../shared/communitiesApi';
export * from '../../../shared/supportApi';
export * from '../../../shared/accountApi';
export * from '../../../shared/privacyApi';
export * from '../../../shared/notificationsApi';
export * from '../../../shared/pushApi';
export * from '../../../shared/streakApi';
export * from '../../../shared/premium/plans';
export * from '../../../shared/premium/features';
export { createFutureHatClient } from '../../../shared/client';
export type { FutureHatClientOptions, SupabaseClient } from '../../../shared/client';
