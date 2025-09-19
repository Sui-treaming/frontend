import { sendMessage } from './api/runtime';
import { initWidgetScale } from './responsive';
import type { ExtensionState } from '../shared/types';

export type WidgetState = {
    hasAccount: boolean;
    primaryAddress?: string;
    mintedCount: number;
    lastClaim?: string;
    channelPoints?: number;
};

const WIDGET_ID = 'zklogin-channel-points-widget';
const STORAGE_KEY = 'zklogin-channel-widget-state';

const CHANNEL_POINTS_SELECTORS = [
    '[data-test-selector="community-points-summary"]',
    '[data-a-target="community-points-summary"]',
    '.community-points-summary',
];

const CHANNEL_POINTS_BALANCE_SELECTORS = [
    '[data-test-selector="community-points-summary__balance"]',
    '[data-a-target="community-points-summary__balance"]',
    '[data-test-selector="balance-value"]',
    '.community-points-summary__balance',
];

let mintAnimationTimer: number | null = null;
let pendingButtonMint = false;

let observedContainer: HTMLElement | null = null;
let observer: MutationObserver | null = null;
let claimButtonObserver: MutationObserver | null = null;
let balanceObserver: MutationObserver | null = null;

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
            channelPoints: typeof parsed.channelPoints === 'number' ? parsed.channelPoints : undefined,
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
        channelPoints: state.channelPoints,
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

function updateChannelPoints(newBalance: number, options?: { silent?: boolean }): void {
    const previous = state.channelPoints ?? null;
    if (previous === newBalance) {
        return;
    }

    state.channelPoints = newBalance;
    persistState();

    if (options?.silent) {
        emitState();
        return;
    }

    if (pendingButtonMint) {
        pendingButtonMint = false;
        if (observedContainer) {
            renderWidget(observedContainer);
        }
        emitState();
        return;
    }

    if (previous !== null && newBalance > previous) {
        markMinted();
        return;
    } else {
        if (observedContainer) {
            renderWidget(observedContainer);
        }
        emitState();
    }
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

    const balance = readChannelPointsBalance(container);
    if (balance !== null) {
        updateChannelPoints(balance, { silent: true });
    }

    const mintedLabel = state.mintedCount === 1 ? 'mint' : 'mints';
    const walletLabel = state.hasAccount && state.primaryAddress
        ? `${state.primaryAddress.slice(0, 4)}…${state.primaryAddress.slice(-4)}`
        : 'Twitch connect needed';
    const statusLabel = state.hasAccount
        ? `${state.mintedCount} ${mintedLabel}`
        : 'Connect to enable minting';
    const lastClaim = state.lastClaim ? new Date(state.lastClaim).toLocaleTimeString() : 'Waiting for rewards';
    const pointsLabel = typeof state.channelPoints === 'number'
        ? state.channelPoints.toLocaleString()
        : '—';

    element.innerHTML = `
        <div class="zklogin-channel-widget__surface">
            <div class="zklogin-channel-widget__balance" aria-label="Channel points balance">
                <span class="zklogin-channel-widget__balance-icon" aria-hidden="true"></span>
                <span class="zklogin-channel-widget__balance-value">${pointsLabel}</span>
            </div>
            <div class="zklogin-channel-widget__status" aria-live="polite">
                <span class="zklogin-channel-widget__status-label">${statusLabel}</span>
                <span class="zklogin-channel-widget__status-sub">${lastClaim}</span>
                <span class="zklogin-channel-widget__status-wallet">${walletLabel}</span>
            </div>
        </div>
        <div class="zklogin-channel-widget__wave" aria-hidden="true"></div>
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
    triggerMintAnimation();
}

function triggerMintAnimation(): void {
    const widget = observedContainer?.querySelector(`#${WIDGET_ID}`);
    if (!widget) {
        return;
    }
    widget.classList.add('zklogin-channel-widget--minting');
    if (mintAnimationTimer !== null) {
        window.clearTimeout(mintAnimationTimer);
    }
    mintAnimationTimer = window.setTimeout(() => {
        widget.classList.remove('zklogin-channel-widget--minting');
        mintAnimationTimer = null;
    }, 1600);
}

function readChannelPointsBalance(container: HTMLElement): number | null {
    for (const selector of CHANNEL_POINTS_BALANCE_SELECTORS) {
        const target = container.querySelector(selector);
        if (target?.textContent) {
            const digits = target.textContent.replace(/[^\d]/g, '');
            if (digits) {
                const parsed = Number.parseInt(digits, 10);
                if (!Number.isNaN(parsed)) {
                    return parsed;
                }
            }
        }
    }

    const labelled = container.getAttribute('aria-label');
    if (labelled) {
        const digits = labelled.replace(/[^\d]/g, '');
        if (digits) {
            const parsed = Number.parseInt(digits, 10);
            if (!Number.isNaN(parsed)) {
                return parsed;
            }
        }
    }

    return null;
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
                    pendingButtonMint = true;
                    markMinted();
                    window.setTimeout(() => {
                        pendingButtonMint = false;
                    }, 5000);
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

function observeChannelPoints(container: HTMLElement): void {
    if (balanceObserver) {
        balanceObserver.disconnect();
    }

    const initial = readChannelPointsBalance(container);
    if (initial !== null) {
        updateChannelPoints(initial, { silent: true });
    }

    balanceObserver = new MutationObserver(() => {
        const latest = readChannelPointsBalance(container);
        if (latest !== null) {
            updateChannelPoints(latest);
        }
    });

    balanceObserver.observe(container, {
        childList: true,
        subtree: true,
        characterData: true,
    });
}

function installWidget(): void {
    const container = findChannelPointsContainer();
    if (!container) {
        return;
    }

    observedContainer = container;
    renderWidget(container);
    attachClaimListener(container);
    observeChannelPoints(container);
}

function bootstrapObserver(): void {
    if (observer) {
        return;
    }

    observer = new MutationObserver(() => {
        if (!observedContainer || !document.body.contains(observedContainer)) {
            if (balanceObserver) {
                balanceObserver.disconnect();
                balanceObserver = null;
            }
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

    initWidgetScale();

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
