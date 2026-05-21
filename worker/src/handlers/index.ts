import { BaseHandler }                       from './baseHandler';
import { BaseJobPayload }                    from '../types/jobs';
import { GenerateDynamicExportHandler }      from './generateDynamicExport';
import { ProcessAccountingReversalHandler }  from './processAccountingReversal';

/**
 * Central handler registry.
 *
 * Adding a new job type:
 *   1. Define payload in src/types/jobs.ts
 *   2. Create src/handlers/myNewJob.ts extending BaseHandler<MyPayload>
 *   3. Add an instance to this array — the worker loop picks it up automatically.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handlers: BaseHandler<any>[] = [
  new GenerateDynamicExportHandler(),
  new ProcessAccountingReversalHandler(),
];
