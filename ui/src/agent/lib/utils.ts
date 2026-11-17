// Class-name join, shared by the moved components.
//
// The shell's `cn` also resolves Tailwind conflicts. These components join static
// classes with a conditional, which a plain join handles; keeping the plugin free
// of tailwind-merge keeps one more package out of its bundle.
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(' ')
}
