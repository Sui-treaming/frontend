import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { AccountOverviewPayload } from '../../shared/messages';
import type { AccountPublicData, ExtensionState } from '../../shared/types';
import { sendMessage } from '../api/runtime';
import { OVERLAY_KEY, getWidgetOpacity, setWidgetOpacity } from '../../shared/storage';
import { makePolymediaUrl, NetworkName, shortenAddress } from '@polymedia/suitcase-core';
import { initWidgetScale } from '../responsive';

const NETWORK: NetworkName = 'devnet';
const DEFAULT_TABS: TabKey[] = ['overview', 'assets', 'nfts', 'activity'];

type TabKey = 'overview' | 'assets' | 'nfts' | 'activity' | 'actions';

type OverviewState = {
    data?: AccountOverviewPayload;
    loading: boolean;
    error?: string;
};

type AccountsMap = Record<string, OverviewState>;

type TransferFormState = {
    amount: string;
    recipient: string;
    submitting: boolean;
    error?: string;
    successDigest?: string;
};

const INITIAL_TRANSFER_FORM: TransferFormState = {
    amount: '',
    recipient: '',
    submitting: false,
};

export function App(): ReactElement | null {
    const [overlayEnabled, setOverlayEnabled] = useState(true);
    const [collapsed, setCollapsed] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [accounts, setAccounts] = useState<AccountPublicData[]>([]);
    const [overviews, setOverviews] = useState<AccountsMap>({});
    const [activeTabByAccount, setActiveTabByAccount] = useState<Record<string, TabKey>>({});
    const [transferForms, setTransferForms] = useState<Record<string, TransferFormState>>({});
    const [overlayOpacity, setOverlayOpacity] = useState(0.92);
    const [opacityPopoverOpen, setOpacityPopoverOpen] = useState(false);
    const [floatingPosition, setFloatingPosition] = useState<{ top: number; left: number } | null>(null);

    const overlayRef = useRef<HTMLDivElement | null>(null);
    const popoverRef = useRef<HTMLDivElement | null>(null);
    const dragDataRef = useRef<{
        pointerId: number;
        offsetX: number;
        offsetY: number;
        width: number;
        height: number;
    } | null>(null);

    const clamp = useCallback((value: number, min: number, max: number) => {
        return Math.min(Math.max(value, min), max);
    }, []);

    useEffect(() => {
        initWidgetScale();
    }, []);

    useEffect(() => {
        void bootstrap();
        void getWidgetOpacity()
            .then(value => {
                setOverlayOpacity(value);
            })
            .catch(error => {
                console.warn('[overlay] Failed to load widget opacity', error);
            });

        const root = document.getElementById('twitch-zklogin-wallet-root');
        if (root) {
            root.style.top = '20px';
            root.style.right = '20px';
            root.style.left = 'auto';
        }

        const handleStorageChange = (
            changes: Record<string, chrome.storage.StorageChange>,
            areaName: 'sync' | 'local' | 'managed' | 'session',
        ) => {
            if (areaName === 'sync' && Object.prototype.hasOwnProperty.call(changes, OVERLAY_KEY)) {
                const newValue = changes[OVERLAY_KEY].newValue;
                setOverlayEnabled(typeof newValue === 'boolean' ? newValue : true);
            }
        };

        chrome.storage.onChanged.addListener(handleStorageChange);
        return () => {
            chrome.storage.onChanged.removeListener(handleStorageChange);
        };
    }, []);

    useEffect(() => {
        const value = overlayOpacity.toString();
        document.documentElement.style.setProperty('--zklogin-overlay-opacity', value);

        const mount = document.getElementById('twitch-zklogin-wallet-root');
        if (mount) {
            mount.style.setProperty('--zklogin-overlay-opacity', value);
        }

        const overlay = overlayRef.current;
        if (overlay) {
            overlay.style.setProperty('--zklogin-overlay-opacity', value);
        }
    }, [overlayOpacity]);

    useEffect(() => {
        if (!collapsed) {
            setFloatingPosition(null);
            return;
        }

        const overlay = overlayRef.current;
        const updateInitialPosition = () => {
            const rect = overlay?.getBoundingClientRect();
            if (!rect) {
                return;
            }
            setFloatingPosition(prev => {
                if (prev) {
                    return {
                        top: clamp(prev.top, 16, Math.max(16, window.innerHeight - rect.height - 16)),
                        left: clamp(prev.left, 16, Math.max(16, window.innerWidth - rect.width - 16)),
                    };
                }
                const initialLeft = clamp(window.innerWidth - rect.width - 20, 16, Math.max(16, window.innerWidth - rect.width - 16));
                return { top: 16, left: initialLeft };
            });
        };

        const id = requestAnimationFrame(updateInitialPosition);

        const handleResize = () => {
            updateInitialPosition();
        };

        window.addEventListener('resize', handleResize);
        window.addEventListener('orientationchange', handleResize);

        return () => {
            cancelAnimationFrame(id);
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('orientationchange', handleResize);
        };
    }, [collapsed, clamp]);

    useEffect(() => {
        if (!collapsed) {
            setOpacityPopoverOpen(false);
        }
    }, [collapsed]);

    useEffect(() => {
        if (!opacityPopoverOpen) {
            return;
        }
        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest('[data-opacity-toggle]')) {
                return;
            }
            if (popoverRef.current && !popoverRef.current.contains(target)) {
                setOpacityPopoverOpen(false);
            }
        };
        document.addEventListener('pointerdown', handlePointerDown, true);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown, true);
        };
    }, [opacityPopoverOpen]);

    useEffect(() => {
        const root = document.getElementById('twitch-zklogin-wallet-root');
        if (!root) {
            return;
        }
        if (floatingPosition) {
            root.style.top = `${Math.round(floatingPosition.top)}px`;
            root.style.left = `${Math.round(floatingPosition.left)}px`;
            root.style.right = 'auto';
        } else {
            root.style.top = '20px';
            root.style.right = '20px';
            root.style.left = 'auto';
        }
    }, [floatingPosition]);

    useEffect(() => {
        accounts.forEach(account => {
            const current = overviews[account.address];
            if (!current || (!current.data && !current.loading && !current.error)) {
                void loadOverview(account.address);
            }
        });
    }, [accounts, overviews]);

    async function bootstrap(): Promise<void> {
        try {
            setLoading(true);
            const response = await sendMessage({ type: 'GET_EXTENSION_STATE' });
            const state: ExtensionState = response.data.state;
            setOverlayEnabled(state.overlayEnabled);
            setAccounts(state.accounts);
            const overviewState: AccountsMap = {};
            state.accounts.forEach(account => {
                overviewState[account.address] = { loading: false };
            });
            setOverviews(overviewState);
        } catch (err) {
            setError(extractMessage(err));
        } finally {
            setLoading(false);
        }
    }

    async function handleLogin(): Promise<void> {
        try {
            setError(null);
            setLoading(true);
            const response = await sendMessage({ type: 'START_TWITCH_LOGIN' });
            const newAccount = response.data.account;
            setAccounts(prev => {
                const without = prev.filter(acct => acct.address !== newAccount.address);
                return [newAccount, ...without];
            });
            setOverviews(prev => ({
                ...prev,
                [newAccount.address]: { loading: false },
            }));
            setActiveTabByAccount(prev => ({ ...prev, [newAccount.address]: 'overview' }));
        } catch (err) {
            setError(extractMessage(err));
        } finally {
            setLoading(false);
        }
    }

    async function loadOverview(address: string): Promise<void> {
        setOverviews(prev => ({
            ...prev,
            [address]: { ...prev[address], loading: true, error: undefined },
        }));
        try {
            const response = await sendMessage({ type: 'FETCH_ACCOUNT_OVERVIEW', address });
            setOverviews(prev => ({
                ...prev,
                [address]: { data: response.data.overview, loading: false },
            }));
        } catch (err) {
            setOverviews(prev => ({
                ...prev,
                [address]: { ...prev[address], loading: false, error: extractMessage(err) },
            }));
        }
    }

    async function handleLogout(address: string): Promise<void> {
        try {
            const response = await sendMessage({ type: 'LOGOUT_ACCOUNT', address });
            setAccounts(response.data.accounts);
            setOverviews(prev => {
                const copy = { ...prev };
                delete copy[address];
                return copy;
            });
            setActiveTabByAccount(prev => {
                const copy = { ...prev };
                delete copy[address];
                return copy;
            });
        } catch (err) {
            setError(extractMessage(err));
        }
    }

    async function handleTransfer(address: string): Promise<void> {
        setTransferForms(prev => ({
            ...prev,
            [address]: {
                ...(prev[address] ?? INITIAL_TRANSFER_FORM),
                submitting: true,
                error: undefined,
                successDigest: undefined,
            },
        }));

        const formState = transferForms[address] ?? INITIAL_TRANSFER_FORM;
        const amount = parseFloat(formState.amount);
        const recipient = formState.recipient.trim();

        if (!Number.isFinite(amount) || amount <= 0 || !recipient) {
            setTransferForms(prev => ({
                ...prev,
                [address]: {
                    ...(prev[address] ?? INITIAL_TRANSFER_FORM),
                    submitting: false,
                    error: 'Provide a recipient address and positive amount.',
                },
            }));
            return;
        }

        try {
            const response = await sendMessage({
                type: 'SIGN_AND_EXECUTE',
                address,
                payload: {
                    kind: 'transfer-sui',
                    amount,
                    recipient,
                },
            });
            setTransferForms(prev => ({
                ...prev,
                [address]: {
                    ...(prev[address] ?? INITIAL_TRANSFER_FORM),
                    amount: '',
                    recipient: '',
                    submitting: false,
                    successDigest: response.data.digest,
                },
            }));
            await loadOverview(address);
        } catch (err) {
            setTransferForms(prev => ({
                ...prev,
                [address]: {
                    ...(prev[address] ?? INITIAL_TRANSFER_FORM),
                    submitting: false,
                    error: extractMessage(err),
                },
            }));
        }
    }

    const sortedAccounts = useMemo(
        () => [...accounts].sort((a, b) => b.createdAt - a.createdAt),
        [accounts],
    );

    const handleOpacityValueChange = useCallback((value: number) => {
        const normalized = Math.min(1, Math.max(0.4, value));
        setOverlayOpacity(normalized);
        void setWidgetOpacity(normalized);
    }, []);

    const handleOpacitySliderChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const percent = Number(event.target.value);
        if (Number.isFinite(percent)) {
            handleOpacityValueChange(percent / 100);
        }
    }, [handleOpacityValueChange]);

    const handleOpacityStep = useCallback((step: number) => {
        handleOpacityValueChange(Math.round((overlayOpacity + step) * 100) / 100);
    }, [overlayOpacity, handleOpacityValueChange]);

    const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (!collapsed) {
            return;
        }
        const target = event.target as HTMLElement | null;
        if (target?.closest('button')) {
            return;
        }
        const overlay = overlayRef.current;
        if (!overlay) {
            return;
        }
        const rect = overlay.getBoundingClientRect();
        dragDataRef.current = {
            pointerId: event.pointerId,
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top,
            width: rect.width,
            height: rect.height,
        };
        overlay.setPointerCapture(event.pointerId);
        event.preventDefault();
    }, [collapsed]);

    const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const data = dragDataRef.current;
        if (!collapsed || !data || data.pointerId !== event.pointerId) {
            return;
        }
        const maxLeft = Math.max(16, window.innerWidth - data.width - 16);
        const maxTop = Math.max(16, window.innerHeight - data.height - 16);
        const newLeft = clamp(event.clientX - data.offsetX, 16, maxLeft);
        const newTop = clamp(event.clientY - data.offsetY, 16, maxTop);
        setFloatingPosition({ top: newTop, left: newLeft });
        event.preventDefault();
    }, [clamp, collapsed]);

    const clearDragState = useCallback((pointerId: number) => {
        const overlay = overlayRef.current;
        if (overlay && overlay.hasPointerCapture(pointerId)) {
            overlay.releasePointerCapture(pointerId);
        }
        dragDataRef.current = null;
    }, []);

    const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (dragDataRef.current?.pointerId === event.pointerId) {
            clearDragState(event.pointerId);
        }
    }, [clearDragState]);

    const handlePointerCancel = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (dragDataRef.current?.pointerId === event.pointerId) {
            clearDragState(event.pointerId);
        }
    }, [clearDragState]);

    if (!overlayEnabled) {
        return (
            <div className="zklogin-overlay-disabled">
                <button
                    className="zklogin-btn"
                    onClick={() => { chrome.runtime.openOptionsPage(); }}
                >
                    Enable zkLogin wallet overlay
                </button>
            </div>
        );
    }

    return (
        <div
            ref={overlayRef}
            className={`zklogin-overlay ${collapsed ? 'zklogin-overlay--collapsed' : ''}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            data-collapsed={collapsed ? 'true' : 'false'}
        >
            <header className="zklogin-overlay__header">
                <div>
                    <span className="zklogin-overlay__title">Twitch zkLogin Wallet</span>
                    <span className="zklogin-overlay__subtitle">Sui Devnet</span>
                </div>
                <div className="zklogin-overlay__header-actions">
                    <div className="zklogin-overlay__opacity">
                        <button
                            className="zklogin-icon-button"
                            data-opacity-toggle="true"
                            onClick={() => { setOpacityPopoverOpen(prev => !prev); }}
                            title="Adjust widget transparency"
                        >💧</button>
                        {opacityPopoverOpen && (
                            <div ref={popoverRef} className="zklogin-overlay__opacity-popover">
                                <div className="zklogin-overlay__opacity-row">
                                    <span>Opacity</span>
                                    <div className="zklogin-overlay__opacity-controls">
                                        <button
                                            className="zklogin-overlay__opacity-step"
                                            type="button"
                                            onClick={() => { handleOpacityStep(-0.02); }}
                                            title="Decrease opacity"
                                        >−</button>
                                        <button
                                            className="zklogin-overlay__opacity-step"
                                            type="button"
                                            onClick={() => { handleOpacityStep(0.02); }}
                                            title="Increase opacity"
                                        >+</button>
                                    </div>
                                </div>
                                <input
                                    className="zklogin-overlay__opacity-range"
                                    type="range"
                                    min={40}
                                    max={100}
                                    value={Math.round(overlayOpacity * 100)}
                                    onChange={handleOpacitySliderChange}
                                />
                                <div className="zklogin-overlay__opacity-value">{Math.round(overlayOpacity * 100)}%</div>
                            </div>
                        )}
                    </div>
                    <button
                        className="zklogin-icon-button"
                        onClick={() => { chrome.runtime.openOptionsPage(); }}
                        title="Open extension options"
                    >⚙️</button>
                    <button
                        className="zklogin-icon-button"
                        onClick={() => { setCollapsed(prev => !prev); }}
                        title={collapsed ? 'Expand widget' : 'Collapse widget'}
                    >{collapsed ? '🌅' : '🌊'}</button>
                </div>
            </header>

            {!collapsed && (
            <div className="zklogin-overlay__body">
                {error && <div className="zklogin-alert zklogin-alert--error">{error}</div>}

                {sortedAccounts.length === 0 && (
                    <div className="zklogin-empty">
                        <p>Connect with your Twitch account to bootstrap a zkLogin wallet.</p>
                        <button
                            className="zklogin-btn zklogin-btn--primary"
                            disabled={loading}
                            onClick={() => { void handleLogin(); }}
                        >
                            {loading ? 'Connecting…' : 'Connect Twitch'}
                        </button>
                    </div>
                )}

                {sortedAccounts.length > 0 && (
                    <div className="zklogin-actions">
                        <button
                            className="zklogin-btn zklogin-btn--primary"
                            disabled={loading}
                            onClick={() => { void handleLogin(); }}
                        >
                            {loading ? 'Connecting…' : 'Add another Twitch account'}
                        </button>
                    </div>
                )}

                {sortedAccounts.map(account => (
                    <section key={account.address} className="zklogin-card">
                        <header className="zklogin-card__header">
                            <div className="zklogin-card__identity">
                                <span className="zklogin-badge">Twitch</span>
                                <div className="zklogin-card__address">
                                    <span>{shortenAddress(account.address)}</span>
                                    <a
                                        href={makePolymediaUrl(NETWORK, 'address', account.address)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        View explorer ↗
                                    </a>
                                </div>
                                <div className="zklogin-card__meta">
                                    <span>sub: {account.sub}</span>
                                    <span>aud: {account.aud}</span>
                                </div>
                            </div>
                            <div>
                                <button
                                    className="zklogin-btn"
                                    onClick={() => { void loadOverview(account.address); }}
                                >
                                    Refresh data
                                </button>
                                <button
                                    className="zklogin-btn zklogin-btn--danger"
                                    onClick={() => { void handleLogout(account.address); }}
                                >
                                    Disconnect
                                </button>
                            </div>
                        </header>

                        <nav className="zklogin-tabs">
                            {DEFAULT_TABS.concat('actions').map(tab => (
                                <button
                                    key={tab}
                                    className={`zklogin-tab ${ (activeTabByAccount[account.address] ?? 'overview') === tab ? 'zklogin-tab--active' : '' }`}
                                    onClick={() => {
                                        setActiveTabByAccount(prev => ({ ...prev, [account.address]: tab }));
                                    }}
                                >
                                    {labelForTab(tab)}
                                </button>
                            ))}
                        </nav>

                        {renderTabContent(
                            account,
                            overviews[account.address] ?? { loading: false },
                            activeTabByAccount[account.address] ?? 'overview',
                            transferForms[account.address] ?? INITIAL_TRANSFER_FORM,
                        )}

                        {renderOverviewFooter(overviews[account.address])}
                    </section>
                ))}
            </div>
            )}
        </div>
    );

    function renderOverviewFooter(overviewState?: OverviewState): ReactElement | null {
        if (!overviewState) {
            return null;
        }
        if (overviewState.loading) {
            return <p className="zklogin-card__footer">Fetching on-chain data…</p>;
        }
        if (overviewState.error) {
            return <p className="zklogin-card__footer zklogin-card__footer--error">{overviewState.error}</p>;
        }
        if (!overviewState.data) {
            return null;
        }
        return <p className="zklogin-card__footer">Last updated just now. Data sourced from Sui Devnet.</p>;
    }

    function renderTabContent(
        account: AccountPublicData,
        state: OverviewState,
        tab: TabKey,
        transferForm: TransferFormState,
    ): ReactElement {
        if (state.loading) {
            return <div className="zklogin-section">Loading…</div>;
        }
        if (state.error) {
            return <div className="zklogin-section zklogin-section--error">{state.error}</div>;
        }
        const data = state.data;
        switch (tab) {
        case 'overview':
            return (
                <div className="zklogin-grid">
                    <div>
                        <label>Balance</label>
                        <strong>{formatNumber(data?.suiBalance ?? 0)} SUI</strong>
                    </div>
                    <div>
                        <label>Connected at</label>
                        <time>{new Date(account.createdAt).toLocaleString()}</time>
                    </div>
                    <div>
                        <label>Max epoch</label>
                        <span>{account.maxEpoch}</span>
                    </div>
                </div>
            );
        case 'assets':
            return (
                <div className="zklogin-section">
                    <h4>Coins</h4>
                    <ul className="zklogin-list">
                        <li key="sui">SUI — {formatNumber(data?.suiBalance ?? 0)}</li>
                        {(data?.coinBalances ?? []).map(coin => (
                            <li key={`${coin.type}`}>
                                {coin.type} — {formatNumber(coin.balance)}
                            </li>
                        ))}
                    </ul>
                </div>
            );
        case 'nfts':
            return (
                <div className="zklogin-section">
                    <h4>NFTs</h4>
                    {(!data || data.nfts.length === 0) && <p>No NFTs detected for this address.</p>}
                    <ul className="zklogin-list">
                        {(data?.nfts ?? []).map(nft => (
                            <li key={nft.objectId}>
                                <div>{nft.display} <span className="zklogin-muted">({shortenAddress(nft.objectId)})</span></div>
                                {nft.description && <div className="zklogin-muted">{nft.description}</div>}
                            </li>
                        ))}
                    </ul>
                </div>
            );
        case 'activity':
            return (
                <div className="zklogin-section">
                    <h4>Recent transactions</h4>
                    {(!data || data.recentTransactions.length === 0) && <p>No transactions yet.</p>}
                    <ul className="zklogin-list">
                        {(data?.recentTransactions ?? []).map(tx => (
                            <li key={tx.digest}>
                                <a
                                    href={makePolymediaUrl(NETWORK, 'tx', tx.digest)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    {shortenAddress(tx.digest)}
                                </a>
                                <span className="zklogin-muted">{tx.kind}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            );
        case 'actions':
            return (
                <div className="zklogin-section">
                    <h4>Send SUI</h4>
                    <div className="zklogin-form">
                        <label>
                            Amount (SUI)
                            <input
                                type="number"
                                min="0"
                                step="0.000001"
                                value={transferForm.amount}
                                onChange={event => {
                                    const value = event.target.value;
                                    setTransferForms(prev => ({
                                        ...prev,
                                        [account.address]: {
                                            ...(prev[account.address] ?? INITIAL_TRANSFER_FORM),
                                            amount: value,
                                        },
                                    }));
                                }}
                            />
                        </label>
                        <label>
                            Recipient address
                            <input
                                type="text"
                                value={transferForm.recipient}
                                onChange={event => {
                                    const value = event.target.value;
                                    setTransferForms(prev => ({
                                        ...prev,
                                        [account.address]: {
                                            ...(prev[account.address] ?? INITIAL_TRANSFER_FORM),
                                            recipient: value,
                                        },
                                    }));
                                }}
                                placeholder="0x..."
                            />
                        </label>
                        {transferForm.error && <div className="zklogin-alert zklogin-alert--error">{transferForm.error}</div>}
                        {transferForm.successDigest && (
                            <div className="zklogin-alert zklogin-alert--success">
                                Transaction {shortenAddress(transferForm.successDigest)} submitted.
                            </div>
                        )}
                        <button
                            className="zklogin-btn zklogin-btn--primary"
                            disabled={transferForm.submitting}
                            onClick={() => { void handleTransfer(account.address); }}
                        >
                            {transferForm.submitting ? 'Submitting…' : 'Sign and send'}
                        </button>
                    </div>
                </div>
            );
        default:
            return <div className="zklogin-section">Unsupported tab.</div>;
        }
    }
}

function formatNumber(value: number): string {
    return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function labelForTab(tab: TabKey): string {
    switch (tab) {
    case 'overview':
        return 'Overview';
    case 'assets':
        return 'Assets';
    case 'nfts':
        return 'NFTs';
    case 'activity':
        return 'Activity';
    case 'actions':
        return 'Actions';
    default:
        return tab;
    }
}

function extractMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === 'string') {
        return error;
    }
    return 'Unexpected error';
}
