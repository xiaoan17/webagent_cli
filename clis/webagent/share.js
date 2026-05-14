import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    WEBAGENT_DOMAIN,
    requirePositiveInt,
    shareSession,
} from './utils.js';

export const shareCommand = cli({
    site: 'webagent',
    name: 'share',
    access: 'write',
    description: 'Create a share link for a WebAgent session',
    domain: WEBAGENT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'WebAgent session ID or https://agent.famou.com/chat/<id> URL' },
        { name: 'title', valueRequired: true, help: 'Optional share title' },
        { name: 'expire-days', type: 'int', default: 7, help: 'Share link validity in days (default: 7)' },
    ],
    columns: ['session_id', 'title', 'expire_days', 'share_url'],
    func: async (page, kwargs) => {
        const expireDays = requirePositiveInt(
            Number(kwargs['expire-days'] ?? 7),
            'webagent share --expire-days',
            'Example: opencli webagent share <id> --expire-days 7',
        );
        const result = await shareSession(page, kwargs.id, {
            title: kwargs.title,
            expireDays,
        });
        return [{
            session_id: result.sessionId,
            title: result.title || null,
            expire_days: result.expireDays,
            share_url: result.shareUrl,
        }];
    },
});
