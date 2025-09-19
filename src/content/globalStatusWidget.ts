import { getWidgetState, subscribeToWidgetState, type WidgetState } from './channelPointsWidget';

const GLOBAL_WIDGET_ID = 'zklogin-global-status-widget';
const BLOCKED_PROTOCOLS = new Set(['about:', 'chrome:', 'chrome-extension:']);
const BLOCKED_HOSTS = new Set(['id.twitch.tv']);
const BLOCKED_HOST_SUFFIXES = ['chromiumapp.org'];

let initialized = false;
let container: HTMLDivElement | null = null;
let unsubscribe: (() => void) | null = null;

function isBlockedEnvironment(): boolean {
    if (typeof window === 'undefined') {
        return true;
    }

    const { protocol, hostname, href } = window.location;

    if (href === 'about:blank') {
        return true;
    }

    if (BLOCKED_PROTOCOLS.has(protocol)) {
        return true;
    }

    if (BLOCKED_HOSTS.has(hostname)) {
        return true;
    }

    if (BLOCKED_HOST_SUFFIXES.some(suffix => hostname.endsWith(suffix))) {
        return true;
    }

    return false;
}

function ensureContainer(): HTMLDivElement {
    if (container) {
        return container;
    }
    const element = document.createElement('div');
    element.id = GLOBAL_WIDGET_ID;
    element.className = 'zklogin-global-widget';
    element.innerHTML = '<div class="zklogin-global-widget__title">Stream-to-Sui (loading…)</div>';
    document.body.appendChild(element);
    container = element;
    return element;
}

function formatAddress(address?: string): string {
    if (!address) {
        return 'Not linked';
    }
    return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatMintSummary(state: WidgetState): string {
    const label = state.mintedCount === 1 ? 'mint' : 'mints';
    return `${state.mintedCount} ${label}`;
}

function formatTimestamp(value?: string): string {
    if (!value) {
        return '—';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '—';
    }
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function render(state: WidgetState): void {
    const host = ensureContainer();
    const walletSummary = state.hasAccount ? formatAddress(state.primaryAddress) : 'Connect Twitch';

    host.innerHTML = `
        <div class="zklogin-global-widget__title">Stream-to-Sui (mock)</div>
        <div class="zklogin-global-widget__row">
            <span class="zklogin-global-widget__label">Wallet</span>
            <strong class="zklogin-global-widget__value">${walletSummary}</strong>
        </div>
        <div class="zklogin-global-widget__row">
            <span class="zklogin-global-widget__label">Mock NFT mints</span>
            <strong class="zklogin-global-widget__value">${formatMintSummary(state)}</strong>
        </div>
        <div class="zklogin-global-widget__row">
            <span class="zklogin-global-widget__label">Last reward</span>
            <strong class="zklogin-global-widget__value">${formatTimestamp(state.lastClaim)}</strong>
        </div>
    `;
}

export function initGlobalStatusWidget(): void {
    if (typeof window === 'undefined' || initialized || isBlockedEnvironment()) {
        return;
    }
    initialized = true;

    render(getWidgetState());

    unsubscribe = subscribeToWidgetState(render);

    window.addEventListener('beforeunload', () => {
        unsubscribe?.();
        unsubscribe = null;
    });
}
