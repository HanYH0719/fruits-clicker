import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
    appName: process.env.TOSS_APP_NAME || 'fruit-clicker',
    webBundleDir: 'dist',
    permissions: [],
    navigationBar: {
        transparentBackground: true,
        withBackButton: false,
        withHomeButton: false,
        withTitle: false,
    },
    webView: {
        bounces: false,
        overScrollMode: 'never',
        pullToRefreshEnabled: false,
    },
});
