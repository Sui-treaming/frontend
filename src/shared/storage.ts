import type { AccountPublicData, AccountSession, ExtensionConfig } from './types';

export const CONFIG_KEY = 'zklogin/config';
export const OVERLAY_KEY = 'zklogin/overlay-enabled';
export const SESSION_KEY = 'zklogin/sessions';
export const WIDGET_OPACITY_KEY = 'zklogin/widget-opacity';

const DEFAULT_WIDGET_OPACITY = 0.92;
const MIN_WIDGET_OPACITY = 0.4;
const MAX_WIDGET_OPACITY = 1;

const BASE_DEFAULT_CONFIG: ExtensionConfig = {
    twitchClientId: '',
    saltServiceUrl: '/dummy-salt-service.json',
    zkProverUrl: 'https://prover-dev.mystenlabs.com/v1',
    zkProverAuthToken: '',
    backendRegistrationUrl: '',
};

let cachedDefaults: ExtensionConfig | null = null;

async function resolveDefaults(): Promise<ExtensionConfig> {
    if (cachedDefaults) {
        return cachedDefaults;
    }
    try {
        const response = await fetch(chrome.runtime.getURL('config.json'));
        if (!response.ok) {
            throw new Error(`Failed to load config.json (status ${response.status})`);
        }
        const data = await response.json() as Partial<ExtensionConfig> | undefined;
        cachedDefaults = { ...BASE_DEFAULT_CONFIG, ...(data ?? {}) };
    } catch (error) {
        console.warn('[storage] Falling back to built-in defaults:', error);
        cachedDefaults = { ...BASE_DEFAULT_CONFIG };
    }
    return cachedDefaults;
}

export async function loadConfig(): Promise<ExtensionConfig> {
    const [defaults, stored] = await Promise.all([
        resolveDefaults(),
        chrome.storage.local.get(CONFIG_KEY) as Promise<{ [CONFIG_KEY]?: ExtensionConfig }>,
    ]);
    return { ...defaults, ...(stored[CONFIG_KEY] ?? {}) };
}

export async function saveConfig(config: ExtensionConfig): Promise<void> {
    await chrome.storage.local.set({ [CONFIG_KEY]: config });
}

export async function getOverlayEnabled(): Promise<boolean> {
    const stored = await chrome.storage.sync.get(OVERLAY_KEY) as { [OVERLAY_KEY]?: boolean };
    return stored[OVERLAY_KEY] ?? true;
}

export async function setOverlayEnabled(enabled: boolean): Promise<void> {
    await chrome.storage.sync.set({ [OVERLAY_KEY]: enabled });
}

export async function getWidgetOpacity(): Promise<number> {
    const stored = await chrome.storage.sync.get(WIDGET_OPACITY_KEY) as { [WIDGET_OPACITY_KEY]?: number };
    const value = stored[WIDGET_OPACITY_KEY];
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.min(MAX_WIDGET_OPACITY, Math.max(MIN_WIDGET_OPACITY, value));
    }
    return DEFAULT_WIDGET_OPACITY;
}

export async function setWidgetOpacity(opacity: number): Promise<void> {
    const clamped = Math.min(MAX_WIDGET_OPACITY, Math.max(MIN_WIDGET_OPACITY, opacity));
    await chrome.storage.sync.set({ [WIDGET_OPACITY_KEY]: clamped });
}

export async function getAccountSessions(): Promise<AccountSession[]> {
    const stored = await chrome.storage.session.get(SESSION_KEY) as { [SESSION_KEY]?: AccountSession[] };
    return stored[SESSION_KEY] ?? [];
}

export async function setAccountSessions(sessions: AccountSession[]): Promise<void> {
    await chrome.storage.session.set({ [SESSION_KEY]: sessions });
}

export function sessionsToPublicData(sessions: AccountSession[]): AccountPublicData[] {
    return sessions.map(({ address, provider, sub, aud, createdAt, maxEpoch }) => ({
        address,
        provider,
        sub,
        aud,
        createdAt,
        maxEpoch,
    }));
}

export const DEFAULT_CONFIG: ExtensionConfig = { ...BASE_DEFAULT_CONFIG };
