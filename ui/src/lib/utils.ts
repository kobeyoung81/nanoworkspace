// Class-name join, the one utility the moved components need.
//
// The shell's `cn` also resolves Tailwind conflicts; these components only ever
// concatenate static classes with a conditional, so a plain join keeps this
// module free of another dependency.
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(' ')
}
