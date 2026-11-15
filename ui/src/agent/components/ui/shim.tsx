// The shell's components, reached through the host.
//
// The props are the contract's types — that is what keeps an inline callback's
// parameters typed — with an index signature so a component may also carry the
// incidental props the real control accepts (a ref, `data-*`, an event handler the
// contract does not name). The alternative, `any`, makes every handler's arguments
// implicit `any` and hides the contract from the moved code.

import type { ComponentProps, ComponentType } from 'react'
import type { PortalUIText } from '../../../contract'
import { getHost } from '../../../host'

export function pick<K extends keyof PortalUIText>(name: K): ComponentType<ComponentProps<PortalUIText[K]> & { [key: string]: unknown }> {
  const ShellComponent = (props: { [key: string]: unknown }) => {
    const Component = getHost().ui[name] as unknown as ComponentType<{ [key: string]: unknown }>
    return <Component {...props} />
  }
  return ShellComponent as unknown as ComponentType<ComponentProps<PortalUIText[K]> & { [key: string]: unknown }>
}
