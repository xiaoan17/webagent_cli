import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    WEBAGENT_DOMAIN,
    deleteSession,
} from './utils.js';

export const deleteCommand = cli({
    site: 'webagent',
    name: 'delete',
    access: 'write',
    description: 'Delete a WebAgent session',
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
        const id = await deleteSession(page, kwargs.id);
        return [{ status: 'deleted', session_id: id }];
    },
});
