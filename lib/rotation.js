import { activeApplication } from './tags.js';

export const eligible = (c) => ['Watching', 'Dormant', 'To review'].includes(c.stance) && !activeApplication(c);
