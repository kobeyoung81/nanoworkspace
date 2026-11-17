// The shell's component, forwarded from the host (see shim.tsx).

import { pick } from './shim'

export const Tooltip = pick('Tooltip')
export const TooltipContent = pick('TooltipContent')
export const TooltipTrigger = pick('TooltipTrigger')
