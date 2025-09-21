/**
 * Lightweight animation helpers using the Web Animations API (no deps).
 */

function animateTo(el: HTMLElement, keyframes: Keyframe[] | PropertyIndexedKeyframes, options: KeyframeAnimationOptions): void {
    const player = el.animate(keyframes as Keyframe[], { ...options, fill: 'forwards' });
    // Ensure final styles stick even if WAAPI isn't fully supported
    player.addEventListener?.('finish', () => {
        const last = Array.isArray(keyframes) ? (keyframes[keyframes.length - 1] as Record<string, any>) : keyframes as Record<string, any>;
        if (last.opacity !== undefined) {
            el.style.opacity = String(last.opacity);
        }
        if ((last as any).transform !== undefined) {
            el.style.transform = String((last as any).transform);
        }
    });
}

function transform(scale = 1, yPx = 0): string {
    return `scale(${scale}) translateY(${Math.round(yPx)}px)`;
}

/**
 * Initialize subtle press/release animations for buttons inside the given root.
 */
export function initButtonAnimations(root?: Document | HTMLElement): void {
    const scope: Document | HTMLElement = root ?? document;

    const findTarget = (start: EventTarget | null): HTMLElement | null => {
        if (!(start instanceof Element)) return null;
        return start.closest(
            '.zklogin-btn, .zklogin-icon-button, .popup__button, .options__button, .zklogin-cover-upload__field',
        ) as HTMLElement | null;
    };

    const handleDown = (ev: Event) => {
        const target = findTarget(ev.target);
        if (!target) return;
        if ((target as any).__pressAnimating) return;
        (target as any).__pressAnimating = true;
        animateTo(target, [
            { transform: getComputedStyle(target).transform || 'none' },
            { transform: transform(0.97, 1) },
        ], { duration: 120, easing: 'ease-out' });
    };
    const handleUp = (ev: Event) => {
        const target = findTarget(ev.target);
        if (!target) return;
        (target as any).__pressAnimating = false;
        animateTo(target, [
            { transform: getComputedStyle(target).transform || transform(0.97, 1) },
            { transform: transform(1, 0) },
        ], { duration: 180, easing: 'ease-out' });
    };

    // Pointer events for modern browsers
    scope.addEventListener('pointerdown', handleDown);
    scope.addEventListener('pointerup', handleUp);
    scope.addEventListener('pointercancel', handleUp);
    scope.addEventListener('pointerleave', handleUp);
}

/**
 * Animate overlay collapse/expand transitions.
 */
export function animateOverlayCollapsed(el: HTMLElement | null, collapsed: boolean): void {
    if (!el) return;
    const from = {
        transform: getComputedStyle(el).transform || 'none',
        opacity: parseFloat(getComputedStyle(el).opacity) || 1,
    };
    const to = collapsed
        ? { transform: transform(0.96, 0), opacity: 0.92 }
        : { transform: transform(1, 0), opacity: 1 };
    animateTo(el, [from as any, to as any], { duration: 220, easing: 'ease-out' });
}

/**
 * Create an indicator bar under the active tab in a nav container.
 */
function ensureTabsIndicator(navEl: HTMLElement): HTMLDivElement {
    let indicator = navEl.querySelector(':scope > .zklogin-tabs__indicator') as HTMLDivElement | null;
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.className = 'zklogin-tabs__indicator';
        navEl.appendChild(indicator);
    }
    return indicator;
}

function rectWithin(parent: HTMLElement, child: HTMLElement) {
    const p = parent.getBoundingClientRect();
    const c = child.getBoundingClientRect();
    const left = c.left - p.left + parent.scrollLeft;
    const width = c.width;
    return { left, width };
}

/**
 * Move the tabs indicator to align with the target tab button.
 */
export function moveTabsIndicator(navEl: HTMLElement | null, targetBtn: HTMLElement | null): void {
    if (!navEl || !targetBtn) return;
    const indicator = ensureTabsIndicator(navEl);
    const { left, width } = rectWithin(navEl, targetBtn);
    animateTo(indicator, [
        { transform: getComputedStyle(indicator).transform || `translateX(${Math.round(left)}px)`, width: `${indicator.offsetWidth || width}px` },
        { transform: `translateX(${Math.round(left)}px)`, width: `${Math.round(width)}px` },
    ], { duration: 220, easing: 'ease-out' });
}

/**
 * Animate tab content entering; direction can hint slide-in from left/right.
 */
export function animateTabEnter(el: HTMLElement | null, direction: 'left' | 'right' | 'none' = 'none'): void {
    if (!el) return;
    const dx = direction === 'left' ? -10 : direction === 'right' ? 10 : 0;
    const from: Keyframe = { opacity: 0, transform: `translate(${dx}px, 0) scale(0.995)` } as any;
    const to: Keyframe = { opacity: 1, transform: 'translate(0, 0) scale(1)' } as any;
    animateTo(el, [from, to], { duration: 220, easing: 'ease-out' });
}

export function animateHeightMorph(el: HTMLElement | null, fromPx: number | undefined, toPx: number | undefined): void {
    if (!el) return;
    if (typeof fromPx !== 'number' || typeof toPx !== 'number' || !Number.isFinite(fromPx) || !Number.isFinite(toPx)) return;
    if (fromPx === toPx) return;
    const originalOverflow = el.style.overflow;
    const originalHeight = el.style.height;
    el.style.overflow = 'hidden';
    el.style.height = `${Math.max(0, Math.round(fromPx))}px`;
    const player = el.animate([
        { height: `${Math.max(0, Math.round(fromPx))}px` },
        { height: `${Math.max(0, Math.round(toPx))}px` },
    ], { duration: 220, easing: 'ease-out', fill: 'forwards' });
    player.addEventListener?.('finish', () => {
        el.style.height = originalHeight;
        el.style.overflow = originalOverflow;
    });
}
