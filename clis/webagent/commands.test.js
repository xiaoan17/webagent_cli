import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './ask.js';
import './send.js';
import './read.js';
import './history.js';
import './detail.js';
import './new.js';
import './status.js';
import './cancel.js';
import './projects.js';
import './clarify.js';
import './receipt.js';
import './evolve.js';
import './rename.js';
import './delete.js';
import './share.js';
import './move.js';
import './project-create.js';
import './project-detail.js';
import './project-rename.js';
import './project-delete.js';
import './project-remove-session.js';

describe('webagent command registration', () => {
    it('registers WebAgent browser commands with persistent cookie sessions', () => {
        const expectedAccess = {
            ask: 'write',
            send: 'write',
            read: 'read',
            history: 'read',
            detail: 'read',
            new: 'write',
            status: 'read',
            cancel: 'write',
            projects: 'read',
            clarify: 'write',
            receipt: 'read',
            evolve: 'write',
            rename: 'write',
            delete: 'write',
            share: 'write',
            move: 'write',
            'project-create': 'write',
            'project-detail': 'read',
            'project-rename': 'write',
            'project-delete': 'write',
            'project-remove-session': 'write',
        };

        for (const [name, access] of Object.entries(expectedAccess)) {
            const cmd = getRegistry().get(`webagent/${name}`);
            expect(cmd, `webagent/${name}`).toBeDefined();
            expect(cmd.site).toBe('webagent');
            expect(cmd.domain).toBe('agent.famou.com');
            expect(cmd.strategy).toBe('cookie');
            expect(cmd.browser).toBe(true);
            expect(cmd.siteSession).toBe('persistent');
            expect(cmd.navigateBefore).toBe(false);
            expect(cmd.access).toBe(access);
        }
    });

    it('keeps runtime-visible arguments for ask', () => {
        const ask = getRegistry().get('webagent/ask');
        expect(ask.args).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'prompt', positional: true, required: true }),
            expect.objectContaining({ name: 'timeout', type: 'int', default: 120 }),
            expect.objectContaining({ name: 'id' }),
            expect.objectContaining({ name: 'project-id' }),
            expect.objectContaining({ name: 'agent-type', default: 'opencode' }),
            expect.objectContaining({ name: 'file', valueRequired: true, multiple: true }),
            expect.objectContaining({ name: 'data', valueRequired: true, multiple: true }),
            expect.objectContaining({ name: 'data-file', valueRequired: true, multiple: true }),
        ]));
        expect(ask.columns).toEqual(['response', 'session_id', 'url', 'files', 'receipt', 'artifacts', 'evolve', 'next_actions']);
    });

    it('keeps runtime-visible arguments for projects', () => {
        const projects = getRegistry().get('webagent/projects');
        expect(projects.args).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'limit', type: 'int', default: 100 }),
            expect.objectContaining({ name: 'page', type: 'int', default: 1 }),
        ]));
        expect(projects.columns).toEqual(['index', 'name', 'id', 'file_count', 'skill_count', 'task_count', 'created_at', 'file_limit', 'size_limit']);
    });

    it('keeps runtime-visible arguments for clarify', () => {
        const clarify = getRegistry().get('webagent/clarify');
        expect(clarify.args).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'id', positional: true, required: true }),
            expect.objectContaining({ name: 'answer', valueRequired: true, multiple: true }),
            expect.objectContaining({ name: 'note', valueRequired: true }),
            expect.objectContaining({ name: 'force', type: 'boolean', default: false }),
            expect.objectContaining({ name: 'turns', type: 'int', default: 20 }),
            expect.objectContaining({ name: 'timeout', type: 'int', default: 120 }),
        ]));
        expect(clarify.columns).toEqual(['status', 'session_id', 'url', 'submitted', 'response', 'receipt', 'artifacts', 'evolve', 'next_actions']);
    });

    it('keeps runtime-visible arguments for receipt and evolve', () => {
        const receipt = getRegistry().get('webagent/receipt');
        expect(receipt.args).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'id', positional: true, required: true }),
            expect.objectContaining({ name: 'turns', type: 'int', default: 10 }),
        ]));
        expect(receipt.columns).toEqual(['session_id', 'url', 'receipt', 'response', 'artifacts', 'evolve', 'next_actions']);

        const evolve = getRegistry().get('webagent/evolve');
        expect(evolve.args).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'id', positional: true, required: true }),
            expect.objectContaining({ name: 'later', type: 'boolean', default: false }),
            expect.objectContaining({ name: 'force', type: 'boolean', default: false }),
            expect.objectContaining({ name: 'skip-check', type: 'boolean', default: false }),
            expect.objectContaining({ name: 'turns', type: 'int', default: 10 }),
            expect.objectContaining({ name: 'timeout', type: 'int', default: 300 }),
        ]));
        expect(evolve.columns).toEqual(['status', 'session_id', 'url', 'response', 'credits', 'artifacts', 'evolve', 'next_actions']);
    });

    it('keeps runtime-visible arguments for session management commands', () => {
        expect(getRegistry().get('webagent/rename').args).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'id', positional: true, required: true }),
            expect.objectContaining({ name: 'title', positional: true, required: true }),
        ]));
        expect(getRegistry().get('webagent/delete').args).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'id', positional: true, required: true }),
        ]));
        expect(getRegistry().get('webagent/share').args).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'id', positional: true, required: true }),
            expect.objectContaining({ name: 'expire-days', type: 'int', default: 7 }),
        ]));
        expect(getRegistry().get('webagent/move').args).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'id', positional: true, required: true }),
            expect.objectContaining({ name: 'project-id', valueRequired: true }),
            expect.objectContaining({ name: 'from-project-id', valueRequired: true }),
        ]));
    });

    it('keeps runtime-visible arguments for project management commands', () => {
        expect(getRegistry().get('webagent/project-create').args).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'name', positional: true, required: true }),
        ]));
        expect(getRegistry().get('webagent/project-detail').args).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'id', positional: true, required: true }),
        ]));
        expect(getRegistry().get('webagent/project-rename').args).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'id', positional: true, required: true }),
            expect.objectContaining({ name: 'name', positional: true, required: true }),
        ]));
        expect(getRegistry().get('webagent/project-delete').args).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'id', positional: true, required: true }),
        ]));
        expect(getRegistry().get('webagent/project-remove-session').args).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'id', positional: true, required: true }),
            expect.objectContaining({ name: 'project-id', valueRequired: true }),
        ]));
    });
});
