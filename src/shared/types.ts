import type { ZkLoginSignatureInputs } from '@mysten/sui/zklogin';

export type OAuthProvider = 'twitch';

export interface AccountPublicData {
    address: string;
    provider: OAuthProvider;
    sub: string;
    aud: string;
    maxEpoch: number;
    createdAt: number;
}

export type StoredZkLoginProof = Omit<ZkLoginSignatureInputs, 'addressSeed'>;

export interface AccountSession extends AccountPublicData {
    salt: string;
    randomness: string;
    jwt: string;
    proof: StoredZkLoginProof;
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
    zkProverAuthToken: string;
    backendRegistrationUrl: string;
}

export const TESTNET_FULLNODE = 'https://fullnode.testnet.sui.io';
