import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    WEBAGENT_DOMAIN,
    getProject,
} from './utils.js';

export const projectDetailCommand = cli({
    site: 'webagent',
    name: 'project-detail',
    access: 'read',
    description: 'Read WebAgent project details',
    domain: WEBAGENT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'WebAgent project ID' },
    ],
    columns: ['name', 'id', 'file_count', 'skill_count', 'task_count', 'task_ids', 'files'],
    func: async (page, kwargs) => [await getProject(page, kwargs.id)],
});
