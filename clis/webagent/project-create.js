import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    WEBAGENT_DOMAIN,
    createProject,
} from './utils.js';

export const projectCreateCommand = cli({
    site: 'webagent',
    name: 'project-create',
    access: 'write',
    description: 'Create a WebAgent project',
    domain: WEBAGENT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'name', positional: true, required: true, help: 'Project name' },
    ],
    columns: ['status', 'name', 'id'],
    func: async (page, kwargs) => {
        const project = await createProject(page, kwargs.name);
        return [{ status: 'created', name: project.name, id: project.id }];
    },
});
