import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { fromHex, SUI_CLOCK_OBJECT_ID, toHex } from '@mysten/sui/utils';
import { SealClient, SessionKey, EncryptedObject, NoAccessError } from '@mysten/seal';

import { sendMessage } from '../api/runtime';
import type { AccountPublicData } from '../../shared/types';
import { TESTNET_FULLNODE } from '../../shared/types';
import type { NftUploadState } from './types';
import { uint8ToBase64 } from '../../shared/encoding';

import { DEFAULT_SEAL_SERVER_IDS, DEFAULT_WALRUS_SERVICES, SESSION_TTL_MINUTES, WALRUS_DEFAULT_EPOCHS, type WalrusServiceConfig } from '../../subscription/constants';
import { buildCreateServiceTransaction, buildPublishSecretTransaction, buildSubscribeTransaction } from '../../subscription/transactions';

const MODULE_NAME = 'subscription';

type WalrusService = WalrusServiceConfig;

type ServiceSummary = {
    id: string;
    name: string;
    fee: bigint;
    ttlMs: bigint;
    owner: string;
    capId?: string;
    blobIds: string[];
};

type PolicyFormState = {
    price: string;
    ttlMinutes: string;
    name: string;
    submitting: boolean;
    error?: string;
    success?: string;
};

type SecretUploadInfo = {
    status: string;
    blobId: string;
    suiRefType: string;
    suiRef: string;
    blobUrl: string;
    suiUrl: string;
};

type SecretUploadState = {
    aggregatorId: WalrusService['id'];
    file?: File;
    uploading: boolean;
    publishing: boolean;
    info?: SecretUploadInfo;
    error?: string;
    success?: string;
};

type FollowerState = {
    serviceIdInput: string;
    loading: boolean;
    service?: (ServiceSummary & { subscriptionId?: string });
    decryptedFiles: DecryptedFile[];
    decrypting: boolean;
    error?: string;
};

interface DecryptedFile {
    url: string;
    fileName: string;
    mimeType: string;
    size: number;
}

export interface SubscriptionTabProps {
    account: AccountPublicData;
    nftUploadState: NftUploadState;
    onNftFileChange: (files: FileList | null) => void;
    onNftUpload: () => Promise<void>;
}

