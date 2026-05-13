import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    WEBAGENT_DOMAIN,
    authRequired,
    checkLoginStatus,
    listSessions,
    requirePositiveInt,
} from './utils.js';

export const historyCommand = cli({
    site: 'webagent',
    name: 'history',
    access: 'read',
    description: 'List recent WebAgent sessions',
    domain: WEBAGENT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Max sessions to list (default: 20)' },
        { name: 'page', type: 'int', default: 1, help: 'History page number (default: 1)' },
    ],
    columns: ['index', 'title', 'id', 'status', 'updated_at', 'url'],
    func: async (page, kwargs) => {
        const limit = requirePositiveInt(
            Number(kwargs.limit ?? 20),
            'webagent history --limit',
            'Example: opencli webagent history --limit 20',
        );
        const pageNo = requirePositiveInt(
            Number(kwargs.page ?? 1),
            'webagent history --page',
            'Example: opencli webagent history --page 1',
        );
        if (!(await checkLoginStatus(page))) {
            throw authRequired('WebAgent history requires a signed-in browser session.');
        }
        const sessions = await listSessions(page, { limit, pageNo });
        if (!sessions.length) {
            throw new EmptyResultError('webagent history', 'No WebAgent sessions found for the signed-in account.');
        }
        return sessions.map((session, i) => ({
            index: (pageNo - 1) * limit + i + 1,
            title: session.title || '(untitled)',
            id: session.id,
            status: session.status || null,
            updated_at: session.updatedAt || session.createdAt || null,
            url: session.url,
        }));
    },
});
