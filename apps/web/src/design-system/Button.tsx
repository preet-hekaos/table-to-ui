import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from '@radix-ui/react-slot'
import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from './cn'

const button = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'border-accent bg-accent text-white hover:bg-accent-strong',
        secondary: 'border-line bg-surface text-ink hover:bg-soft',
        danger: 'border-bad-soft bg-surface text-bad-ink hover:bg-bad-soft',
        ghost: 'border-transparent bg-transparent text-body hover:bg-soft',
      },
      size: { sm: 'h-8 px-3 text-xs', md: 'h-9 px-4 text-sm', lg: 'h-11 px-5 text-sm' },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {
  loading?: boolean
  asChild?: boolean
}

export function Button({ className, variant, size, loading, asChild, children, disabled, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      className={cn(button({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {children}
        </>
      )}
    </Comp>
  )
}
