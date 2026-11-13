// The shell's components, reached through the host.
//
// The file browser is the shell's own code, moved here: it keeps its imports
// (`../ui/button` and friends) and these thin components forward to whatever kit
// the shell installed. They are created at module scope, so their identity is
// stable — a component created during render would remount its subtree on every
// pass.

import type { ComponentType } from 'react'
import type { PortalUIText } from '../contract'
import { getHost } from '../host'

/* eslint-disable @typescript-eslint/no-explicit-any */
// An index signature (not bare `any`) so props are contextually typed: a callback
// written inline gets `any` parameters instead of an implicit-any error.
type AnyProps = Record<string, any>

export function pick<K extends keyof PortalUIText>(name: K): ComponentType<AnyProps> {
  return function ShellComponent(props: AnyProps) {
    const Component = getHost().ui[name] as unknown as ComponentType<AnyProps>
    return <Component {...props} />
  }
}
