import { sendMessage } from './api/runtime';
import type { ExtensionState } from '../shared/types';

export type WidgetState = {
    hasAccount: boolean;
    primaryAddress?: string;
    mintedCount: number;
    lastClaim?: string;
};

const WIDGET_ID = 'zklogin-channel-points-widget';
const STORAGE_KEY = 'zklogin-channel-widget-state';

const CHANNEL_POINTS_SELECTORS = [
    '[data-test-selector="community-points-summary"]',
    '[data-a-target="community-points-summary"]',
    '.community-points-summary',
];

let observedContainer: HTMLElement | null = null;
let observer: MutationObserver | null = null;
let claimButtonObserver: MutationObserver | null = null;

let state: WidgetState = restoreState();
const listeners = new Set<(state: WidgetState) => void>();

function restoreState(): WidgetState {
    try {
        const raw = window.sessionStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return { hasAccount: false, mintedCount: 0 };
        }
        const parsed = JSON.parse(raw) as WidgetState;
        return {
            hasAccount: Boolean(parsed.hasAccount),
            primaryAddress: parsed.primaryAddress,
            mintedCount: Number(parsed.mintedCount ?? 0),
            lastClaim: parsed.lastClaim,
        };
    } catch (error) {
        console.warn('[content] Failed to restore widget state', error);
        return { hasAccount: false, mintedCount: 0 };
    }
}

function persistState(): void {
    try {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
        console.warn('[content] Failed to persist widget state', error);
    }
}

function cloneState(): WidgetState {
    return {
        hasAccount: state.hasAccount,
        primaryAddress: state.primaryAddress,
        mintedCount: state.mintedCount,
        lastClaim: state.lastClaim,
    };
}

function emitState(): void {
    const snapshot = cloneState();
    listeners.forEach(listener => {
        try {
            listener(snapshot);
        } catch (error) {
            console.warn('[content] Widget state listener failed', error);
        }
    });
}

export function getWidgetState(): WidgetState {
    return cloneState();
}

export function subscribeToWidgetState(listener: (state: WidgetState) => void): () => void {
    listeners.add(listener);
    try {
        listener(cloneState());
    } catch (error) {
        console.warn('[content] Widget state subscriber initial callback failed', error);
    }
    return () => {
        listeners.delete(listener);
    };
}

function findChannelPointsContainer(): HTMLElement | null {
    for (const selector of CHANNEL_POINTS_SELECTORS) {
        const found = document.querySelector(selector) as HTMLElement | null;
        if (found) {
            return found;
        }
    }
    return null;
}

function ensureWidget(container: HTMLElement): HTMLElement {
    let widget = container.querySelector(`#${WIDGET_ID}`) as HTMLElement | null;
    if (widget) {
        return widget;
    }

    widget = document.createElement('div');
    widget.id = WIDGET_ID;
    widget.className = 'zklogin-channel-widget';
    container.appendChild(widget);
    return widget;
}

function renderWidget(container: HTMLElement): void {
    const element = ensureWidget(container);

    const mintedLabel = state.mintedCount === 1 ? 'mint' : 'mints';
    const lastClaim = state.lastClaim ? new Date(state.lastClaim).toLocaleTimeString() : '—';
    const addressLabel = state.primaryAddress ? `${state.primaryAddress.slice(0, 6)}…${state.primaryAddress.slice(-4)}` : 'Not linked';

    element.innerHTML = `
        <div class="zklogin-channel-widget__header">Stream-to-Sui</div>
        <div class="zklogin-channel-widget__body">
            <div class="zklogin-channel-widget__row">
                <span class="zklogin-channel-widget__label">Wallet</span>
                <strong class="zklogin-channel-widget__value">${state.hasAccount ? addressLabel : 'Connect Twitch'}</strong>
            </div>
            <div class="zklogin-channel-widget__row">
                <span class="zklogin-channel-widget__label">Mock NFT mints</span>
                <strong class="zklogin-channel-widget__value">${state.mintedCount} ${mintedLabel}</strong>
            </div>
            <div class="zklogin-channel-widget__row">
                <span class="zklogin-channel-widget__label">Last reward</span>
                <strong class="zklogin-channel-widget__value">${lastClaim}</strong>
            </div>
        </div>
        <div class="zklogin-channel-widget__footer">Channel points → Sui rewards (prototype)</div>
    `;
}

async function refreshAccountState(): Promise<void> {
    try {
        const response = await sendMessage({ type: 'GET_EXTENSION_STATE' });
        const extensionState: ExtensionState = response.data.state;
        const primaryAccount = extensionState.accounts[0];
        state.hasAccount = Boolean(primaryAccount);
        state.primaryAddress = primaryAccount?.address;
        persistState();
        if (observedContainer) {
            renderWidget(observedContainer);
        }
        emitState();
    } catch (error) {
        console.warn('[content] Failed to load extension state for widget', error);
    }
}

function markMinted(): void {
    state.mintedCount += 1;
    state.lastClaim = new Date().toISOString();
    persistState();
    if (observedContainer) {
        renderWidget(observedContainer);
    }
    emitState();
}

function attachClaimListener(container: HTMLElement): void {
    const claimButtonSelectors = [
        '[data-test-selector="community-points-summary__claim-button"]',
        '[data-a-target="community-points-summary__claim-button"]',
        'button.community-points-summary__claim-button',
    ];

    const attach = () => {
        for (const selector of claimButtonSelectors) {
            const button = container.querySelector(selector) as HTMLButtonElement | null;
            if (button && button.dataset.zkloginHooked !== 'true') {
                button.dataset.zkloginHooked = 'true';
                button.addEventListener('click', () => {
                    console.info('[content] Detected channel point claim (mock)');
                    markMinted();
                });
                return;
            }
        }
    };

    attach();

    if (claimButtonObserver) {
        claimButtonObserver.disconnect();
    }

    claimButtonObserver = new MutationObserver(attach);
    claimButtonObserver.observe(container, { childList: true, subtree: true });
}

function installWidget(): void {
    const container = findChannelPointsContainer();
    if (!container) {
        return;
    }

    observedContainer = container;
    renderWidget(container);
    attachClaimListener(container);
}

function bootstrapObserver(): void {
    if (observer) {
        return;
    }

    observer = new MutationObserver(() => {
        if (!observedContainer || !document.body.contains(observedContainer)) {
            observedContainer = null;
        }
        if (!observedContainer) {
            installWidget();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
}

export function initChannelPointsWidget(): void {
    if (typeof window === 'undefined') {
        return;
    }

    const isTwitch = /(^|\.)twitch\.tv$/i.test(window.location.hostname);

    if (isTwitch) {
        installWidget();
        bootstrapObserver();
    }

    void refreshAccountState();

    // 주기적으로 상태를 갱신하여 주소 변화를 반영
    window.setInterval(() => {
        void refreshAccountState();
    }, 60_000);

    emitState();
}
