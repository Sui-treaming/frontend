import type { AccountPublicData, ExtensionConfig, ExtensionState } from './types';

export type MessageRequest =
    | { type: 'GET_EXTENSION_STATE' }
    | { type: 'START_TWITCH_LOGIN' }
    | { type: 'LOGOUT_ACCOUNT'; address: string }
    | { type: 'SIGN_AND_EXECUTE'; address: string; payload: SerializedTransactionRequest }
    | { type: 'FETCH_ACCOUNT_OVERVIEW'; address: string }
    | { type: 'SAVE_CONFIG'; config: ExtensionConfig }
    | { type: 'GET_CONFIG' }
    | { type: 'SET_OVERLAY_ENABLED'; enabled: boolean };

export type MessageResponse =
    | { type: 'GET_EXTENSION_STATE'; ok: boolean; data?: { state: ExtensionState }; error?: string }
    | { type: 'START_TWITCH_LOGIN'; ok: boolean; data?: { account: AccountPublicData }; error?: string }
    | { type: 'LOGOUT_ACCOUNT'; ok: boolean; data?: { accounts: AccountPublicData[] }; error?: string }
    | { type: 'SIGN_AND_EXECUTE'; ok: boolean; data?: { digest: string }; error?: string }
    | { type: 'FETCH_ACCOUNT_OVERVIEW'; ok: boolean; data?: { overview: AccountOverviewPayload }; error?: string }
    | { type: 'SAVE_CONFIG'; ok: boolean; data?: { config: ExtensionConfig }; error?: string }
    | { type: 'GET_CONFIG'; ok: boolean; data?: { config: ExtensionConfig }; error?: string }
    | { type: 'SET_OVERLAY_ENABLED'; ok: boolean; data?: { enabled: boolean }; error?: string };

export interface AccountOverviewPayload {
    address: string;
    suiBalance: number;
    coinBalances: Array<{ type: string; balance: number }>;
    nfts: Array<{ display: string; objectId: string; description?: string }>; // basic summary
    recentTransactions: Array<{ digest: string; kind: string; timestampMs?: string }>;
}

export interface SerializedTransactionRequest {
    kind: 'transfer-sui' | 'custom';
    amount?: number;
    recipient?: string;
    bytes?: string;
}
