import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    WEBAGENT_DOMAIN,
    cancelSession,
} from './utils.js';

export const cancelCommand = cli({
    site: 'webagent',
    name: 'cancel',
    access: 'write',
    description: 'Cancel a running WebAgent session',
    domain: WEBAGENT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'WebAgent session ID or https://agent.famou.com/chat/<id> URL' },
    ],
    columns: ['status', 'session_id'],
    func: async (page, kwargs) => {
        const id = await cancelSession(page, kwargs.id);
        return [{ status: 'cancelled', session_id: id }];
    },
});
