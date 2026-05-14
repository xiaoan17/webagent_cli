import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    WEBAGENT_DOMAIN,
    renameSession,
} from './utils.js';

export const renameCommand = cli({
    site: 'webagent',
    name: 'rename',
    access: 'write',
    description: 'Rename a WebAgent session',
    domain: WEBAGENT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'WebAgent session ID or https://agent.famou.com/chat/<id> URL' },
        { name: 'title', positional: true, required: true, help: 'New session title' },
    ],
    columns: ['status', 'session_id', 'title'],
    func: async (page, kwargs) => {
        const result = await renameSession(page, kwargs.id, kwargs.title);
        return [{ status: 'renamed', session_id: result.sessionId, title: result.title }];
    },
});
