const TONES = [
  'bg-emerald-100 text-emerald-800',
  'bg-blue-100 text-blue-800',
  'bg-violet-100 text-violet-800',
  'bg-pink-100 text-pink-800',
  'bg-orange-100 text-orange-800',
  'bg-teal-100 text-teal-800',
]

/** Two letters from a name; "Sample - " style prefixes are skipped. */
export function initials(name: string) {
  const words = name
    .replace(/^.*? - /, '')
    .split(/\s+/)
    .filter(Boolean)
  return ((words[0]?.[0] ?? '?') + (words[1]?.[0] ?? '')).toUpperCase()
}

function tone(name: string) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return TONES[h % TONES.length]
}

/** A round badge with a person's (or record's) initials. The same name always gets the same colour. Decorative: the name is always written beside it. */
export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${size === 'sm' ? 'size-7 text-[11px]' : 'size-9 text-xs'} ${tone(name)}`} aria-hidden>
      {initials(name)}
    </span>
  )
}
