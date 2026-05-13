import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    WEBAGENT_DOMAIN,
    authRequired,
    checkLoginStatus,
    listProjects,
    requirePositiveInt,
} from './utils.js';

export const projectsCommand = cli({
    site: 'webagent',
    name: 'projects',
    access: 'read',
    description: 'List WebAgent projects',
    domain: WEBAGENT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'limit', type: 'int', default: 100, help: 'Max projects to list (default: 100)' },
        { name: 'page', type: 'int', default: 1, help: 'Project page number (default: 1)' },
    ],
    columns: ['index', 'name', 'id', 'file_count', 'skill_count', 'task_count', 'created_at', 'file_limit', 'size_limit'],
    func: async (page, kwargs) => {
        const limit = requirePositiveInt(
            Number(kwargs.limit ?? 100),
            'webagent projects --limit',
            'Example: opencli webagent projects --limit 100',
        );
        const pageNo = requirePositiveInt(
            Number(kwargs.page ?? 1),
            'webagent projects --page',
            'Example: opencli webagent projects --page 1',
        );
        if (!(await checkLoginStatus(page))) {
            throw authRequired('WebAgent projects requires a signed-in browser session.');
        }
        const projects = await listProjects(page, { pageNo, pageSize: limit });
        return projects.map((project, i) => ({
            index: (pageNo - 1) * limit + i + 1,
            ...project,
        }));
    },
});
