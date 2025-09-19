import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { AccountOverviewPayload } from '../../shared/messages';
import type { AccountPublicData, ExtensionState } from '../../shared/types';
import { sendMessage } from '../../content/api/runtime';
import { makePolymediaUrl, NetworkName, shortenAddress } from '@polymedia/suitcase-core';

const NETWORK: NetworkName = 'devnet';

type OverviewStatus = {
    data?: AccountOverviewPayload;
    loading: boolean;
    error?: string;
};

export function PopupApp(): ReactElement {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [overlayEnabled, setOverlayEnabled] = useState(true);
    const [accounts, setAccounts] = useState<AccountPublicData[]>([]);
    const [overviewByAddress, setOverviewByAddress] = useState<Record<string, OverviewStatus>>({});
    const [selectedAddress, setSelectedAddress] = useState<string | null>(null);

    useEffect(() => {
        void bootstrap();
    }, []);

    useEffect(() => {
        if (!selectedAddress) {
            return;
        }
        const overview = overviewByAddress[selectedAddress];
        if (!overview || (!overview.data && !overview.loading && !overview.error)) {
            void loadOverview(selectedAddress);
        }
    }, [selectedAddress, overviewByAddress]);

    const sortedAccounts = useMemo(
        () => [...accounts].sort((a, b) => b.createdAt - a.createdAt),
        [accounts],
    );

    async function bootstrap(): Promise<void> {
        try {
            setLoading(true);
            const response = await sendMessage({ type: 'GET_EXTENSION_STATE' });
            const state: ExtensionState = response.data.state;
            setOverlayEnabled(state.overlayEnabled);
            setAccounts(state.accounts);
            const overviewState: Record<string, OverviewStatus> = {};
            state.accounts.forEach(account => {
                overviewState[account.address] = { loading: false };
            });
            setOverviewByAddress(overviewState);
            if (state.accounts[0]) {
                setSelectedAddress(state.accounts[0].address);
            }
        } catch (err) {
            setError(extractMessage(err));
        } finally {
            setLoading(false);
        }
    }

    async function handleLogin(): Promise<void> {
        try {
            setLoading(true);
            setError(null);
            const response = await sendMessage({ type: 'START_TWITCH_LOGIN' });
            const account = response.data.account;
            setAccounts(prev => {
                const filtered = prev.filter(item => item.address !== account.address);
                return [account, ...filtered];
            });
            setOverviewByAddress(prev => ({
                ...prev,
                [account.address]: { loading: false },
            }));
            setSelectedAddress(account.address);
        } catch (err) {
            setError(extractMessage(err));
        } finally {
            setLoading(false);
        }
    }

    async function loadOverview(address: string): Promise<void> {
        setOverviewByAddress(prev => ({
            ...prev,
            [address]: { ...prev[address], loading: true, error: undefined },
        }));
        try {
            const response = await sendMessage({ type: 'FETCH_ACCOUNT_OVERVIEW', address });
            setOverviewByAddress(prev => ({
                ...prev,
                [address]: { data: response.data.overview, loading: false },
            }));
        } catch (err) {
            setOverviewByAddress(prev => ({
                ...prev,
                [address]: { ...prev[address], loading: false, error: extractMessage(err) },
            }));
        }
    }

    async function toggleOverlay(enabled: boolean): Promise<void> {
        setOverlayEnabled(enabled);
        try {
            await sendMessage({ type: 'SET_OVERLAY_ENABLED', enabled });
        } catch (err) {
            setError(extractMessage(err));
        }
    }

    async function handleLogout(address: string): Promise<void> {
        try {
            const response = await sendMessage({ type: 'LOGOUT_ACCOUNT', address });
            setAccounts(response.data.accounts);
            setOverviewByAddress(prev => {
                const copy = { ...prev };
                delete copy[address];
                return copy;
            });
            if (selectedAddress === address) {
                setSelectedAddress(response.data.accounts[0]?.address ?? null);
            }
        } catch (err) {
            setError(extractMessage(err));
        }
    }

    const selectedOverview = selectedAddress ? overviewByAddress[selectedAddress] : undefined;
    const selectedAccount = selectedAddress ? accounts.find(acct => acct.address === selectedAddress) : undefined;

    return (
        <div className="popup">
            <header className="popup__header">
                <div>
                    <h1>Twitch zkLogin Wallet</h1>
                    <span>Sui Devnet</span>
                </div>
                <button
                    className="popup__gear"
                    onClick={() => { chrome.runtime.openOptionsPage(); }}
                    title="Open extension options"
                >⚙️</button>
            </header>

            {error && <div className="popup__alert popup__alert--error">{error}</div>}

            <section className="popup__section">
                <button
                    className="popup__button popup__button--primary"
                    disabled={loading}
                    onClick={() => { void handleLogin(); }}
                >
                    {loading ? 'Connecting…' : 'Connect Twitch account'}
                </button>
                <label className="popup__switch">
                    <input
                        type="checkbox"
                        checked={overlayEnabled}
                        onChange={event => { void toggleOverlay(event.target.checked); }}
                    />
                    <span>Show overlay on twitch.tv</span>
                </label>
            </section>

            <section className="popup__section">
                <h2>Accounts</h2>
                {sortedAccounts.length === 0 && <p className="popup__muted">No accounts connected yet.</p>}
                {sortedAccounts.length > 0 && (
                    <div className="popup__accounts">
                        {sortedAccounts.map(account => (
                            <button
                                key={account.address}
                                className={`popup__account ${selectedAddress === account.address ? 'popup__account--active' : ''}`}
                                onClick={() => {
                                    setSelectedAddress(account.address);
                                }}
                            >
                                <span className="popup__account-label">{shortenAddress(account.address)}</span>
                                <span className="popup__account-meta">{new Date(account.createdAt).toLocaleDateString()}</span>
                            </button>
                        ))}
                    </div>
                )}
            </section>

            {selectedAccount && (
            <section className="popup__section popup__section--detail">
                <header className="popup__detail-header">
                    <div>
                        <span className="popup__badge">Twitch</span>
                        <a
                            href={makePolymediaUrl(NETWORK, 'address', selectedAccount.address)}
                            target="_blank"
                            rel="noopener noreferrer"
                        >View on explorer ↗</a>
                    </div>
                    <button
                        className="popup__button popup__button--light"
                        onClick={() => { void handleLogout(selectedAccount.address); }}
                    >Disconnect</button>
                </header>

                <div className="popup__detail-body">
                    {selectedOverview?.loading && <p className="popup__muted">Loading overview…</p>}
                    {selectedOverview?.error && (
                        <p className="popup__alert popup__alert--error">{selectedOverview.error}</p>
                    )}
                    {selectedOverview?.data && (
                        <>
                            <div className="popup__stat">
                                <label>Balance</label>
                                <strong>{formatNumber(selectedOverview.data.suiBalance)} SUI</strong>
                            </div>
                            <div className="popup__stat">
                                <label>NFTs</label>
                                <span>{selectedOverview.data.nfts.length}</span>
                            </div>
                            <div className="popup__stat">
                                <label>Last activity</label>
                                <span>{formatTimestamp(selectedOverview.data.recentTransactions[0]?.timestampMs)}</span>
                            </div>
                        </>
                    )}
                    {selectedOverview?.data && selectedOverview.data.recentTransactions.length > 0 && (
                        <div className="popup__recent">
                            <h3>Recent transactions</h3>
                            <ul>
                                {selectedOverview.data.recentTransactions.slice(0, 5).map(tx => (
                                    <li key={tx.digest}>
                                        <a
                                            href={makePolymediaUrl(NETWORK, 'tx', tx.digest)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >{shortenAddress(tx.digest)}</a>
                                        <span>{tx.kind}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            </section>
            )}
        </div>
    );
}

function formatTimestamp(value?: string): string {
    if (!value) {
        return '—';
    }
    const ms = Number(value);
    if (!Number.isFinite(ms)) {
        return '—';
    }
    return new Date(ms).toLocaleString();
}

function formatNumber(value: number): string {
    return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
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
