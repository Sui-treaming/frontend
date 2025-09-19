import { useEffect, useMemo, useState } from 'react';
import type { AccountOverviewPayload } from '../../shared/messages';
import type { AccountPublicData, ExtensionState } from '../../shared/types';
import { sendMessage } from '../api/runtime';
import { OVERLAY_KEY } from '../../shared/storage';
import { makePolymediaUrl, NetworkName, shortenAddress } from '@polymedia/suitcase-core';

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

export function App(): JSX.Element | null {
    const [overlayEnabled, setOverlayEnabled] = useState(true);
    const [collapsed, setCollapsed] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [accounts, setAccounts] = useState<AccountPublicData[]>([]);
    const [overviews, setOverviews] = useState<AccountsMap>({});
    const [activeTabByAccount, setActiveTabByAccount] = useState<Record<string, TabKey>>({});
    const [transferForms, setTransferForms] = useState<Record<string, TransferFormState>>({});

    useEffect(() => {
        void bootstrap();

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
        <div className={`zklogin-overlay ${collapsed ? 'zklogin-overlay--collapsed' : ''}`}>
            <header className="zklogin-overlay__header">
                <div>
                    <span className="zklogin-overlay__title">Twitch zkLogin Wallet</span>
                    <span className="zklogin-overlay__subtitle">Sui Devnet</span>
                </div>
                <div className="zklogin-overlay__header-actions">
                    <button
                        className="zklogin-icon-button"
                        onClick={() => { chrome.runtime.openOptionsPage(); }}
                        title="Open extension options"
                    >⚙️</button>
                    <button
                        className="zklogin-icon-button"
                        onClick={() => { setCollapsed(prev => !prev); }}
                        title={collapsed ? 'Expand' : 'Collapse'}
                    >{collapsed ? '▢' : '–'}</button>
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

    function renderOverviewFooter(overviewState?: OverviewState): JSX.Element | null {
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
    ): JSX.Element {
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
                                    href={makePolymediaUrl(NETWORK, 'txblock', tx.digest)}
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
