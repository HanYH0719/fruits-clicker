import { Environment, SafeArea, Screen, User, graniteEvent, loadFullScreenAd, showFullScreenAd } from '@apps-in-toss/web-framework';

function waitForAdEvent(subscribe, adGroupId, handleEvent, timeout) {
    let unsubscribe;
    let done = false;
    return new Promise(resolve => {
        const finish = result => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve(result);
        };
        const timer = setTimeout(() => finish('unavailable'), timeout);
        try {
            unsubscribe = subscribe({
                options: { adGroupId },
                onEvent: event => { if (!done) handleEvent(event, finish); },
                onError: () => finish('unavailable'),
            });
        } catch {
            finish('unavailable');
        }
    }).finally(() => unsubscribe?.());
}

async function watchRewardedAd(adGroupId) {
    const loaded = await waitForAdEvent(loadFullScreenAd, adGroupId, (event, finish) => {
        if (event.type === 'loaded') finish('loaded');
    }, 12000);
    if (loaded !== 'loaded') return loaded;

    let earned = false;
    const result = await waitForAdEvent(showFullScreenAd, adGroupId, (event, finish) => {
        if (event.type === 'userEarnedReward') earned = true;
        if (event.type === 'dismissed') finish('dismissed');
        if (event.type === 'failedToShow') finish('unavailable');
    }, 180000);
    return earned ? 'earned' : result;
}

export async function initTossPlatform(rewardedAdIds) {
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

    let rewardedAds;
    if (loadFullScreenAd.isSupported() && showFullScreenAd.isSupported()) {
        rewardedAds = {
            watch: placement => watchRewardedAd(rewardedAdIds[placement]),
        };
    }
    return {
        rewardedAds,
        saveKey: key ? 'fc_v16:' + key : null,
        onBack(onEvent) {
            graniteEvent.addEventListener('backEvent', { onEvent });
        },
        close: Screen.close,
    };
}
