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

type SuccessResponse<T extends MessageRequest['type'], D> = {
    type: T;
    ok: true;
    data: D;
    error?: string;
};

type ErrorResponse<T extends MessageRequest['type']> = {
    type: T;
    ok: false;
    error: string;
};

export type MessageResponse =
    | SuccessResponse<'GET_EXTENSION_STATE', { state: ExtensionState }>
    | ErrorResponse<'GET_EXTENSION_STATE'>
    | SuccessResponse<'START_TWITCH_LOGIN', { account: AccountPublicData }>
    | ErrorResponse<'START_TWITCH_LOGIN'>
    | SuccessResponse<'LOGOUT_ACCOUNT', { accounts: AccountPublicData[] }>
    | ErrorResponse<'LOGOUT_ACCOUNT'>
    | SuccessResponse<'SIGN_AND_EXECUTE', { digest: string }>
    | ErrorResponse<'SIGN_AND_EXECUTE'>
    | SuccessResponse<'FETCH_ACCOUNT_OVERVIEW', { overview: AccountOverviewPayload }>
    | ErrorResponse<'FETCH_ACCOUNT_OVERVIEW'>
    | SuccessResponse<'SAVE_CONFIG', { config: ExtensionConfig }>
    | ErrorResponse<'SAVE_CONFIG'>
    | SuccessResponse<'GET_CONFIG', { config: ExtensionConfig }>
    | ErrorResponse<'GET_CONFIG'>
    | SuccessResponse<'SET_OVERLAY_ENABLED', { enabled: boolean }>
    | ErrorResponse<'SET_OVERLAY_ENABLED'>;

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
