// Type-only: `tsc` (in `build`) fails here when the client's canShow vocabulary drifts from the server's canDo.
import type { ShowAction, ShowTarget } from '../client/lib/can-show';
import type { PermissionAction, PermissionTarget } from './permissions';

type Assert<T extends true> = T;
export type ShowActionIsKnown = Assert<ShowAction extends PermissionAction ? true : false>;
export type ShowTargetIsKnown = Assert<keyof ShowTarget extends keyof PermissionTarget ? true : false>;
