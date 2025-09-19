export type OAuthProvider = 'twitch';

export interface AccountPublicData {
    address: string;
    provider: OAuthProvider;
    sub: string;
    aud: string;
    maxEpoch: number;
    createdAt: number;
}

export interface AccountSession extends AccountPublicData {
    salt: string;
    randomness: string;
    jwt: string;
    proof: Record<string, unknown>;
    ephemeralPrivateKey: string;
}

export interface ExtensionState {
    overlayEnabled: boolean;
    accounts: AccountPublicData[];
}

export interface ExtensionConfig {
    twitchClientId: string;
    saltServiceUrl: string;
    zkProverUrl: string;
}

export const DEVNET_FULLNODE = 'https://fullnode.devnet.sui.io';
