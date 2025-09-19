/// <reference types="chrome" />

import { SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { genAddressSeed, generateNonce, generateRandomness, getExtendedEphemeralPublicKey, getZkLoginSignature, jwtToAddress } from '@mysten/sui/zklogin';
import type { JwtPayload } from 'jwt-decode';
import { jwtDecode } from 'jwt-decode';

import type { MessageRequest, MessageResponse, SerializedTransactionRequest } from '../shared/messages';
import type { AccountPublicData, AccountSession } from '../shared/types';
import { DEVNET_FULLNODE } from '../shared/types';
import { base64ToUint8, uint8ToBase64 } from '../shared/encoding';
import { getAccountSessions, getOverlayEnabled, loadConfig, saveConfig, sessionsToPublicData, setAccountSessions, setOverlayEnabled } from '../shared/storage';
import type { AccountOverviewPayload } from '../shared/messages';

const EPHEMERAL_EPOCH_OFFSET = 2;

const suiClient = new SuiClient({ url: DEVNET_FULLNODE });

chrome.runtime.onInstalled.addListener(() => {
    console.info('[background] Twitch zkLogin Wallet extension installed');
});

chrome.runtime.onMessage.addListener((message: MessageRequest, _sender, sendResponse) => {
    void handleMessage(message)
        .then(response => {
            sendResponse(response);
        })
        .catch(error => {
            console.error('[background] Unexpected error handling message', error);
            sendResponse({
                type: message.type,
                ok: false,
                error: formatError(error),
            } as MessageResponse);
        });
    return true;
});

async function handleMessage(message: MessageRequest): Promise<MessageResponse> {
    switch (message.type) {
    case 'GET_EXTENSION_STATE':
        return getExtensionState();
    case 'START_TWITCH_LOGIN':
        return startTwitchLogin();
    case 'LOGOUT_ACCOUNT':
        return logoutAccount(message.address);
    case 'SIGN_AND_EXECUTE':
        return signAndExecute(message.address, message.payload);
    case 'FETCH_ACCOUNT_OVERVIEW':
        return fetchAccountOverview(message.address);
    case 'SAVE_CONFIG':
        await saveConfig(message.config);
        return {
            type: 'SAVE_CONFIG',
            ok: true,
            data: { config: message.config },
        };
    case 'GET_CONFIG': {
        const config = await loadConfig();
        return {
            type: 'GET_CONFIG',
            ok: true,
            data: { config },
        };
    }
    case 'SET_OVERLAY_ENABLED':
        await setOverlayEnabled(message.enabled);
        return {
            type: 'SET_OVERLAY_ENABLED',
            ok: true,
            data: { enabled: message.enabled },
        };
    default: {
        const exhaustiveCheck: never = message;
        throw new Error(`Unhandled message type: ${JSON.stringify(exhaustiveCheck)}`);
    }
    }
}

async function getExtensionState(): Promise<MessageResponse> {
    const [sessions, overlayEnabled] = await Promise.all([
        getAccountSessions(),
        getOverlayEnabled(),
    ]);
    const accounts = sessionsToPublicData(sessions);
    return {
        type: 'GET_EXTENSION_STATE',
        ok: true,
        data: {
            state: {
                overlayEnabled,
                accounts,
            },
        },
    };
}

async function startTwitchLogin(): Promise<MessageResponse> {
    try {
        const config = await loadConfig();
        if (!config.twitchClientId) {
            throw new Error('Twitch client ID is required. Please configure it in the extension options.');
        }

        const latestSystemState = await suiClient.getLatestSuiSystemState();
        const maxEpoch = Number(latestSystemState.epoch) + EPHEMERAL_EPOCH_OFFSET;

        const ephemeralKeyPair = new Ed25519Keypair();
        const randomness = generateRandomness();
        const nonce = generateNonce(ephemeralKeyPair.getPublicKey(), maxEpoch, randomness);

        const redirectUri = chrome.identity.getRedirectURL('twitch');
        const params = new URLSearchParams({
            client_id: config.twitchClientId,
            force_verify: 'true',
            lang: 'en',
            login_type: 'login',
            nonce,
            redirect_uri: redirectUri,
            response_type: 'id_token',
            scope: 'openid',
        });
        const authorizationUrl = `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;

        const redirectResponse = await launchWebAuthFlow(authorizationUrl);
        const idToken = extractFragmentParam(redirectResponse, 'id_token');
        if (!idToken) {
            throw new Error('Twitch login failed: no id_token returned.');
        }

        const decodedJwt = jwtDecode<JwtPayload>(idToken);
        if (!decodedJwt.sub) {
            throw new Error('Twitch JWT missing subject identifier.');
        }
        if (!decodedJwt.aud) {
            throw new Error('Twitch JWT missing audience.');
        }
        const audience = Array.isArray(decodedJwt.aud) ? decodedJwt.aud[0] : decodedJwt.aud;

        const salt = await fetchSalt(config.saltServiceUrl, idToken);
        const saltBigInt = BigInt(salt);

        const userAddress = jwtToAddress(idToken, saltBigInt);

        const proofRequestPayload = {
            maxEpoch,
            jwtRandomness: randomness.toString(),
            extendedEphemeralPublicKey: getExtendedEphemeralPublicKey(ephemeralKeyPair.getPublicKey()),
            jwt: idToken,
            salt: saltBigInt.toString(),
            keyClaimName: 'sub',
        };

        const proof = await fetchZkProof(config.zkProverUrl, proofRequestPayload);

        const sessions = await getAccountSessions();
        const session: AccountSession = {
            address: userAddress,
            provider: 'twitch',
            sub: decodedJwt.sub,
            aud: audience,
            maxEpoch,
            createdAt: Date.now(),
            salt: saltBigInt.toString(),
            randomness: randomness.toString(),
            jwt: idToken,
            proof,
            ephemeralPrivateKey: uint8ToBase64(ephemeralKeyPair.getSecretKey()),
        };

        const filteredSessions = sessions.filter(existing => existing.address !== session.address);
        const updatedSessions = [session, ...filteredSessions];
        await setAccountSessions(updatedSessions);

        const account = sessionToPublicData(session);
        return {
            type: 'START_TWITCH_LOGIN',
            ok: true,
            data: { account },
        };
    } catch (error) {
        console.warn('[background] startTwitchLogin failed', error);
        return {
            type: 'START_TWITCH_LOGIN',
            ok: false,
            error: formatError(error),
        };
    }
}

async function logoutAccount(address: string): Promise<MessageResponse> {
    const sessions = await getAccountSessions();
    const nextSessions = sessions.filter(session => session.address !== address);
    await setAccountSessions(nextSessions);
    return {
        type: 'LOGOUT_ACCOUNT',
        ok: true,
        data: {
            accounts: sessionsToPublicData(nextSessions),
        },
    };
}

async function signAndExecute(address: string, payload: SerializedTransactionRequest): Promise<MessageResponse> {
    try {
        const session = await getSessionOrThrow(address);
        const txResult = await executeTransactionWithSession(session, payload);
        return {
            type: 'SIGN_AND_EXECUTE',
            ok: true,
            data: {
                digest: txResult,
            },
        };
    } catch (error) {
        console.warn('[background] signAndExecute failed', error);
        return {
            type: 'SIGN_AND_EXECUTE',
            ok: false,
            error: formatError(error),
        };
    }
}

async function fetchAccountOverview(address: string): Promise<MessageResponse> {
    try {
        const overview = await buildAccountOverview(address);
        return {
            type: 'FETCH_ACCOUNT_OVERVIEW',
            ok: true,
            data: { overview },
        };
    } catch (error) {
        console.warn('[background] fetchAccountOverview failed', error);
        return {
            type: 'FETCH_ACCOUNT_OVERVIEW',
            ok: false,
            error: formatError(error),
        };
    }
}

async function buildAccountOverview(address: string): Promise<AccountOverviewPayload> {
    const [suiBalance, allBalances, objectResponse, incomingTxs, outgoingTxs] = await Promise.all([
        suiClient.getBalance({ owner: address, coinType: '0x2::sui::SUI' }),
        suiClient.getAllBalances({ owner: address }),
        suiClient.getOwnedObjects({
            owner: address,
            limit: 50,
            options: { showDisplay: true, showType: true },
        }).catch(() => ({ data: [] })),
        suiClient.queryTransactionBlocks({ filter: { ToAddress: address }, limit: 10, options: { showEffects: false, showInput: true } }),
        suiClient.queryTransactionBlocks({ filter: { FromAddress: address }, limit: 10, options: { showEffects: false, showInput: true } }),
    ]);

    const coinBalances = allBalances
        .filter(balance => balance.coinType !== '0x2::sui::SUI')
        .map(balance => ({
            type: balance.coinType,
            balance: Number(balance.totalBalance) / 1_000_000_000,
        }));

    const nfts = objectResponse.data
        .map(item => {
            const display = item.data?.display?.data;
            const name = typeof display?.name === 'string' ? display.name : null;
            const desc = typeof display?.description === 'string' ? display.description : null;
            const type = item.data?.type ?? 'unknown';
            if (!name && type.startsWith('0x2::coin::')) {
                return null;
            }
            return {
                display: name ?? type,
                objectId: item.data?.objectId ?? 'unknown',
                description: desc ?? undefined,
            };
        })
        .filter((entry): entry is { display: string; objectId: string; description?: string } => !!entry);

    const deduped = new Map<string, { digest: string; kind: string; timestampMs?: string }>();
    const appendTx = (txList: typeof incomingTxs.data) => {
        (txList ?? []).forEach(tx => {
            if (!deduped.has(tx.digest)) {
                deduped.set(tx.digest, {
                    digest: tx.digest,
                    kind: tx.transaction?.kind ?? 'unknown',
                    timestampMs: tx.timestampMs ?? undefined,
                });
            }
        });
    };
    appendTx(incomingTxs.data);
    appendTx(outgoingTxs.data);

    const recentTransactions = Array.from(deduped.values())
        .sort((a, b) => (Number(b.timestampMs ?? 0) - Number(a.timestampMs ?? 0)))
        .slice(0, 10);

    return {
        address,
        suiBalance: Number(suiBalance.totalBalance) / 1_000_000_000,
        coinBalances,
        nfts,
        recentTransactions,
    };
}

async function executeTransactionWithSession(session: AccountSession, payload: SerializedTransactionRequest): Promise<string> {
    const keypair = Ed25519Keypair.fromSecretKey(base64ToUint8(session.ephemeralPrivateKey));
    const tx = await buildTransaction(session.address, payload);

    const { bytes, signature: userSignature } = await tx.sign({
        client: suiClient,
        signer: keypair,
    });

    const addressSeed = genAddressSeed(
        BigInt(session.salt),
        'sub',
        session.sub,
        session.aud,
    ).toString();

    const zkLoginSignature = getZkLoginSignature({
        inputs: {
            ...(session.proof as Record<string, unknown>),
            addressSeed,
        },
        maxEpoch: session.maxEpoch,
        userSignature,
    });

    const executeResult = await suiClient.executeTransactionBlock({
        transactionBlock: bytes,
        signature: zkLoginSignature,
        options: { showEffects: true },
    });

    return executeResult.digest;
}

async function buildTransaction(sender: string, payload: SerializedTransactionRequest) {
    switch (payload.kind) {
    case 'transfer-sui': {
        if (typeof payload.amount !== 'number' || !payload.recipient) {
            throw new Error('Transfer SUI requires a recipient and numeric amount.');
        }
        const { Transaction } = await import('@mysten/sui/transactions');
        const tx = new Transaction();
        tx.setSender(sender);
        tx.transferSui({
            recipient: payload.recipient,
            amount: BigInt(Math.floor(payload.amount * 1_000_000_000)),
        });
        return tx;
    }
    case 'custom': {
        if (!payload.bytes) {
            throw new Error('Custom transaction requires bytes.');
        }
        const { Transaction } = await import('@mysten/sui/transactions');
        return Transaction.from(payload.bytes);
    }
    default:
        throw new Error(`Unsupported transaction kind: ${payload.kind satisfies never}`);
    }
}

async function getSessionOrThrow(address: string): Promise<AccountSession> {
    const sessions = await getAccountSessions();
    const session = sessions.find(item => item.address === address);
    if (!session) {
        throw new Error('No active session for this address. Ask the user to log in again.');
    }
    return session;
}

function sessionToPublicData(session: AccountSession): AccountPublicData {
    const { address, provider, sub, aud, createdAt, maxEpoch } = session;
    return { address, provider, sub, aud, createdAt, maxEpoch };
}

async function launchWebAuthFlow(url: string): Promise<string> {
    return await new Promise((resolve, reject) => {
        chrome.identity.launchWebAuthFlow({ url, interactive: true }, redirectUrl => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            if (!redirectUrl) {
                reject(new Error('No redirect URL returned from auth flow.'));
                return;
            }
            resolve(redirectUrl);
        });
    });
}

function extractFragmentParam(url: string, param: string): string | null {
    const hashIndex = url.indexOf('#');
    if (hashIndex === -1) {
        return null;
    }
    const fragment = url.substring(hashIndex + 1);
    const searchParams = new URLSearchParams(fragment);
    const value = searchParams.get(param);
    return value;
}

async function fetchSalt(url: string, jwt: string): Promise<string> {
    let targetUrl = url;
    if (!/^https?:/i.test(targetUrl)) {
        targetUrl = chrome.runtime.getURL(targetUrl.replace(/^\//, ''));
    }

    const isDummy = targetUrl.endsWith('dummy-salt-service.json');
    const response = await fetch(targetUrl, {
        method: isDummy ? 'GET' : 'POST',
        headers: isDummy ? undefined : { 'Content-Type': 'application/json' },
        body: isDummy ? undefined : JSON.stringify({ jwt }),
    });

    if (!response.ok) {
        throw new Error(`Salt service responded with status ${response.status}`);
    }
    const data = await response.json() as { salt?: string };
    if (!data.salt) {
        throw new Error('Salt service response missing salt field.');
    }
    return data.salt;
}

async function fetchZkProof(url: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!/^https?:/i.test(url)) {
        throw new Error('zkProverUrl must be an absolute HTTP(S) URL.');
    }
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`ZK prover error (HTTP ${response.status}): ${text}`);
    }
    return await response.json() as Record<string, unknown>;
}

function formatError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === 'string') {
        return error;
    }
    return 'Unknown error occurred';
}
