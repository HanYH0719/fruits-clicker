import { Environment, SafeArea, Screen, User, graniteEvent } from '@apps-in-toss/web-framework';

export async function initTossPlatform() {
    let environment;
    try {
        environment = Environment.environment;
    } catch {
        return null;
    }
    if (environment !== 'toss' && environment !== 'sandbox') return null;

    function applySafeArea(insets) {
        for (const side of ['top', 'right', 'bottom', 'left']) {
            if (Number.isFinite(insets?.[side])) {
                document.documentElement.style.setProperty('--toss-safe-' + side, insets[side] + 'px');
            }
        }
    }
    applySafeArea(SafeArea.get());
    SafeArea.subscribe({ onEvent: applySafeArea });

    let timeout;
    let key;
    try {
        const result = await Promise.race([
            User.getAnonymousKey(),
            new Promise(resolve => { timeout = setTimeout(resolve, 2500); }),
        ]);
        if (result?.type === 'HASH' && result.hash) key = result.hash;
    } catch {
        // A failed bridge call does not prevent the game from opening.
    } finally {
        clearTimeout(timeout);
    }

    return {
        saveKey: key ? 'fc_v16:' + key : null,
        onBack(onEvent) {
            graniteEvent.addEventListener('backEvent', { onEvent });
        },
        close: Screen.close,
    };
}
