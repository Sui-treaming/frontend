/// <reference types="chrome" />

import { SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { genAddressSeed, generateNonce, generateRandomness, getExtendedEphemeralPublicKey, getZkLoginSignature, jwtToAddress } from '@mysten/sui/zklogin';
import type { JwtPayload } from 'jwt-decode';
import { jwtDecode } from 'jwt-decode';

import type { MessageRequest, MessageResponse, SerializedTransactionRequest } from '../shared/messages';
import type { AccountPublicData, AccountSession, ExtensionConfig, StoredZkLoginProof } from '../shared/types';
import { TESTNET_FULLNODE } from '../shared/types';
import { base64ToUint8, uint8ToBase64 } from '../shared/encoding';
import { getAccountSessions, getOverlayEnabled, loadConfig, saveConfig, sessionsToPublicData, setAccountSessions, setOverlayEnabled } from '../shared/storage';
import type { AccountOverviewPayload } from '../shared/messages';

const EPHEMERAL_EPOCH_OFFSET = 2;
const ZK_LOGIN_NETWORK = 'testnet';

const suiClient = new SuiClient({ url: TESTNET_FULLNODE });

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
    case 'UPLOAD_NFT_IMAGE':
        return uploadNftImage(message);
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

async function uploadNftImage(message: Extract<MessageRequest, { type: 'UPLOAD_NFT_IMAGE' }>): Promise<MessageResponse> {
    try {
        const [config, session] = await Promise.all([
            loadConfig(),
            getSessionOrThrow(message.address),
        ]);

        const endpoint = config.nftUploadUrl?.trim();
        if (!endpoint) {
            throw new Error('NFT upload endpoint is not configured. Set it in the extension options.');
        }

        console.info('[background] Uploading NFT image', {
            endpoint,
            address: session.address,
            fileName: message.fileName,
            fileType: message.fileType,
            fileSize: message.fileData.byteLength,
        });

        // JSON base64 payload (먼저 시도)
        const fileName = message.fileName || 'upload.png';
        const contentType = message.fileType || 'application/octet-stream';
        const base64 = uint8ToBase64(new Uint8Array(message.fileData));
        const dataUrl = `data:${contentType};base64,${base64}`;

        let response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: fileName, contentType, data: dataUrl }),
        });

        // Fallback: some endpoints require raw image/png instead of JSON
        if (response.status === 415) {
            console.warn('[background] JSON upload not supported, retrying as image/png');
            const blob = await ensurePngBlob(message.fileData, contentType);
            response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'image/png' },
                body: blob,
            });
        }

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Upload failed (HTTP ${response.status}): ${text}`);
        }

        const respType = response.headers.get('content-type') ?? '';
        const responseClone = response.clone();
        let result: unknown;
        let messageText: string | undefined;

        if (respType.includes('application/json')) {
            try {
                result = await responseClone.json();
                if (result && typeof result === 'object') {
                    const record = result as Record<string, unknown>;
                    const maybeMessage = record.message;
                    const maybeUrl = record.url;
                    if (typeof maybeMessage === 'string') {
                        messageText = maybeMessage;
                    } else if (typeof maybeUrl === 'string') {
                        messageText = maybeUrl;
                    }
                }
            } catch (error) {
                console.warn('[background] Failed to parse upload response JSON', error);
            }
        }

        if (result === undefined) {
            const text = await response.text();
            result = text;
            messageText = messageText ?? (text ? text : undefined);
        }

        console.info('[background] NFT upload response', {
            status: response.status,
            ok: response.ok,
            headers: Object.fromEntries(response.headers.entries()),
            parsed: result,
        });

        return {
            type: 'UPLOAD_NFT_IMAGE',
            ok: true,
            data: {
                status: 'ok',
                ...(messageText ? { message: messageText } : {}),
                ...(result !== undefined ? { result } : {}),
            },
        };
    } catch (error) {
        console.warn('[background] uploadNftImage failed', error);
        return {
            type: 'UPLOAD_NFT_IMAGE',
            ok: false,
            error: formatError(error),
        };
    }
}

async function ensurePngBlob(fileData: ArrayBuffer, sourceType?: string): Promise<Blob> {
    try {
        if (sourceType === 'image/png') {
            return new Blob([fileData], { type: 'image/png' });
        }
        // try transcode to PNG using OffscreenCanvas
        const src = new Blob([fileData], { type: sourceType || 'application/octet-stream' });
        // createImageBitmap is available in service workers in modern Chrome
        // if not available, fallback to raw bytes with PNG type
        if (typeof createImageBitmap === 'function') {
            const bitmap = await createImageBitmap(src).catch(() => null as ImageBitmap | null);
            if (bitmap) {
                const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(bitmap, 0, 0);
                    const png = await canvas.convertToBlob({ type: 'image/png' });
                    return png;
                }
            }
        }
        // fallback: send original bytes but mark as PNG (some servers just check header)
        return new Blob([fileData], { type: 'image/png' });
    } catch (e) {
        console.warn('[background] ensurePngBlob failed, using raw bytes as image/png', e);
        return new Blob([fileData], { type: 'image/png' });
    }
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
        console.info('[zklogin] aud from JWT:', audience);
        // Ensure salt exists for this Twitch user in backend (or fallback to legacy fetch)
        const salt = await resolveSalt({
            url: config.saltServiceUrl,
            twitchId: decodedJwt.sub,
            jwt: idToken,
        });
        const saltBigInt = normalizeToField(BigInt(salt));

        const userAddress = jwtToAddress(idToken, saltBigInt);

        const proofRequestBody = {
            network: ZK_LOGIN_NETWORK,
            maxEpoch,
            randomness: randomness.toString(),
            ephemeralPublicKey: getExtendedEphemeralPublicKey(ephemeralKeyPair.getPublicKey()),
        } as const;

        const proof = await fetchZkProof({
            url: config.zkProverUrl,
            jwt: idToken,
            authorizationToken: config.zkProverAuthToken,
            body: proofRequestBody,
        });

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
            ephemeralPrivateKey: uint8ToBase64(decodeSuiPrivateKey(ephemeralKeyPair.getSecretKey()).secretKey),
        };

        const filteredSessions = sessions.filter(existing => existing.address !== session.address);
        const updatedSessions = [session, ...filteredSessions];
        await setAccountSessions(updatedSessions);

        void registerAccountWithBackend(config, session);

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

    const nfts = objectResponse.data.reduce<Array<{ display: string; objectId: string; description?: string }>>((list, item) => {
        const display = item.data?.display?.data;
        const name = typeof display?.name === 'string' ? display.name : null;
        const description = typeof display?.description === 'string' ? display.description : undefined;
        const type = item.data?.type ?? 'unknown';
        if (!name && type.startsWith('0x2::coin::')) {
            return list;
        }
        list.push({
            display: name ?? type,
            objectId: item.data?.objectId ?? 'unknown',
            ...(description ? { description } : {}),
        });
        return list;
    }, []);

    const deduped = new Map<string, { digest: string; kind: string; timestampMs?: string }>();
    const appendTx = (txList: typeof incomingTxs.data) => {
        (txList ?? []).forEach(tx => {
            if (!deduped.has(tx.digest)) {
                const kind = tx.transaction?.data.transaction.kind ?? 'unknown';
                deduped.set(tx.digest, {
                    digest: tx.digest,
                    kind,
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
            ...session.proof,
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
        const amount = BigInt(Math.floor(payload.amount * 1_000_000_000));
        if (amount <= 0n) {
            throw new Error('Transfer amount must be greater than zero.');
        }
        const { Transaction } = await import('@mysten/sui/transactions');
        const tx = new Transaction();
        tx.setSender(sender);
        const [transferCoin] = tx.splitCoins(tx.gas, [amount]);
        tx.transferObjects([transferCoin], tx.pure.address(payload.recipient));
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

interface FetchZkProofParams {
    url: string;
    jwt: string;
    authorizationToken?: string;
    body: {
        network: string;
        maxEpoch: number;
        randomness: string;
        ephemeralPublicKey: string;
    };
}

async function fetchZkProof({ url, jwt, authorizationToken, body }: FetchZkProofParams): Promise<StoredZkLoginProof> {
    if (!/^https?:/i.test(url)) {
        throw new Error('zkProverUrl must be an absolute HTTP(S) URL.');
    }

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'zklogin-jwt': jwt,
    };

    const token = authorizationToken?.trim();
    if (token) {
        headers.Authorization = token.toLowerCase().startsWith('bearer ') ? token : `Bearer ${token}`;
    }

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`ZK prover error (HTTP ${response.status}): ${text}`);
    }
    const raw = await response.json() as unknown;

    if (!raw || typeof raw !== 'object') {
        throw new Error('Invalid proof response: expected object.');
    }

    const container = raw as Record<string, unknown>;
    const top = container as Record<string, unknown>;
    const nested = (typeof container.data === 'object' && container.data)
        ? (container.data as Record<string, unknown>)
        : null;

    const src = (top.proofPoints && top.issBase64Details && top.headerBase64)
        ? top
        : (nested && nested.proofPoints && nested.issBase64Details && nested.headerBase64)
            ? nested
            : null;

    if (!src) {
        const keys = Object.keys(container).join(', ');
        throw new Error(`Invalid proof response: missing fields. Keys present: ${keys}`);
    }

    const proof: StoredZkLoginProof = {
        proofPoints: src.proofPoints as StoredZkLoginProof['proofPoints'],
        issBase64Details: src.issBase64Details as StoredZkLoginProof['issBase64Details'],
        headerBase64: src.headerBase64 as StoredZkLoginProof['headerBase64'],
    };

    return proof;
}

/**
 * Resolve a salt value for a Twitch user.
 * - If the configured URL points to our backend salts API, call `/salts/ensure` with { twitchId }.
 * - Otherwise, fallback to legacy behavior: POST { jwt } to the given salt service (or dummy JSON).
 */
async function resolveSalt(params: { url: string; twitchId: string; jwt: string }): Promise<string> {
    const { url, twitchId, jwt } = params;
    const lower = url.toLowerCase();

    // Secure backend flow: POST /salts/ensure with JWT; backend returns salt without exposing via GET
    if (lower.includes('/salts')) {
        const ensureEndpoint = url.toLowerCase().includes('/ensure')
            ? url
            : url.replace(/\/$/, '') + '/ensure';
        const resp = await fetch(ensureEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jwt }),
        });
        if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`Salt ensure failed (HTTP ${resp.status}): ${text}`);
        }
        const saved = await resp.json() as { salt?: string } | Record<string, unknown>;
        const value = (saved as any)?.salt;
        if (!value || typeof value !== 'string') {
            throw new Error('Invalid salt ensure response: missing salt');
        }
        return value;
    }

    // Fallback for non-backend / dummy service
    return fetchSalt(url, jwt);
}

// No longer generating salts client-side in the secure path

// BN254 scalar field modulus
const FIELD_MODULUS_BN254 = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');

function normalizeToField(x: bigint): bigint {
    const n = x % FIELD_MODULUS_BN254;
    return n === 0n ? 1n : n;
}

async function registerAccountWithBackend(config: ExtensionConfig, session: AccountSession): Promise<void> {
    const endpoint = config.backendRegistrationUrl?.trim();
    if (!endpoint) {
        return;
    }

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                walletAddress: session.address,
                provider: session.provider,
                twitchUserId: session.sub,
                audience: session.aud,
                registeredAt: new Date(session.createdAt).toISOString(),
            }),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`HTTP ${response.status}: ${text}`);
        }

        console.info('[background] Registered wallet with backend');
    } catch (error) {
        console.warn('[background] Failed to register wallet with backend', error);
    }
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
