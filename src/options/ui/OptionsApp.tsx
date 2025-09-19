import { useEffect, useState, type ReactElement } from 'react';
import { DEFAULT_CONFIG, getOverlayEnabled, loadConfig, saveConfig, setOverlayEnabled, SESSION_KEY } from '../../shared/storage';
import type { ExtensionConfig } from '../../shared/types';

interface StatusState {
    message: string;
    tone: 'neutral' | 'positive' | 'negative';
}

const initialStatus: StatusState = { message: '', tone: 'neutral' };

export function OptionsApp(): ReactElement {
    const [config, setConfig] = useState<ExtensionConfig>(DEFAULT_CONFIG);
    const [overlayEnabled, setOverlaySwitch] = useState(true);
    const [status, setStatus] = useState<StatusState>(initialStatus);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        void bootstrap();
    }, []);

    async function bootstrap(): Promise<void> {
        const [storedConfig, overlay] = await Promise.all([loadConfig(), getOverlayEnabled()]);
        setConfig(storedConfig);
        setOverlaySwitch(overlay);
    }

    async function handleSave(): Promise<void> {
        try {
            setStatus(initialStatus);
            setSaving(true);
            await saveConfig(config);
            setStatus({ message: 'Configuration saved successfully.', tone: 'positive' });
        } catch (error) {
            setStatus({ message: extractMessage(error), tone: 'negative' });
        } finally {
            setSaving(false);
        }
    }

    async function handleOverlayToggle(enabled: boolean): Promise<void> {
        setOverlaySwitch(enabled);
        await setOverlayEnabled(enabled);
        setStatus({
            message: enabled ? 'Overlay enabled on Twitch.' : 'Overlay disabled. Reload Twitch to hide the panel.',
            tone: 'neutral',
        });
    }

    async function handleClearSessions(): Promise<void> {
        await chrome.storage.session.remove(SESSION_KEY);
        setStatus({ message: 'Ephemeral zkLogin sessions cleared. Users must log in again.', tone: 'neutral' });
    }

    const redirectUriHint = chrome.identity.getRedirectURL('twitch');

    return (
        <main className="options">
            <header className="options__header">
                <h1>Twitch zkLogin Wallet</h1>
                <p>Configure Twitch OAuth and Sui zkLogin integration for the Chrome extension.</p>
            </header>

            <section className="options__card">
                <h2>Overlay</h2>
                <label className="options__toggle">
                    <input
                        type="checkbox"
                        checked={overlayEnabled}
                        onChange={event => { void handleOverlayToggle(event.target.checked); }}
                    />
                    <span>Show wallet overlay on twitch.tv</span>
                </label>
                <p className="options__muted">
                    The overlay renders only on Twitch pages. Disable it if you prefer to use the extension without UI overlays.
                </p>
            </section>

            <section className="options__card">
                <h2>OAuth & zkLogin</h2>
                <div className="options__field">
                    <label htmlFor="clientId">Twitch Client ID</label>
                   <input
                        id="clientId"
                        type="text"
                        placeholder="your_client_id"
                        value={config.twitchClientId}
                        onChange={event => {
                            setStatus(initialStatus);
                            setConfig(prev => ({ ...prev, twitchClientId: event.target.value }));
                        }}
                    />
                </div>
                <div className="options__field">
                    <label htmlFor="saltUrl">Salt Service URL</label>
                    <input
                        id="saltUrl"
                        type="text"
                        value={config.saltServiceUrl}
                        onChange={event => {
                            setStatus(initialStatus);
                            setConfig(prev => ({ ...prev, saltServiceUrl: event.target.value }));
                        }}
                    />
                    <span className="options__muted">Use "/dummy-salt-service.json" for local testing.</span>
                </div>
                <div className="options__field">
                    <label htmlFor="proverUrl">zk Prover URL</label>
                    <input
                        id="proverUrl"
                        type="text"
                        value={config.zkProverUrl}
                        onChange={event => {
                            setStatus(initialStatus);
                            setConfig(prev => ({ ...prev, zkProverUrl: event.target.value }));
                        }}
                    />
                    <span className="options__muted">Default: https://prover-dev.mystenlabs.com/v1 (Testnet only).</span>
                </div>
                <div className="options__field">
                    <label htmlFor="proverToken">zk Prover API token</label>
                    <input
                        id="proverToken"
                        type="password"
                        value={config.zkProverAuthToken}
                        onChange={event => {
                            setStatus(initialStatus);
                            setConfig(prev => ({ ...prev, zkProverAuthToken: event.target.value }));
                        }}
                    />
                    <span className="options__muted">Used for Authorization when requesting zk proofs from Enoki.</span>
                </div>
                <div className="options__field">
                    <label htmlFor="backendRegistrationUrl">Backend Registration URL</label>
                    <input
                        id="backendRegistrationUrl"
                        type="text"
                        placeholder="https://api.example.com/onboard"
                        value={config.backendRegistrationUrl}
                        onChange={event => {
                            setStatus(initialStatus);
                            setConfig(prev => ({ ...prev, backendRegistrationUrl: event.target.value }));
                        }}
                    />
                    <span className="options__muted">로그인 후 지갑-사용자 매핑을 전송할 API endpoint.</span>
                </div>
                <button className="options__button" onClick={() => { void handleSave(); }} disabled={saving}>
                    {saving ? 'Saving…' : 'Save configuration'}
                </button>
                <div className="options__hint">
                    <strong>Redirect URI:</strong> {redirectUriHint}<br />
                    Register this URI in the Twitch developer console for OpenID Connect.
                </div>
            </section>

            <section className="options__card">
                <h2>Session maintenance</h2>
                <p className="options__muted">
                    Clearing sessions removes cached zkLogin proofs and ephemeral keys. Users must reconnect after clearing.
                </p>
                <button className="options__button options__button--danger" onClick={() => { void handleClearSessions(); }}>
                    Clear cached zkLogin sessions
                </button>
            </section>

            {status.message && (
                <div className={`options__status options__status--${status.tone}`}>
                    {status.message}
                </div>
            )}
        </main>
    );
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
