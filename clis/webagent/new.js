import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    WEBAGENT_DOMAIN,
    WEBAGENT_URL,
} from './utils.js';

export const newCommand = cli({
    site: 'webagent',
    name: 'new',
    access: 'write',
    description: 'Open the WebAgent workspace for a new task',
    domain: WEBAGENT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: ['status', 'url'],
    func: async (page) => {
        await page.goto(WEBAGENT_URL, { waitUntil: 'load', settleMs: 2000 });
        return [{ status: 'ready', url: WEBAGENT_URL }];
    },
});
