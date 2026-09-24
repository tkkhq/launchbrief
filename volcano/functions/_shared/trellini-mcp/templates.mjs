export const BOARD_TEMPLATES = [
    {
        id: 'sprint',
        title: 'Sprint board',
        columns: [
            { title: 'Backlog', accent: 'slate', is_done: false },
            { title: 'In progress', accent: 'cyan', is_done: false },
            { title: 'In review', accent: 'amber', is_done: false },
            { title: 'Shipped', accent: 'lime', is_done: true },
        ],
    },
    {
        id: 'launch',
        title: 'Product launch',
        columns: [
            { title: 'Ideas', accent: 'violet', is_done: false },
            { title: 'Building', accent: 'cyan', is_done: false },
            { title: 'Testing', accent: 'amber', is_done: false },
            { title: 'Launched', accent: 'lime', is_done: true },
        ],
    },
    {
        id: 'planner',
        title: 'Weekly planner',
        columns: [
            { title: 'Monday', accent: 'violet', is_done: false },
            { title: 'Tuesday', accent: 'cyan', is_done: false },
            { title: 'Wednesday', accent: 'amber', is_done: false },
            { title: 'Thursday', accent: 'rose', is_done: false },
            { title: 'Friday', accent: 'lime', is_done: false },
            { title: 'Saturday', accent: 'slate', is_done: false },
            { title: 'Sunday', accent: 'slate', is_done: false },
        ],
    },
];
