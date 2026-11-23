import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Times on the page are shown in the browser's time zone; pin it so the tests do not depend on the machine they run on.
vi.stubEnv('TZ', 'America/New_York');

afterEach(cleanup);