export function SubscriptionTab({ account, nftUploadState, onNftFileChange, onNftUpload }: SubscriptionTabProps): ReactElement {
    const [activeRole, setActiveRole] = useState<'streamer' | 'follower'>('streamer');
    const [services, setServices] = useState<ServiceSummary[]>([]);
    const [servicesLoading, setServicesLoading] = useState(false);
    const [servicesError, setServicesError] = useState<string | null>(null);
    const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
    const [packageId, setPackageId] = useState('');
    const [policyForm, setPolicyForm] = useState<PolicyFormState>({
        price: '',
        ttlMinutes: '',
        name: '',
        submitting: false,
    });
    const [secretState, setSecretState] = useState<SecretUploadState>({
        aggregatorId: DEFAULT_WALRUS_SERVICES[0]?.id ?? 'walrus-space',
        uploading: false,
        publishing: false,
    });
    const [followerState, setFollowerState] = useState<FollowerState>({
        serviceIdInput: '',
        loading: false,
        decrypting: false,
        decryptedFiles: [],
    });

    const suiClient = useMemo(() => new SuiClient({ url: TESTNET_FULLNODE }), []);
    const sealClient = useMemo(() => new SealClient({
        suiClient,
        serverConfigs: DEFAULT_SEAL_SERVER_IDS.map(id => ({ objectId: id, weight: 1 })),
        verifyKeyServers: false,
    }), [suiClient]);

    useEffect(() => {
        void (async () => {
            try {
                const response = await sendMessage({ type: 'GET_CONFIG' });
                setPackageId(response.data.config.subscriptionPackageId ?? '');
            } catch (error) {
                console.warn('[subscription] Failed to load packageId from config', error);
            }
        })();
    }, []);

    useEffect(() => {
        if (!packageId) {
            return;
        }
        void refreshServices();
        // reset selection when account changes
        setSelectedServiceId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [account.address, packageId]);

    const refreshServices = useCallback(async () => {
        if (!packageId) {
            return;
        }
        setServicesLoading(true);
        setServicesError(null);
        try {
            const capResponse = await suiClient.getOwnedObjects({
                owner: account.address,
                options: { showContent: true, showType: true },
                filter: { StructType: `${packageId}::${MODULE_NAME}::Cap` },
            });
            const caps = capResponse.data
                .map(item => {
                    const fields = ((item.data?.content as { fields?: any })?.fields) ?? null;
                    if (!fields) {
                        return null;
                    }
                    return {
                        id: fields.id?.id as string | undefined,
                        serviceId: fields.service_id as string | undefined,
                    };
                })
                .filter((entry): entry is { id: string; serviceId: string } => Boolean(entry?.id && entry?.serviceId));

            const nextServices: ServiceSummary[] = [];
            for (const cap of caps) {
                const service = await fetchServiceSummary(suiClient, cap.serviceId);
                if (service) {
                    nextServices.push({ ...service, capId: cap.id });
                }
            }
            setServices(nextServices);
            if (nextServices.length > 0 && !selectedServiceId) {
                setSelectedServiceId(nextServices[0].id);
            }
        } catch (error) {
            console.warn('[subscription] Failed to load services', error);
            setServicesError('Failed to load owned services. Try refreshing.');
        } finally {
            setServicesLoading(false);
        }
    }, [account.address, packageId, selectedServiceId, suiClient]);

    const selectedService = selectedServiceId
        ? services.find(service => service.id === selectedServiceId)
        : undefined;

    const handleCreateService = useCallback(async () => {
        if (policyForm.submitting) {
            return;
        }
        if (!packageId) {
            setPolicyForm(prev => ({ ...prev, error: 'Package ID is not configured. Update it in extension options.' }));
            return;
        }
        const price = policyForm.price.trim();
        const ttl = policyForm.ttlMinutes.trim();
        const name = policyForm.name.trim();
        if (!price || !ttl || !name) {
            setPolicyForm(prev => ({ ...prev, error: 'Fill every field before creating a service.' }));
            return;
        }
        const priceValue = Number(price);
        const ttlValue = Number(ttl);
        if (!Number.isFinite(priceValue) || priceValue <= 0) {
            setPolicyForm(prev => ({ ...prev, error: 'Price must be a positive number (in Mist).' }));
            return;
        }
        if (!Number.isFinite(ttlValue) || ttlValue <= 0) {
            setPolicyForm(prev => ({ ...prev, error: 'Duration must be a positive number of minutes.' }));
            return;
        }
        setPolicyForm(prev => ({ ...prev, submitting: true, error: undefined, success: undefined }));

        try {
            const tx = buildCreateServiceTransaction({
                packageId,
                priceMist: BigInt(Math.floor(priceValue)),
                ttlMinutes: BigInt(Math.floor(ttlValue)),
                name,
                sender: account.address,
            });

            const serialized = await tx.toJSON({ client: suiClient });
            const response = await sendMessage({
                type: 'SIGN_AND_EXECUTE',
                address: account.address,
                payload: { kind: 'custom', bytes: serialized },
            });
            if (!response.ok) {
                throw new Error(response.error ?? 'Unknown error creating service.');
            }
            setPolicyForm({ price: '', ttlMinutes: '', name: '', submitting: false, success: 'Service created. Refresh to see it listed.' });
            void refreshServices();
        } catch (error) {
            console.warn('[subscription] create service failed', error);
            setPolicyForm(prev => ({
                ...prev,
                submitting: false,
                error: error instanceof Error ? error.message : 'Failed to create service.',
            }));
        }
    }, [account.address, packageId, policyForm.name, policyForm.price, policyForm.ttlMinutes, refreshServices, suiClient]);

    const handleSecretFileChange = useCallback((files: FileList | null) => {
        const file = files?.[0];
        setSecretState(prev => ({
            ...prev,
            file: file ?? undefined,
            info: undefined,
            error: undefined,
            success: undefined,
        }));
    }, []);

    const handleEncryptAndUpload = useCallback(async () => {
        if (!selectedService || !selectedService.capId) {
            setSecretState(prev => ({ ...prev, error: 'Select a service before uploading content.' }));
            return;
        }
        if (!packageId) {
            setSecretState(prev => ({ ...prev, error: 'Package ID missing. Update it in extension options.' }));
            return;
        }
        if (!secretState.file) {
            setSecretState(prev => ({ ...prev, error: 'Choose an image file first.' }));
            return;
        }
        const walrusService = DEFAULT_WALRUS_SERVICES.find(item => item.id === secretState.aggregatorId) ?? DEFAULT_WALRUS_SERVICES[0];
        if (!walrusService) {
            setSecretState(prev => ({ ...prev, error: 'No Walrus service selected.' }));
            return;
        }
        if (secretState.file.size > 10 * 1024 * 1024) {
            setSecretState(prev => ({ ...prev, error: 'File size must stay under 10 MiB.' }));
            return;
        }
        if (!secretState.file.type.startsWith('image/')) {
            setSecretState(prev => ({ ...prev, error: 'Only image files are supported for secret content.' }));
            return;
        }
        setSecretState(prev => ({ ...prev, uploading: true, error: undefined, success: undefined }));
        try {
            const fileBytes = new Uint8Array(await secretState.file.arrayBuffer());
            const encryptedPayload = packSecretPayload(fileBytes, {
                mimeType: secretState.file.type || 'application/octet-stream',
                fileName: sanitizeFileName(secretState.file.name),
                size: fileBytes.length,
            });
            const baseBytes = fromHex(selectedService.id);
            const nonce = crypto.getRandomValues(new Uint8Array(5));
            const combined = new Uint8Array(baseBytes.length + nonce.length);
            combined.set(baseBytes, 0);
            combined.set(nonce, baseBytes.length);
            const walrusObjectId = toHex(combined);

            const { encryptedObject } = await sealClient.encrypt({
                threshold: 2,
                packageId,
                id: walrusObjectId,
                data: encryptedPayload,
            });

            const uploadResponse = await fetch(
                `${walrusService.publisherUrl.replace(/\/$/, '')}/v1/blobs?epochs=${WALRUS_DEFAULT_EPOCHS}`,
                {
                    method: 'PUT',
                    body: encryptedObject,
                },
            );
            if (!uploadResponse.ok) {
                throw new Error(`Walrus publisher responded with HTTP ${uploadResponse.status}`);
            }
            const responsePayload = await uploadResponse.json();
            const info = mapWalrusInfo(responsePayload, walrusService.aggregatorUrl);
            setSecretState(prev => ({
                ...prev,
                uploading: false,
                info,
                success: 'Encrypted blob uploaded to Walrus. Continue with the publish step.',
            }));
        } catch (error) {
            console.warn('[subscription] Walrus upload failed', error);
            setSecretState(prev => ({
                ...prev,
                uploading: false,
                error: error instanceof Error ? error.message : 'Failed to upload to Walrus.',
            }));
        }
    }, [packageId, sealClient, secretState.aggregatorId, secretState.file, selectedService]);

    const handlePublishSecret = useCallback(async () => {
        if (!selectedService || !selectedService.capId) {
            setSecretState(prev => ({ ...prev, error: 'Select a service that you created first.' }));
            return;
        }
        if (!packageId) {
            setSecretState(prev => ({ ...prev, error: 'Package ID missing. Update it in extension options.' }));
            return;
        }
        if (!secretState.info) {
            setSecretState(prev => ({ ...prev, error: 'Encrypt and upload your file before publishing.' }));
            return;
        }
        setSecretState(prev => ({ ...prev, publishing: true, error: undefined }));
        try {
            const tx = buildPublishSecretTransaction({
                packageId,
                serviceId: selectedService.id,
                capId: selectedService.capId,
                blobId: secretState.info.blobId,
                sender: account.address,
            });
            const serialized = await tx.toJSON({ client: suiClient });
            const response = await sendMessage({
                type: 'SIGN_AND_EXECUTE',
                address: account.address,
                payload: { kind: 'custom', bytes: serialized },
            });
            if (!response.ok) {
                throw new Error(response.error ?? 'Failed to publish blob on-chain.');
            }
            setSecretState(prev => ({
                ...prev,
                publishing: false,
                success: 'Blob attached to the subscription service.',
            }));
            void refreshServices();
        } catch (error) {
            console.warn('[subscription] publish failed', error);
            setSecretState(prev => ({
                ...prev,
                publishing: false,
                error: error instanceof Error ? error.message : 'Failed to publish encrypted blob.',
            }));
        }
    }, [account.address, packageId, refreshServices, secretState.info, selectedService, suiClient]);

    const loadFollowerService = useCallback(async () => {
        const serviceId = followerState.serviceIdInput.trim();
        if (!serviceId) {
            setFollowerState(prev => ({ ...prev, error: 'Enter a service object ID first.' }));
            return;
        }
        setFollowerState(prev => {
            cleanupDecryptedFiles(prev.decryptedFiles);
            return { ...prev, loading: true, error: undefined, decryptedFiles: [] };
        });
        try {
            const service = await fetchServiceSummary(suiClient, serviceId);
            if (!service) {
                throw new Error('Service not found on Sui.');
            }
            if (!packageId) {
                throw new Error('Package ID missing. Update it in extension options.');
            }
            const subscriptionId = await findActiveSubscription(
                suiClient,
                serviceId,
                account.address,
                service.ttlMs,
                packageId,
            );
            setFollowerState(prev => ({
                ...prev,
                loading: false,
                service: subscriptionId ? { ...service, subscriptionId } : { ...service },
            }));
        } catch (error) {
            console.warn('[subscription] failed to load follower service', error);
            setFollowerState(prev => ({
                ...prev,
                loading: false,
                service: undefined,
                error: error instanceof Error ? error.message : 'Unable to load service.',
            }));
        }
    }, [account.address, followerState.serviceIdInput, packageId, suiClient]);

    const handleSubscribe = useCallback(async () => {
        const service = followerState.service;
        if (!service) {
            setFollowerState(prev => ({ ...prev, error: 'Load a service before subscribing.' }));
            return;
        }
        if (!packageId) {
            setFollowerState(prev => ({ ...prev, error: 'Package ID missing. Update it in extension options.' }));
            return;
        }
        if (service.subscriptionId) {
            setFollowerState(prev => ({ ...prev, error: 'This account already has an active subscription.' }));
            return;
        }
        setFollowerState(prev => ({ ...prev, loading: true, error: undefined }));
        try {
            const tx = buildSubscribeTransaction({
                packageId,
                serviceId: service.id,
                feeMist: service.fee,
                sender: account.address,
            });
            const serialized = await tx.toJSON({ client: suiClient });
            const response = await sendMessage({
                type: 'SIGN_AND_EXECUTE',
                address: account.address,
                payload: { kind: 'custom', bytes: serialized },
            });
            if (!response.ok) {
                throw new Error(response.error ?? 'Subscription transaction failed.');
            }
            setFollowerState(prev => ({ ...prev, loading: false }));
            setFollowerState(prev => ({ ...prev, service: { ...service, subscriptionId: 'pending-refresh' } }));
            await loadFollowerService();
        } catch (error) {
            console.warn('[subscription] subscribe failed', error);
            setFollowerState(prev => ({
                ...prev,
                loading: false,
                error: error instanceof Error ? error.message : 'Failed to subscribe to this service.',
            }));
        }
    }, [account.address, followerState.service, loadFollowerService, packageId, suiClient]);

    const handleDecrypt = useCallback(async () => {
        const service = followerState.service;
        if (!service || !service.subscriptionId) {
            setFollowerState(prev => ({ ...prev, error: 'Subscribe first to unlock the content.' }));
            return;
        }
        if (service.blobIds.length === 0) {
            setFollowerState(prev => ({ ...prev, error: 'No encrypted files uploaded yet.' }));
            return;
        }
        if (!packageId) {
            setFollowerState(prev => ({ ...prev, error: 'Package ID missing. Update it in extension options.' }));
            return;
        }
        setFollowerState(prev => ({ ...prev, decrypting: true, error: undefined }));
        try {
            const sessionKey = await SessionKey.create({
                address: account.address,
                packageId,
                ttlMin: SESSION_TTL_MINUTES,
                suiClient,
            });
            const personalMessage = sessionKey.getPersonalMessage();
            const signatureResponse = await sendMessage({
                type: 'SIGN_PERSONAL_MESSAGE',
                address: account.address,
                messageBase64: uint8ToBase64(personalMessage),
            });
            if (!signatureResponse.ok) {
                throw new Error(signatureResponse.error ?? 'Failed to sign session key.');
            }
            await sessionKey.setPersonalMessageSignature(signatureResponse.data.signature);

            const files = await downloadAndDecrypt({
                blobIds: service.blobIds,
                sessionKey,
                suiClient,
                sealClient,
                serviceId: service.id,
                subscriptionId: service.subscriptionId,
                packageId,
            });
            setFollowerState(prev => {
                cleanupDecryptedFiles(prev.decryptedFiles);
                return { ...prev, decrypting: false, decryptedFiles: files };
            });
        } catch (error) {
            console.warn('[subscription] decrypt failed', error);
            setFollowerState(prev => ({
                ...prev,
                decrypting: false,
                error: error instanceof Error ? error.message : 'Unable to decrypt content right now.',
            }));
        }
    }, [account.address, followerState.service, packageId, sealClient, suiClient]);

    return (
        <div className="zklogin-section" style={{ gap: '0.9em' }}>
            <div className="zklogin-subtabs">
                <button
                    className={`zklogin-subtab ${activeRole === 'streamer' ? 'zklogin-subtab--active' : ''}`}
                    onClick={() => setActiveRole('streamer')}
                    type="button"
                >
                    Streamer
                </button>
                <button
                    className={`zklogin-subtab ${activeRole === 'follower' ? 'zklogin-subtab--active' : ''}`}
                    onClick={() => setActiveRole('follower')}
                    type="button"
                >
                    Follower
                </button>
            </div>

            {activeRole === 'streamer' ? (
                <div className="zklogin-streamer">
                    <h4>Create subscription service</h4>
                    <p className="zklogin-muted">
                        Set the access policy for your streamer subscription and prepare a public cover image.
                    </p>
                    <div className="zklogin-form">
                        <label>
                            Package ID
                            <input value={packageId} placeholder="Set in options" readOnly className="zklogin-input--readonly" />
                        </label>
                        <label>
                            Price in Mist
                            <input
                                value={policyForm.price}
                                onChange={event => setPolicyForm(prev => ({ ...prev, price: event.target.value }))}
                                placeholder="e.g. 100000000"
                            />
                        </label>
                        <label>
                            Subscription duration (minutes)
                            <input
                                value={policyForm.ttlMinutes}
                                onChange={event => setPolicyForm(prev => ({ ...prev, ttlMinutes: event.target.value }))}
                                placeholder="e.g. 60"
                            />
                        </label>
                        <label>
                            Service name
                            <input
                                value={policyForm.name}
                                onChange={event => setPolicyForm(prev => ({ ...prev, name: event.target.value }))}
                                placeholder="Give your service a friendly name"
                            />
                        </label>
                        {policyForm.error && <div className="zklogin-alert zklogin-alert--error">{policyForm.error}</div>}
                        {policyForm.success && <div className="zklogin-alert zklogin-alert--success">{policyForm.success}</div>}
                        <div className="zklogin-cover-upload">
                            <label className="zklogin-cover-upload__field">
                                <input
                                    key={nftUploadState.resetCounter}
                                    type="file"
                                    accept="image/*"
                                    disabled={nftUploadState.uploading}
                                    onChange={event => onNftFileChange(event.target.files)}
                                />
                                <span className="zklogin-cover-upload__hint">
                                    {nftUploadState.file ? nftUploadState.file.name : '선택된 파일 없음'}
                                </span>
                            </label>
                            <button
                                className="zklogin-btn"
                                type="button"
                                disabled={nftUploadState.uploading}
                                onClick={() => { void onNftUpload(); }}
                            >
                                {nftUploadState.uploading ? 'Uploading…' : 'Upload cover image'}
                            </button>
                        </div>
                        {nftUploadState.error && <div className="zklogin-alert zklogin-alert--error">{nftUploadState.error}</div>}
                        {nftUploadState.successMessage && (
                            <div className="zklogin-alert zklogin-alert--success">{nftUploadState.successMessage}</div>
                        )}
                        <button className="zklogin-btn zklogin-btn--primary" disabled={policyForm.submitting} onClick={() => { void handleCreateService(); }}>
                            {policyForm.submitting ? 'Creating…' : 'Create service'}
                        </button>
                        <button className="zklogin-btn" disabled={servicesLoading} onClick={() => { void refreshServices(); }}>
                            {servicesLoading ? 'Refreshing…' : 'Refresh services'}
                        </button>
                    </div>

                    <div style={{ height: 1, background: 'rgba(148, 163, 184, 0.25)' }} />

                    <h4>Owned services</h4>
                    {servicesError && <div className="zklogin-alert zklogin-alert--error">{servicesError}</div>}
                    {services.length === 0 ? (
                        <p className="zklogin-muted">No services created yet. Use the form above to create one.</p>
                    ) : (
                        <div className="zklogin-service-list">
                            {services.map(service => (
                                <button
                                    key={service.id}
                                    className={`zklogin-service ${selectedServiceId === service.id ? 'zklogin-service--active' : ''}`}
                                    onClick={() => setSelectedServiceId(service.id)}
                                    type="button"
                                >
                                    <span>{service.name || shortenId(service.id)}</span>
                                    <span className="zklogin-muted">Fee {service.fee.toString()} Mist · TTL {formatMinutes(service.ttlMs)}m</span>
                                </button>
                            ))}
                        </div>
                    )}

                    {selectedService && (
                        <div className="zklogin-service-detail">
                            <p>
                                Share this service ID with followers: <code>{selectedService.id}</code>
                            </p>
                            <p className="zklogin-muted">
                                Attach encrypted files below. Only subscribers holding a valid subscription NFT will decrypt them.
                            </p>

                            <div className="zklogin-form zklogin-form--secret">
                                <label className="zklogin-secret-upload">
                                    Secret image for subscribers
                                    <input type="file" accept="image/*" onChange={event => handleSecretFileChange(event.target.files)} />
                                </label>
                                <label>
                                    Walrus service
                                    <select
                                        value={secretState.aggregatorId}
                                        onChange={event => setSecretState(prev => ({ ...prev, aggregatorId: event.target.value as WalrusService['id'] }))}
                                    >
                                        {DEFAULT_WALRUS_SERVICES.map(service => (
                                            <option key={service.id} value={service.id}>
                                                {service.name}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                {secretState.error && <div className="zklogin-alert zklogin-alert--error">{secretState.error}</div>}
                                {secretState.success && <div className="zklogin-alert zklogin-alert--success">{secretState.success}</div>}
                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                    <button
                                        className="zklogin-btn zklogin-btn--primary"
                                        onClick={() => { void handleEncryptAndUpload(); }}
                                        disabled={secretState.uploading}
                                        type="button"
                                    >
                                        {secretState.uploading ? 'Uploading…' : 'Encrypt & upload'}
                                    </button>
                                    <button
                                        className="zklogin-btn"
                                        onClick={() => { void handlePublishSecret(); }}
                                        disabled={secretState.publishing}
                                        type="button"
                                    >
                                        {secretState.publishing ? 'Publishing…' : 'Publish to service'}
                                    </button>
                                </div>
                                {secretState.info && (
                                    <div className="zklogin-walrus-info">
                                        <div>Status: {secretState.info.status}</div>
                                        <div>
                                            Blob ID: <code>{secretState.info.blobId}</code>
                                        </div>
                                        <div>
                                            <a href={secretState.info.blobUrl} target="_blank" rel="noopener noreferrer">Encrypted blob</a>
                                        </div>
                                        <div>
                                            <a href={secretState.info.suiUrl} target="_blank" rel="noopener noreferrer">{secretState.info.suiRefType}</a>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div style={{ height: 1, background: 'rgba(148, 163, 184, 0.25)' }} />
                        </div>
                    )}
                </div>
            ) : (
                <div className="zklogin-follower">
                    <h4>Access a streamer service</h4>
                    <p className="zklogin-muted">
                        Paste the service ID shared by the streamer. You will be able to subscribe and decrypt exclusive content.
                    </p>
                    <div className="zklogin-form">
                        <label>
                            Service object ID
                            <input
                                value={followerState.serviceIdInput}
                                onChange={event => setFollowerState(prev => ({ ...prev, serviceIdInput: event.target.value }))}
                                placeholder="0x..."
                            />
                        </label>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button className="zklogin-btn zklogin-btn--primary" disabled={followerState.loading} onClick={() => { void loadFollowerService(); }}>
                                {followerState.loading ? 'Loading…' : 'Load service'}
                            </button>
                            <button className="zklogin-btn" disabled={!followerState.service || followerState.loading} onClick={() => { void handleSubscribe(); }}>
                                Subscribe
                            </button>
                            <button
                                className="zklogin-btn"
                                disabled={!followerState.service?.subscriptionId || followerState.decrypting}
                                onClick={() => { void handleDecrypt(); }}
                            >
                                {followerState.decrypting ? 'Decrypting…' : 'Decrypt content'}
                            </button>
                        </div>
                        {followerState.error && <div className="zklogin-alert zklogin-alert--error">{followerState.error}</div>}
                    </div>

                    {followerState.service && (
                        <div className="zklogin-service-detail">
                            <p>
                                <strong>{followerState.service.name || shortenId(followerState.service.id)}</strong>
                            </p>
                            <p className="zklogin-muted">
                                Fee {followerState.service.fee.toString()} Mist · Duration {formatMinutes(followerState.service.ttlMs)} minutes
                            </p>
                            <p>
                                {followerState.service.subscriptionId
                                    ? 'Active subscription detected for this account.'
                                    : 'No active subscription. Complete the purchase to view encrypted files.'}
                            </p>
                            <p className="zklogin-muted">
                                {followerState.service.blobIds.length} encrypted file(s) uploaded.
                            </p>
                        </div>
                    )}

                    {followerState.decryptedFiles.length > 0 && (
                        <div className="zklogin-secret-gallery">
                            {followerState.decryptedFiles.map((file, index) => (
                                <figure key={file.url} className="zklogin-secret-gallery__item">
                                    {file.mimeType.startsWith('image/') ? (
                                        <img src={file.url} alt={`Decrypted secret ${index + 1}`} />
                                    ) : (
                                        <div className="zklogin-secret-gallery__placeholder">
                                            <span>File {index + 1}</span>
                                        </div>
                                    )}
                                    <figcaption>
                                        <a
                                            href={file.url}
                                            download={file.fileName || `secret-${index + 1}${guessExtension(file.mimeType)}`}
                                        >
                                            {file.fileName || `Decrypted secret ${index + 1}`}
                                        </a>
                                        <span className="zklogin-secret-gallery__size">{formatBytes(file.size)}</span>
                                    </figcaption>
                                </figure>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function formatMinutes(ttl: bigint): number {
    if (ttl <= 0n) return 0;
    return Number(ttl / 1000n / 60n);
}

function shortenId(id: string): string {
    return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

async function fetchServiceSummary(suiClient: SuiClient, serviceId: string): Promise<ServiceSummary | null> {
    try {
        const service = await suiClient.getObject({ id: serviceId, options: { showContent: true } });
        const fields = ((service.data?.content as { fields?: any })?.fields) ?? null;
        if (!fields) {
            return null;
        }
        const dynamic = await suiClient.getDynamicFields({ parentId: serviceId }).catch(() => ({ data: [] }));
        const blobIds = dynamic.data
            .map(item => (item.name as { value?: string })?.value)
            .filter((value): value is string => Boolean(value));

        const fee = BigInt(String(fields.fee ?? '0'));
        const ttl = BigInt(String(fields.ttl ?? '0'));
        const owner = String(fields.owner ?? '');
        const name = String(fields.name ?? '');

        return {
            id: serviceId,
            name,
            fee,
            ttlMs: ttl,
            owner,
            blobIds,
        };
    } catch (error) {
        console.warn('[subscription] fetchServiceSummary failed', { serviceId, error });
        return null;
    }
}

async function findActiveSubscription(
    suiClient: SuiClient,
    serviceId: string,
    owner: string,
    ttlMs: bigint,
    packageId: string,
): Promise<string | undefined> {
    try {
        const [subscriptions, clock] = await Promise.all([
            suiClient.getOwnedObjects({
                owner,
                options: { showContent: true, showType: true },
                filter: { StructType: `${packageId}::${MODULE_NAME}::Subscription` },
            }),
            suiClient.getObject({ id: SUI_CLOCK_OBJECT_ID, options: { showContent: true } }),
        ]);
        const nowMs = BigInt(String(((clock.data?.content as { fields?: any })?.fields?.timestamp_ms) ?? '0'));
        for (const item of subscriptions.data) {
            const fields = ((item.data?.content as { fields?: any })?.fields) ?? null;
            if (!fields) {
                continue;
            }
            if (fields.service_id !== serviceId) {
                continue;
            }
            const createdAt = BigInt(String(fields.created_at ?? '0'));
            if (createdAt + ttlMs > nowMs) {
                return fields.id?.id as string | undefined;
            }
        }
        return undefined;
    } catch (error) {
        console.warn('[subscription] findActiveSubscription failed', error);
        return undefined;
    }
}

async function downloadAndDecrypt(params: {
    blobIds: string[];
    sessionKey: SessionKey;
    suiClient: SuiClient;
    sealClient: SealClient;
    serviceId: string;
    subscriptionId: string;
    packageId: string;
}): Promise<DecryptedFile[]> {
    const { blobIds, sessionKey, suiClient, sealClient, serviceId, subscriptionId, packageId } = params;
    const aggregatorUrls = DEFAULT_WALRUS_SERVICES.map(item => `${item.aggregatorUrl.replace(/\/$/, '')}/v1/blobs/`);

    const downloaded: Array<{ blobId: string; bytes: Uint8Array }> = [];
    for (const blobId of blobIds) {
        const aggregator = aggregatorUrls[Math.floor(Math.random() * aggregatorUrls.length)] ?? aggregatorUrls[0];
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10_000);
            const response = await fetch(`${aggregator}${blobId}`, { signal: controller.signal });
            clearTimeout(timeout);
            if (!response.ok) {
                continue;
            }
            const buffer = await response.arrayBuffer();
            downloaded.push({ blobId, bytes: new Uint8Array(buffer) });
        } catch (error) {
            console.warn('[subscription] failed to download blob', { blobId, error: String(error) });
        }
    }

    if (downloaded.length === 0) {
        throw new Error('Failed to download encrypted files from Walrus. Try again.');
    }

    const moveCall = (tx: Transaction, id: string) => {
        tx.moveCall({
            target: `${packageId}::${MODULE_NAME}::seal_approve`,
            arguments: [
                tx.pure.vector('u8', fromHex(id)),
                tx.object(subscriptionId),
                tx.object(serviceId),
                tx.object(SUI_CLOCK_OBJECT_ID),
            ],
        });
    };

    // Fetch keys in batches
    for (let index = 0; index < downloaded.length; index += 10) {
        const batch = downloaded.slice(index, index + 10);
        const ids = batch.map(item => EncryptedObject.parse(item.bytes).id);
        const tx = new Transaction();
        ids.forEach(id => moveCall(tx, id));
        const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });
        try {
            await sealClient.fetchKeys({ ids, txBytes, sessionKey, threshold: 2 });
        } catch (error) {
            if (error instanceof NoAccessError) {
                throw new Error('No access to decryption keys. Subscription may be expired.');
            }
            throw new Error('Unable to fetch decryption keys.');
        }
    }

    const decryptedFiles: DecryptedFile[] = [];
    for (const encrypted of downloaded) {
        const fullId = EncryptedObject.parse(encrypted.bytes).id;
        const tx = new Transaction();
        moveCall(tx, fullId);
        const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });
        try {
            const decrypted = await sealClient.decrypt({
                data: encrypted.bytes,
                sessionKey,
                txBytes,
            });
            const { bytes, metadata } = unpackSecretPayload(decrypted);
            const detectedMime = detectMimeType(bytes);
            const mimeType = typeof metadata.mimeType === 'string' && metadata.mimeType
                ? metadata.mimeType
                : detectedMime ?? 'image/png';
            const fileName = sanitizeFileName(metadata.fileName);
            const blob = new Blob([bytes], { type: mimeType });
            decryptedFiles.push({
                url: URL.createObjectURL(blob),
                fileName,
                mimeType,
                size: bytes.byteLength,
            });
        } catch (error) {
            if (error instanceof NoAccessError) {
                throw new Error('No access to decryption keys.');
            }
            throw new Error('Unable to decrypt files.');
        }
    }

    return decryptedFiles;
}

function mapWalrusInfo(payload: any, aggregatorUrl: string): SecretUploadInfo {
    if (payload?.alreadyCertified) {
        const entry = payload.alreadyCertified;
        return {
            status: 'Already certified',
            blobId: entry.blobId,
            suiRefType: 'Previous Sui Certified Event',
            suiRef: entry.event?.txDigest,
            blobUrl: `${aggregatorUrl.replace(/\/$/, '')}/v1/blobs/${entry.blobId}`,
            suiUrl: `https://suiscan.xyz/testnet/tx/${entry.event?.txDigest}`,
        };
    }
    if (payload?.newlyCreated) {
        const entry = payload.newlyCreated;
        return {
            status: 'Newly created',
            blobId: entry.blobObject?.blobId,
            suiRefType: 'Associated Sui Object',
            suiRef: entry.blobObject?.id,
            blobUrl: `${aggregatorUrl.replace(/\/$/, '')}/v1/blobs/${entry.blobObject?.blobId}`,
            suiUrl: `https://suiscan.xyz/testnet/object/${entry.blobObject?.id}`,
        };
    }
    throw new Error('Unexpected Walrus response format.');
}

interface SecretMetadata {
    mimeType?: string;
    fileName?: string;
    size?: number;
}

function packSecretPayload(bytes: Uint8Array, metadata: SecretMetadata): Uint8Array {
    const metaObject: SecretMetadata = {
        ...metadata,
        size: metadata.size ?? bytes.byteLength,
    };
    let metaBytes: Uint8Array;
    try {
        metaBytes = new TextEncoder().encode(JSON.stringify(metaObject));
    } catch (error) {
        console.warn('[subscription] Failed to encode secret metadata', error);
        metaBytes = new Uint8Array(0);
    }
    const total = new Uint8Array(4 + metaBytes.length + bytes.length);
    new DataView(total.buffer).setUint32(0, metaBytes.length, true);
    total.set(metaBytes, 4);
    total.set(bytes, 4 + metaBytes.length);
    return total;
}

function unpackSecretPayload(payload: Uint8Array): { bytes: Uint8Array; metadata: SecretMetadata } {
    if (payload.byteLength < 4) {
        return { bytes: payload, metadata: {} };
    }
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const metaLength = view.getUint32(0, true);
    if (metaLength < 0 || metaLength > payload.byteLength - 4 || metaLength > 16_384) {
        return { bytes: payload.slice(), metadata: {} };
    }
    const metaBytes = payload.slice(4, 4 + metaLength);
    let metadata: SecretMetadata = {};
    try {
        metadata = JSON.parse(new TextDecoder().decode(metaBytes)) as SecretMetadata;
    } catch (error) {
        console.warn('[subscription] Failed to parse secret metadata', error);
        metadata = {};
    }
    const dataBytes = payload.slice(4 + metaLength);
    return { bytes: dataBytes, metadata };
}

function sanitizeFileName(name: string | undefined): string {
    if (!name) {
        return '';
    }
    return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 96);
}

function guessExtension(mimeType: string): string {
    const lookup: Record<string, string> = {
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/gif': '.gif',
        'image/webp': '.webp',
    };
    if (lookup[mimeType]) {
        return lookup[mimeType];
    }
    if (mimeType.startsWith('image/')) {
        return `.${mimeType.split('/')[1] ?? 'img'}`;
    }
    return '';
}

function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    const decimals = value >= 10 || unitIndex === 0 ? 0 : 1;
    return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

function cleanupDecryptedFiles(files: DecryptedFile[]): void {
    files.forEach(file => {
        try {
            URL.revokeObjectURL(file.url);
        } catch (error) {
            console.warn('[subscription] Failed to revoke object URL', error);
        }
    });
}

function detectMimeType(bytes: Uint8Array): string | null {
    if (bytes.length < 4) {
        return null;
    }
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
        return 'image/png';
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
        return 'image/jpeg';
    }
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
        return 'image/gif';
    }
    if (
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes.length >= 12 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    ) {
        return 'image/webp';
    }
    return null;
}
