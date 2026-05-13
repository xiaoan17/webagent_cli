import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    WEBAGENT_DOMAIN,
    checkLoginStatus,
    ensureOnWebAgent,
    getCurrentSessionId,
    getUserInfo,
} from './utils.js';

export const statusCommand = cli({
    site: 'webagent',
    name: 'status',
    access: 'read',
    description: 'Check WebAgent page availability, login state, and current session',
    domain: WEBAGENT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: ['status', 'login', 'user', 'session_id', 'url'],
    func: async (page) => {
        await ensureOnWebAgent(page);
        const [loggedIn, sessionId, url] = await Promise.all([
            checkLoginStatus(page).catch(() => false),
            getCurrentSessionId(page),
            page.evaluate('window.location.href').catch(() => ''),
        ]);
        let user = null;
        if (loggedIn) {
            const info = await getUserInfo(page).catch(() => ({}));
            user = info.name || info.nickname || info.user_name || info.user_id || null;
        }
        return [{
            status: loggedIn ? 'connected' : 'login_required',
            login: loggedIn ? 'yes' : 'no',
            user,
            session_id: sessionId || null,
            url: typeof url === 'string' ? url : '',
        }];
    },
});
