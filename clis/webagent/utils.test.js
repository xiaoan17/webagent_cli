import { describe, expect, it } from 'vitest';
import {
    buildClarificationSubmission,
    extractClarificationFromText,
    extractAssistantTextFromEvents,
    findLatestClarification,
    isSessionDoneStatus,
    normalizeSessionMessages,
    parseSessionId,
    parseSseEvents,
    __test__,
} from './utils.js';

describe('webagent utils', () => {
    it('parses WebAgent session ids from ids and chat URLs', () => {
        expect(parseSessionId('abcDEF_12345')).toBe('abcDEF_12345');
        expect(parseSessionId('https://agent.famou.com/chat/sess_123456789')).toBe('sess_123456789');
        expect(parseSessionId('/chat/sess-abcdef12')).toBe('sess-abcdef12');
        expect(() => parseSessionId('https://example.com/chat/sess_123456789')).toThrow(/WebAgent chat URL/);
    });

    it('parses event_type SSE blocks into canonical event types', () => {
        const raw = [
            'id: e1',
            'event_type: text',
            'data: {"event_id":"evt-1","session_id":"s1","payload":{"partial":false,"content":"hello"}}',
            '',
            'id: e2',
            'event_type: status',
            'data: {"payload":{"status":"idle"},"seq":2}',
            '',
        ].join('\n');

        const events = parseSseEvents(raw, 'fallback');
        expect(events).toEqual([
            expect.objectContaining({
                event_id: 'evt-1',
                session_id: 's1',
                type: 'agent/text',
                payload: { partial: false, content: 'hello' },
            }),
            expect.objectContaining({
                event_id: 'e2',
                session_id: 'fallback',
                type: 'session/status',
                payload: { status: 'idle' },
                seq: 2,
            }),
        ]);
    });

    it('extracts final text and strips WebAgent suggestions markup', () => {
        const events = [
            { type: 'agent/text', payload: { partial: true, content: 'draft' } },
            { type: 'agent/text', payload: { partial: false, content: 'final <sag>{"suggestions":["x"]}</sag>' } },
        ];
        expect(extractAssistantTextFromEvents(events)).toBe('final');
    });

    it('falls back to partial text when no final text arrived', () => {
        const events = [
            { type: 'agent/text', payload: { partial: true, content: 'partial answer' } },
        ];
        expect(extractAssistantTextFromEvents(events)).toBe('partial answer');
    });

    it('normalizes history events into user and assistant rows', () => {
        const session = {
            events: [
                {
                    type: 'user/message',
                    payload: {
                        messages: [{
                            role: 'user',
                            content: [{ type: 'text', text: 'hi' }],
                        }],
                    },
                },
                {
                    type: 'agent/text',
                    payload: { partial: false, content: 'hello' },
                },
            ],
        };
        expect(normalizeSessionMessages(session)).toEqual([
            { role: 'user', text: 'hi' },
            { role: 'assistant', text: 'hello' },
        ]);
    });

    it('includes attached file names in normalized user rows', () => {
        const session = {
            events: [
                {
                    type: 'user/message',
                    payload: {
                        messages: [{
                            role: 'user',
                            content: [
                                { type: 'text', text: 'analyze this' },
                                { type: 'file', name: 'orders.csv', size: 12, url: 'https://example.com/orders.csv' },
                            ],
                        }],
                    },
                },
            ],
        };
        expect(normalizeSessionMessages(session)).toEqual([
            { role: 'user', text: 'analyze this\n[Attached file: orders.csv]' },
        ]);
    });

    it('recognizes terminal session statuses', () => {
        expect(isSessionDoneStatus('idle')).toBe(true);
        expect(isSessionDoneStatus('running')).toBe(false);
    });

    it('normalizes WebAgent project summaries', () => {
        expect(__test__.normalizeProjectSummary({
            projectId: 'p1',
            projectName: '生产排程',
            knowledge: [{ fileName: 'orders.xlsx' }],
            skills: [{ id: 's1' }],
            tasks: [{ id: 't1' }, { id: 't2' }],
            limit: { fileCount: 10, fileSize: 1024 * 1024 },
        })).toEqual({
            id: 'p1',
            name: '生产排程',
            file_count: 1,
            skill_count: 1,
            task_count: 2,
            created_at: '',
            file_limit: 10,
            size_limit: '1.00MB',
        });
    });

    it('builds WebAgent file message content', () => {
        expect(__test__.fileToMessageContent({
            name: 'orders.csv',
            size: 12,
            url: 'https://example.com/orders.csv',
        })).toEqual({
            type: 'file',
            name: 'orders.csv',
            size: 12,
            url: 'https://example.com/orders.csv',
        });
        expect(__test__.fileToMessageContent({
            name: 'chart.png',
            size: 34,
            fileType: 'image/png',
            url: 'https://example.com/chart.png',
        })).toEqual({
            type: 'image',
            name: 'chart.png',
            size: 34,
            mimeType: 'image/png',
            url: 'https://example.com/chart.png',
        });
    });

    it('keeps file attachments out of prompt text', () => {
        const messages = __test__.buildMessages('summarize', [{
            name: 'orders.csv',
            size: 12,
            url: 'https://example.com/orders.csv',
        }]);
        expect(messages).toEqual([{
            role: 'user',
            content: [
                { type: 'text', text: 'summarize' },
                { type: 'file', name: 'orders.csv', size: 12, url: 'https://example.com/orders.csv' },
            ],
        }]);
        expect(messages[0].content[0].text).not.toContain('BEGIN CLI DATA');
    });

    it('expands escaped newlines in inline data arguments', () => {
        expect(__test__.normalizeInlineDataText('company,segment\\n宁德时代,动力电池'))
            .toBe('company,segment\n宁德时代,动力电池');
    });

    it('extracts clarification cards from assistant text', () => {
        const parsed = extractClarificationFromText([
            '请确认',
            '<clarify>',
            '{"title":"确认信息","questions":[{"label":"是否返回仓库？","multi":false,"options":["是","否"],"default":"是"}]}',
            '</clarify>',
        ].join('\n'));
        expect(parsed.data).toEqual({
            title: '确认信息',
            questions: [{
                id: '0',
                label: '是否返回仓库？',
                hint: undefined,
                multi: false,
                options: ['是', '否'],
                default: '是',
            }],
        });
        expect(parsed.cleanContent).toBe('请确认');
    });

    it('extracts malformed clarification cards with unescaped quotes in labels', () => {
        const parsed = extractClarificationFromText([
            '<clarify>',
            '{',
            '  "title": "确认几个关键约束，确保方案准确",',
            '  "questions": [',
            '    {',
            '      "label": "【优化目标确认】需求说明中目标是"5天内所有车辆总行驶路程最短"，同时每天最多5辆车。我的理解是：车辆数没有最小使用限制，每天可用0~5辆，只要满足配送需求即可，总路程越短越好——是否正确？",',
            '      "multi": false,',
            '      "options": [',
            '        "是，理解正确",',
            '        "不对，每天必须恰好出5辆车"',
            '      ],',
            '      "default": "是，理解正确"',
            '    },',
            '    {',
            '      "label": "【车辆返回仓库】每辆车完成当日配送后，是否必须返回仓库？（影响每趟路程是否按"仓库→门店→仓库"计算）需求说明中写的是2×直线距离，我理解为必须返回。",',
            '      "multi": false,',
            '      "options": [',
            '        "是，必须返回仓库，路程=2×直线距离（如说明所述）",',
            '        "不需要返回，路程=单程距离"',
            '      ],',
            '      "default": "是，必须返回仓库，路程=2×直线距离（如说明所述）"',
            '    },',
            '    {',
            '      "label": "【单车路线结构】当一辆车在同一天配送多个门店时，路程如何计算？",',
            '      "multi": false,',
            '      "options": [',
            '        "是，多门店时按路径累加（仓库→A→B→仓库），路程最短化",',
            '        "不对，每个门店都要单独往返仓库（即各自2×距离之和）"',
            '      ],',
            '      "default": "是，多门店时按路径累加（仓库→A→B→仓库），路程最短化"',
            '    },',
            '    {',
            '      "label": "【车辆工作量均衡】多辆车出发时，是否需要尽量均衡各车的载重或路程？（作为次要优化目标）",',
            '      "multi": false,',
            '      "options": [',
            '        "不需要，只最小化总路程即可",',
            '        "需要，各车载重尽量均衡（软约束）"',
            '      ],',
            '      "default": "不需要，只最小化总路程即可"',
            '    }',
            '  ]',
            '}',
            '</clarify>',
        ].join('\n'));
        expect(parsed.data.title).toBe('确认几个关键约束，确保方案准确');
        expect(parsed.data.questions).toHaveLength(4);
        expect(parsed.data.questions[0].label).toContain('目标是"5天内所有车辆总行驶路程最短"');
        expect(parsed.data.questions[1].label).toContain('按"仓库→门店→仓库"计算');
        expect(buildClarificationSubmission(parsed.data)).toBe([
            '【优化目标确认】需求说明中目标是"5天内所有车辆总行驶路程最短"，同时每天最多5辆车。我的理解是：车辆数没有最小使用限制，每天可用0~5辆，只要满足配送需求即可，总路程越短越好——是否正确？：是，理解正确',
            '【车辆返回仓库】每辆车完成当日配送后，是否必须返回仓库？（影响每趟路程是否按"仓库→门店→仓库"计算）需求说明中写的是2×直线距离，我理解为必须返回。：是，必须返回仓库，路程=2×直线距离（如说明所述）',
            '【单车路线结构】当一辆车在同一天配送多个门店时，路程如何计算？：是，多门店时按路径累加（仓库→A→B→仓库），路程最短化',
            '【车辆工作量均衡】多辆车出发时，是否需要尽量均衡各车的载重或路程？（作为次要优化目标）：不需要，只最小化总路程即可',
        ].join('\n'));
    });

    it('builds clarification submission text like the WebAgent UI', () => {
        const clarification = {
            title: '确认信息',
            questions: [
                { id: '0', label: '优化目标', multi: false, options: ['是', '否'], default: '是' },
                { id: '1', label: '配送日', multi: true, options: ['Day 1', 'Day 2'], default: undefined },
            ],
        };
        expect(buildClarificationSubmission(clarification, { 2: ['Day 1', 'Day 2'] }, '继续')).toBe([
            '优化目标：是',
            '配送日：Day 1、Day 2',
            '补充说明：继续',
        ].join('\n'));
    });

    it('detects whether a clarification has already been submitted', () => {
        const session = {
            events: [
                { type: 'agent/text', payload: { partial: false, content: '<clarify>{"title":"确认","questions":[{"label":"目标","multi":false,"options":["是"],"default":"是"}]}</clarify>' } },
                { type: 'user/message', payload: { messages: [{ role: 'user', content: [{ type: 'text', text: '目标：是' }] }] } },
            ],
        };
        expect(findLatestClarification(session)).toEqual(expect.objectContaining({
            submitted: true,
            nextUserText: '目标：是',
        }));
    });

    it('detects clarification cards in normalized session messages', () => {
        const session = {
            messages: [
                { role: 'user', text: '开始' },
                { role: 'assistant', text: '<clarify>{"title":"确认","questions":[{"label":"目标","multi":false,"options":["是"],"default":"是"}]}</clarify>' },
            ],
        };
        expect(findLatestClarification(session)).toEqual(expect.objectContaining({
            submitted: false,
            clarification: expect.objectContaining({
                title: '确认',
                questions: [expect.objectContaining({ label: '目标', default: '是' })],
            }),
        }));
    });
});
