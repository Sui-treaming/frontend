import type { AccountPublicData, AccountSession, ExtensionConfig } from './types';

export const CONFIG_KEY = 'zklogin/config';
export const OVERLAY_KEY = 'zklogin/overlay-enabled';
export const OVERLAY_POSITION_KEY = 'zklogin/overlay-position';
export const GLOBAL_WIDGET_POSITION_KEY = 'zklogin/global-widget-position';
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
    nftUploadUrl: 'https://zklogin.wiimdy.kr/api/walrus/upload',
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
    const merged: ExtensionConfig = { ...defaults, ...(stored[CONFIG_KEY] ?? {}) };
    const sanitized = sanitizeConfig(merged);
    // If we changed anything (e.g., enforce /salts/ensure), persist back
    if (JSON.stringify(sanitized) !== JSON.stringify(merged)) {
        await saveConfig(sanitized);
        return sanitized;
    }
    return merged;
}

export async function saveConfig(config: ExtensionConfig): Promise<void> {
    const sanitized = sanitizeConfig(config);
    await chrome.storage.local.set({ [CONFIG_KEY]: sanitized });
}

export async function getOverlayEnabled(): Promise<boolean> {
    const stored = await chrome.storage.sync.get(OVERLAY_KEY) as { [OVERLAY_KEY]?: boolean };
    return stored[OVERLAY_KEY] ?? true;
}

export async function setOverlayEnabled(enabled: boolean): Promise<void> {
    await chrome.storage.sync.set({ [OVERLAY_KEY]: enabled });
}

export type OverlayPosition = {
    corner: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
    offsetX: number; // px
    offsetY: number; // px
};

const DEFAULT_POSITION: OverlayPosition = { corner: 'top-right', offsetX: 20, offsetY: 20 };

export async function getOverlayPosition(): Promise<OverlayPosition> {
    const stored = await chrome.storage.sync.get(OVERLAY_POSITION_KEY) as { [OVERLAY_POSITION_KEY]?: OverlayPosition };
    const value = stored[OVERLAY_POSITION_KEY];
    if (!value) return DEFAULT_POSITION;
    return {
        corner: value.corner ?? DEFAULT_POSITION.corner,
        offsetX: Number.isFinite(value.offsetX as number) ? (value.offsetX as number) : DEFAULT_POSITION.offsetX,
        offsetY: Number.isFinite(value.offsetY as number) ? (value.offsetY as number) : DEFAULT_POSITION.offsetY,
    };
}

export async function setOverlayPosition(pos: OverlayPosition): Promise<void> {
    await chrome.storage.sync.set({ [OVERLAY_POSITION_KEY]: pos });
}

export async function getGlobalWidgetPosition(): Promise<OverlayPosition> {
    const stored = await chrome.storage.sync.get(GLOBAL_WIDGET_POSITION_KEY) as { [GLOBAL_WIDGET_POSITION_KEY]?: OverlayPosition };
    return stored[GLOBAL_WIDGET_POSITION_KEY] ?? { corner: 'top-right', offsetX: 16, offsetY: 16 };
}

export async function setGlobalWidgetPosition(pos: OverlayPosition): Promise<void> {
    await chrome.storage.sync.set({ [GLOBAL_WIDGET_POSITION_KEY]: pos });
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

function sanitizeConfig(config: ExtensionConfig): ExtensionConfig {
    const out = { ...config };
    // Enforce secure salt flow: always target /salts/ensure
    if (/\/salts(?!\/ensure)\/?$/i.test(out.saltServiceUrl)) {
        out.saltServiceUrl = out.saltServiceUrl.replace(/\/$/, '') + '/ensure';
    }
    return out;
}
